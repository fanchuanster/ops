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

from ..jobs.model import Job, JobKind
from ..jobs.runner import run
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


def _formats(value: object) -> list[str] | None:
    """The requested format list, or None when the server did not say.

    The distinction matters: None means "build the usual set" and an
    empty list means "the server asked for nothing". Only a list of
    strings is accepted — anything else is treated as not said, because
    guessing at a malformed instruction is how a book ends up with the
    wrong editions attached to it.
    """
    if not isinstance(value, list):
        return None
    return [item for item in value if isinstance(item, str)]


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

        # Which phase this is. Defaulted rather than required so a web
        # application that predates the split still hands out work this
        # converter can do.
        try:
            kind = JobKind(job.get("kind", JobKind.FULL.value))
        except ValueError:
            raise RuntimeError(
                f"the web application asked for job kind {job.get('kind')!r}, "
                "which this converter does not know. It is newer than this build."
            ) from None

        return Job(
            # Absent for a phase 2 job, which reads the master instead.
            source_key=job.get("source_key") or "",
            book_id=str(job["book_id"]),
            kind=kind,
            ocr_key=job.get("ocr_key"),
            master_key=job.get("master_key"),
            # Absent from an older web application, which built the whole
            # set. None preserves exactly that, so the two sides may be
            # deployed in either order.
            formats=_formats(job.get("formats")),
            # Only a cover job sends these; all three are None otherwise.
            source_format=job.get("source_format"),
            cover_key=job.get("cover_key"),
            # Absent from a web application that predates candidates,
            # which asks for page one and nothing else. None preserves
            # exactly that, so the two sides deploy in either order.
            cover_keys=job.get("cover_keys") or None,
            title=job.get("title"),
            author=job.get("author"),
            # Taken from the server's answer, never assumed here. The
            # safe value is false and the server is the one that knows.
            allow_third_party_ai=bool(job.get("allow_third_party_ai", False)),
        )

    def report(self, job: Job) -> None:
        # The phase is echoed back because it decides where the book
        # lands: phase 1 finishing queues phase 2, phase 2 finishing
        # makes the book readable. Reporting the wrong one would either
        # publish a book with no EPUB or rebuild it forever.
        body: dict = {"book_id": job.book_id, "kind": job.kind.value}

        # A cover reports the one key it wrote and nothing else. It is
        # not an artifact and must not arrive as one — a completion
        # carrying an empty artifact list is refused, and a cover that
        # moved the book's conversion state would publish or fail a book
        # over a picture.
        if job.kind is JobKind.COVER:
            if job.state.value == "completed":
                # Both, always: `cover_key` is what an older web
                # application reads, `cover_keys` is the page order a
                # newer one records as the candidates.
                body |= {
                    "state": "completed",
                    "cover_key": job.cover,
                    "cover_keys": job.covers or ([job.cover] if job.cover else []),
                }
            else:
                body |= {"state": "failed", "message": job.error or "No cover could be rendered."}
            self._client.post("/api/conversion", json=body).raise_for_status()
            return

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
        """One poll. True if a book was worked on, False if idle."""
        job = self.claim()
        if job is None:
            return False

        log.info(
            "book %s: %s from %s",
            job.book_id,
            job.kind.value,
            job.master_key or job.ocr_key or job.source_key,
        )
        run(job, self._store)

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
