"""Pulls queued conversions from the web application and reports back.

The converter has no inbound port. That is a constraint worth keeping —
it is what lets this service run behind a filtered egress, on a host
that accepts no connections — so the direction of the wire is: this
process asks for work, rather than the web application pushing it.

The web side is `apps/web/src/app/(frontend)/api/conversion/route.ts`,
which hands out one book at a time with a compare-and-swap so two
converters cannot claim the same one.

Configured from the environment. The secret is the only thing standing
between this endpoint and anyone who wants to attach files to a book,
so it is read from the environment and never defaulted:

    NOBLESEE_API=https://noblesee.com
    CONVERTER_SECRET=...
    CONVERTER_POLL_SECONDS=30          (default)

Run it with:  python -m app.handoff
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass

import httpx

from ..jobs.model import Job
from ..jobs.runner import run_job
from ..storage.r2 import ObjectStore

log = logging.getLogger(__name__)


@dataclass
class PollerConfig:
    base_url: str
    secret: str
    interval: float = 30.0
    # Long, because a scanned book legitimately takes hours and a
    # timeout here would abandon work that is still running.
    timeout: float = 60.0

    @classmethod
    def from_env(cls) -> "PollerConfig":
        base = os.getenv("NOBLESEE_API", "").rstrip("/")
        secret = os.getenv("CONVERTER_SECRET", "")
        if not base or not secret:
            raise RuntimeError(
                "NOBLESEE_API and CONVERTER_SECRET must both be set. "
                "Without them there is nothing to poll and no way to authenticate."
            )
        return cls(
            base_url=base,
            secret=secret,
            interval=float(os.getenv("CONVERTER_POLL_SECONDS", "30")),
        )


class Poller:
    def __init__(self, config: PollerConfig, store: ObjectStore | None) -> None:
        self._config = config
        self._store = store
        self._client = httpx.Client(
            base_url=config.base_url,
            timeout=config.timeout,
            headers={"Authorization": f"Bearer {config.secret}"},
        )

    def close(self) -> None:
        self._client.close()

    def claim(self) -> Job | None:
        """Ask for the next queued book. None when there is nothing."""
        response = self._client.get("/api/conversion")
        if response.status_code == 404:
            # The endpoint fails closed when the web application has no
            # secret configured, so this is the likeliest misconfiguration
            # and deserves to say so rather than looking like "no work".
            raise RuntimeError(
                "The conversion endpoint returned 404. Either CONVERTER_SECRET is "
                "unset on the web application, or NOBLESEE_API points somewhere else."
            )
        response.raise_for_status()

        job = response.json().get("job")
        if not job:
            return None

        return Job(
            source_key=job["source_key"],
            book_id=str(job["book_id"]),
            title=job.get("title"),
            author=job.get("author"),
            # Taken from the server's answer, never assumed here. The
            # safe value is false and the server is the one that knows.
            allow_third_party_ai=bool(job.get("allow_third_party_ai", False)),
        )

    def report(self, job: Job) -> None:
        body: dict = {"book_id": job.book_id}
        if job.state.value == "completed":
            body |= {
                "state": "completed",
                "artifacts": job.artifacts,
                "page_count": job.page_count,
            }
        else:
            body |= {"state": "failed", "message": job.error or "The conversion failed."}

        self._client.post("/api/conversion", json=body).raise_for_status()

    def tick(self) -> bool:
        """One poll. True if a book was converted, False if idle."""
        job = self.claim()
        if job is None:
            return False

        log.info("converting book %s from %s", job.book_id, job.source_key)
        run_job(job, self._store)

        # Reported whatever the outcome. A book left in `converting`
        # forever is the worst failure mode here: the uploader sees a
        # spinner that never resolves and nobody knows why.
        try:
            self.report(job)
        except Exception:
            log.exception("could not report job %s back; the book stays 'converting'", job.id)
        return True


def run_forever(config: PollerConfig | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    config = config or PollerConfig.from_env()
    poller = Poller(config, ObjectStore.from_env())

    log.info("polling %s every %ss", config.base_url, config.interval)
    try:
        while True:
            try:
                # Only sleep when there was nothing to do — a backlog
                # should drain at the speed of conversion, not at the
                # speed of the poll interval.
                if not poller.tick():
                    time.sleep(config.interval)
            except KeyboardInterrupt:
                raise
            except Exception:
                # A transient network failure must not end the loop.
                log.exception("poll failed; retrying")
                time.sleep(config.interval)
    except KeyboardInterrupt:
        log.info("stopping")
    finally:
        poller.close()
