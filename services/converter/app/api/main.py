"""The conversion service's HTTP API.

Asynchronous by construction, because it has to be: a scanned book takes
minutes to hours to OCR and CLAUDE.md section 13 is explicit that the
request must not wait for it. `POST /api/v1/jobs` returns an id
immediately; `GET /api/v1/jobs/{id}` reports where that job has got to.

The work runs on a small pool of background threads rather than Celery
and Redis. The pipeline is CPU-bound and already releases the GIL in the
places that matter (PyMuPDF, PaddleOCR, WeasyPrint all drop into native
code), and the durable record of a conversion is the Book row in the web
application — so a broker would be a second stateful service to operate
for queueing that a bounded thread pool already does. If this ever needs
to scale past one machine, the thing to add is a real queue between the
web application and *several* of these, which is the Cloudflare Queues
boundary CLAUDE.md already describes — not a broker inside this one.
"""

from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from ..jobs.model import Job, JobState
from ..jobs.runner import run_job
from ..jobs.store import JobStore
from ..storage.r2 import ObjectStore

log = logging.getLogger(__name__)

# One conversion is already parallel inside PaddleOCR, so a wide pool
# here mostly means several books competing for the same cores and all
# finishing late. Two is a default, not a law.
WORKERS = int(os.getenv("CONVERTER_WORKERS", "2"))

store = JobStore()
objects = ObjectStore.from_env()
_pool: ThreadPoolExecutor | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _pool
    _pool = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="convert")
    if objects is None:
        # Loud, because every job will fail without it and the reason is
        # not obvious from a job that says "failed: object storage is
        # not configured" hours later.
        log.warning("R2 is not configured — conversions will fail. See app/storage/r2.py.")
    try:
        yield
    finally:
        _pool.shutdown(wait=False, cancel_futures=True)


app = FastAPI(title="NobleSee Converter", version="1.0", lifespan=lifespan)


class JobRequest(BaseModel):
    source_key: str = Field(description="Object-storage key of the uploaded file.")
    book_id: str | None = Field(default=None, description="Book this conversion belongs to.")
    title: str | None = None
    author: str | None = None
    allow_third_party_ai: bool = Field(
        default=False,
        description=(
            "Whether this text may be sent to a third-party LLM for OCR correction. "
            "False for a reader's private upload — see CLAUDE.md section 6.1. The "
            "default is the safe one on purpose: forgetting this field must not "
            "leak someone's book."
        ),
    )


@app.get("/health")
def health() -> dict:
    return {"ok": True, "storage": objects is not None, "workers": WORKERS}


@app.post("/api/v1/jobs", status_code=202)
def create_job(request: JobRequest) -> dict:
    job = Job(
        source_key=request.source_key,
        book_id=request.book_id,
        title=request.title,
        author=request.author,
        allow_third_party_ai=request.allow_third_party_ai,
    )
    store.add(job)

    assert _pool is not None  # set in lifespan, before any request is served
    _pool.submit(run_job, job, objects)

    # 202 with the id and nothing else useful yet: the client's next move
    # is to poll, and pretending to know more would be a lie.
    return job.as_dict()


@app.get("/api/v1/jobs/{job_id}")
def read_job(job_id: str) -> dict:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No such job.")
    return job.as_dict()


@app.get("/api/v1/jobs")
def list_jobs(limit: int = 50) -> dict:
    return {"jobs": [job.as_dict() for job in store.list(limit)]}


@app.post("/api/v1/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No such job.")

    cancelled = store.cancel(job_id)
    if cancelled is None:
        # Honest refusal rather than a cancellation that does not
        # cancel: there is no safe interruption point mid-OCR.
        raise HTTPException(
            status_code=409,
            detail=f"Job is {job.state.value} and can no longer be cancelled.",
        )
    return cancelled.as_dict()
