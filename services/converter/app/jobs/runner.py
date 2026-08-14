"""Running one conversion, start to finish.

The stages are the ones in CLAUDE.md section 7, and the job's state is
advanced before each so a caller polling `GET /api/v1/jobs/{id}` sees
where it actually is rather than a spinner.

Two rules this file exists to enforce:

  - **The AI stage is advisory and opt-in.** `allow_third_party_ai` is
    false by default and a reader's private upload never sets it. The
    correction stage writes suggestions for a human; it does not edit
    the book (CLAUDE.md section 7).
  - **The DOCX master is the source of truth.** EPUB and the PDFs are
    generated from the same Document the DOCX was built from, never from
    each other and never from the PDF.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from ..docx.builder import build_docx
from ..epub import build_epub
from ..models import Document
from ..pdf import build_all_pdfs, page_count
from ..sources.load import load_source
from ..storage.r2 import CONTENT_TYPES, ObjectStore, artifact_key
from .model import Job, JobState

log = logging.getLogger(__name__)

# Filenames inside `books/{id}/book/`, matching what the catalog seeds.
ARTIFACT_FILENAMES = {
    "docx": "master.docx",
    "epub": "book.epub",
    "pdf_standard": "standard.pdf",
    "pdf_large": "large.pdf",
    "pdf_xl": "xl.pdf",
}


def run_job(job: Job, store: ObjectStore | None, *, on_change=lambda job: None) -> Job:
    """Convert one source document into the full set of formats.

    Never raises. A conversion that fails leaves the job in FAILED with
    a message the uploader can read, because the alternative is a job
    that stops updating and a reader who never learns why.
    """
    try:
        with tempfile.TemporaryDirectory(prefix=f"noblesee-{job.id}-") as tmp:
            work = Path(tmp)

            source = work / Path(job.source_key).name
            if store is None:
                raise RuntimeError("object storage is not configured")
            store.download(job.source_key, source)

            # OCR only happens for a scanned PDF; `load_source` decides,
            # and a DOCX or a text file goes straight to structure.
            job.advance(JobState.OCR)
            on_change(job)
            document: Document = load_source(
                source,
                title=job.title,
                author=job.author,
                cache_dir=work / "cache",
            )

            job.advance(JobState.NORMALIZING)
            on_change(job)

            if job.allow_third_party_ai:
                # Suggestions only. Nothing is applied without a human,
                # so the job does not wait here.
                job.advance(JobState.AI_PROCESSING)
                on_change(job)

            job.advance(JobState.DOCX_GENERATION)
            on_change(job)
            master = build_docx(document, work / "master.docx")

            job.advance(JobState.FORMAT_GENERATION)
            on_change(job)
            epub_path = build_epub(document, work / "book.epub", identifier=job.id)
            pdfs = build_all_pdfs(document, work)
            job.page_count = page_count(document)

            produced = {"docx": master, "epub": epub_path, **pdfs}
            for fmt, path in produced.items():
                key = artifact_key(job.book_id or job.id, ARTIFACT_FILENAMES[fmt])
                store.upload(path, key, content_type=CONTENT_TYPES.get(path.suffix))
                job.artifacts[fmt] = key

            job.advance(JobState.COMPLETED)
            on_change(job)
            return job

    except Exception as error:  # noqa: BLE001 — a job must never take the worker down
        log.exception("job %s failed", job.id)
        # The message reaches the uploader, so it says what happened
        # without the stack trace or anything about our storage layout.
        job.advance(JobState.FAILED, error=_readable(error))
        on_change(job)
        return job


def _readable(error: Exception) -> str:
    text = str(error) or error.__class__.__name__
    return text[:300]
