"""The LLM abstraction.

CLAUDE.md section 4 requires that the endpoint, model and key all come
from the environment and never from source, and section 2.2 that a
third-party dependency sits behind a replaceable interface. So everything
downstream of here depends only on `ChatClient.complete`, and the
provider is a configuration choice.

Two providers are supported, both speaking the OpenAI chat-completions
shape, so the pipeline cannot tell which is answering:

  xai    (default) — https://api.x.ai/v1, key from XAI_API_KEY
  vllm             — the self-hosted Gemma endpoint, key usually absent

vLLM was the original provider and remains a legitimate option; it is
reachable on the internal network only, so a converter running off that
network needs it exposed through a tunnel first. Nothing here cares which
of the two answers — see `services/converter/README.md`.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

DEFAULT_PROVIDER = "xai"

# Per-provider defaults. Only the base URL and model differ; a provider
# is not a code path, which is the point.
PROVIDERS = {
    "xai": {
        "base_url": "https://api.x.ai/v1",
        # The cheap text model, chosen deliberately. Correction is a
        # narrow, well-specified task over short inputs, and the
        # non-reasoning variant spends no reasoning tokens — which are
        # billed as output at twice the input rate and are the real cost
        # of running a whole book through this stage. Measured against
        # grok-4.6: same corrections on sample lines, 2.4x cheaper output.
        "model": "grok-4.20-0309-non-reasoning",
        "key_var": "XAI_API_KEY",
        "key_required": True,
    },
    "vllm": {
        # No default endpoint: the internal address is deployment
        # configuration, and hard-coding it is exactly what section 4
        # forbids.
        "base_url": "",
        "model": "google/gemma-4-31B-it-qat-w4a16-ct",
        "key_var": "VLLM_API_KEY",
        # A self-hosted vLLM is usually served without authentication.
        "key_required": False,
    },
}

# Retried rather than failed: a book is thousands of requests and a
# single transient rate-limit should not throw away an hour of work.
RETRY_STATUSES = frozenset({408, 409, 429, 500, 502, 503, 504})


class LlmError(RuntimeError):
    """The endpoint could not be reached, or refused the request."""


class ChatClient(Protocol):
    """A single-turn chat completion. Deliberately the whole interface."""

    model: str

    def complete(self, system: str, user: str) -> str:
        ...


def _load_dotenv() -> None:
    """Fill in missing variables from the repo-root `.env`, for CLI runs.

    In a container the environment is set directly and no `.env` exists,
    which is why nothing here fails when the file is absent. Values
    already in the environment always win.
    """
    try:
        from dotenv import find_dotenv, load_dotenv
    except ImportError:  # pragma: no cover - dotenv is an install-time dep
        return
    found = find_dotenv(usecwd=True)
    if not found:
        # `usecwd` walks up from the working directory; when the CLI is
        # run from elsewhere, walk up from this file instead.
        for parent in Path(__file__).resolve().parents:
            candidate = parent / ".env"
            if candidate.is_file():
                found = str(candidate)
                break
    if found:
        load_dotenv(found, override=False)


@dataclass(frozen=True)
class LlmConfig:
    provider: str
    base_url: str
    model: str
    api_key: str = ""
    timeout: float = 180.0
    max_retries: int = 4
    # Ask the endpoint to constrain output to JSON. xAI supports it; a
    # given vLLM build may not, and the parser copes either way.
    json_mode: bool = True

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "LlmConfig":
        if env is None:
            _load_dotenv()
            env = dict(os.environ)

        provider = env.get("LLM_PROVIDER", DEFAULT_PROVIDER).strip().lower()
        if provider not in PROVIDERS:
            raise LlmError(
                f"unknown LLM_PROVIDER {provider!r} — expected one of "
                f"{', '.join(sorted(PROVIDERS))}"
            )
        spec = PROVIDERS[provider]
        prefix = provider.upper()

        # LLM_* overrides the provider's own variables, so a deployment
        # can point the pipeline anywhere OpenAI-compatible without this
        # file growing a third provider.
        base_url = (
            env.get("LLM_BASE_URL")
            or env.get(f"{prefix}_BASE_URL")
            or spec["base_url"]
        ).rstrip("/")
        if not base_url:
            raise LlmError(
                f"{prefix}_BASE_URL is not set. The {provider} endpoint has no "
                "default address — it is deployment configuration."
            )

        key = (env.get("LLM_API_KEY") or env.get(spec["key_var"], "")).strip()
        if not key and spec["key_required"]:
            raise LlmError(
                f"{spec['key_var']} is not set. Put it in the repo-root .env "
                "(which is gitignored) or export it before running."
            )

        return cls(
            provider=provider,
            base_url=base_url,
            model=env.get("LLM_MODEL") or env.get(f"{prefix}_MODEL") or spec["model"],
            api_key=key,
            timeout=float(env.get("LLM_TIMEOUT", "180")),
            json_mode=env.get("LLM_JSON_MODE", "1") not in ("0", "false", "no"),
        )


class OpenAiCompatibleClient:
    """Chat completions against any OpenAI-shaped endpoint."""

    def __init__(self, config: LlmConfig, http=None):
        import httpx

        self._config = config
        self.model = config.model
        headers = {"Content-Type": "application/json"}
        if config.api_key:
            headers["Authorization"] = f"Bearer {config.api_key}"
        self._http = http or httpx.Client(
            base_url=config.base_url, timeout=config.timeout, headers=headers
        )

    @property
    def describe(self) -> str:
        return f"{self._config.provider}:{self.model}"

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "OpenAiCompatibleClient":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def complete(self, system: str, user: str) -> str:
        payload = {
            "model": self.model,
            # Deterministic: the same page should not produce different
            # suggestions on a re-run, or a reviewer cannot trust a diff.
            "temperature": 0,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if self._config.json_mode:
            payload["response_format"] = {"type": "json_object"}

        last_error: str | None = None
        for attempt in range(self._config.max_retries):
            response = self._http.post("/chat/completions", json=payload)
            if response.status_code == 200:
                return _extract_content(response.json())
            last_error = f"HTTP {response.status_code}: {response.text[:400]}"
            if response.status_code not in RETRY_STATUSES:
                break
            # Honour Retry-After when the server sends one; otherwise back
            # off exponentially from one second.
            delay = response.headers.get("Retry-After")
            time.sleep(float(delay) if delay and delay.isdigit() else 2**attempt)

        raise LlmError(f"{self._config.base_url}/chat/completions failed — {last_error}")


def _extract_content(body: dict) -> str:
    """Pull the assistant text out of an OpenAI-shaped response.

    Only `content` is read. Reasoning models also return
    `reasoning_content`, which is the model's scratch work and must never
    be parsed as the answer.
    """
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LlmError(f"unexpected response shape: {json.dumps(body)[:400]}") from exc
    if not content:
        raise LlmError("the model returned an empty completion")
    return content


def get_client(config: LlmConfig | None = None) -> OpenAiCompatibleClient:
    return OpenAiCompatibleClient(config or LlmConfig.from_env())
