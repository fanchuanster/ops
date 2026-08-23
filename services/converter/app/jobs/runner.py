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

from ..cover import CoverUnavailable, render_cover
from ..docx.builder import build_docx
from ..epub import build_epub
from ..models import Document
from ..pdf import LibreOfficeUnavailable, build_pdf, docx_to_pdf, page_count
from ..sources.load import load_source
from ..sources.ocr_json import page_count_of, read_ocr_json
from ..storage.r2 import CONTENT_TYPES, ObjectStore, artifact_key
from .model import Job, JobKind, JobState

log = logging.getLogger(__name__)

# Filenames inside `books/{id}/book/`, matching what the catalog seeds.
ARTIFACT_FILENAMES = {
    "docx": "master.docx",
    "epub": "book.epub",
    "pdf": "book.pdf",
}

# What phase 2 builds when the caller does not say. Everything — which
# is what the CLI and the job API want, since an editor converting a
# book locally asked for the whole set by running the command at all.
ALL_READER_FORMATS = ("epub", "pdf")


def _wanted_formats(job: Job) -> set[str]:
    """Which reader-facing formats this job should produce.

    An empty list is not the same as no list. `None` means "the caller
    did not say", which is the CLI, and gets everything; `[]` means the
    caller said nothing was wanted, which would be a bug on the web
    side but must not silently become "build all five".
    """
    if job.formats is None:
        return set(ALL_READER_FORMATS)
    return {fmt for fmt in job.formats if fmt in ALL_READER_FORMATS}


def run(job: Job, store: ObjectStore | None, *, on_change=lambda job: None) -> Job:
    """Run whichever phase this job is.

    The single entry point the poller uses. `run_job` below remains the
    whole of production in one pass, for the CLI and the job API.
    """
    if job.kind is JobKind.MASTER:
        return run_master_job(job, store, on_change=on_change)
    if job.kind is JobKind.FORMATS:
        return run_formats_job(job, store, on_change=on_change)
    if job.kind is JobKind.COVER:
        return run_cover_job(job, store, on_change=on_change)
    return run_job(job, store, on_change=on_change)


def _load_input(job: Job, store: ObjectStore, work: Path) -> Document:
    """Phase 1's input, from whichever place it came.

    Two doors into the same room. A scanned book arrives as OCR text the
    web application already paid Google to produce; a DOCX or plain text
    upload needed no OCR and arrives as itself. CLAUDE.md section 6.1
    requires both to converge on the same master with no second-class
    path, which is exactly what returning one `Document` means.
    """
    if job.ocr_key:
        local = work / "ocr.json"
        store.download(job.ocr_key, local)
        content = local.read_text(encoding="utf-8")
        document = read_ocr_json(content=content, title=job.title, author=job.author)
        # The engine counted every page, including the blank ones this
        # document does not carry. That count is the book's real length
        # and what its price is derived from.
        job.page_count = page_count_of(content)
        return document

    source = work / Path(job.source_key).name
    store.download(job.source_key, source)
    return load_source(source, title=job.title, author=job.author, cache_dir=work / "cache")


def _render_pdf(document: Document, master: Path, path: Path) -> Path:
    """The book's one PDF, by whichever route preserves the most.

    LibreOffice first, because it renders the DOCX's own layout. Falling
    back rather than failing when it is absent: a developer without
    LibreOffice installed should still get a book out of the CLI, and a
    PDF in our typography is a far better outcome than no PDF and a
    failed job.
    """
    try:
        return docx_to_pdf(master, path)
    except LibreOfficeUnavailable:
        log.warning("LibreOffice not available; rendering the PDF from the parsed document")
        return build_pdf(document, path)


def run_master_job(job: Job, store: ObjectStore | None, *, on_change=lambda job: None) -> Job:
    """Phase 1: build the DOCX master and stop.

    Deliberately produces nothing else. The master is the source of
    truth (CLAUDE.md section 5) and an editor may correct it before any
    reader-facing format is generated — so generating formats here would
    be building them from text nobody has looked at yet.
    """
    try:
        with tempfile.TemporaryDirectory(prefix=f"noblesee-{job.id}-") as tmp:
            work = Path(tmp)
            if store is None:
                raise RuntimeError("object storage is not configured")

            job.advance(JobState.NORMALIZING)
            on_change(job)
            document = _load_input(job, store, work)

            if job.allow_third_party_ai:
                # Suggestions only. Nothing is applied without a human,
                # so the job does not wait here.
                job.advance(JobState.AI_PROCESSING)
                on_change(job)

            job.advance(JobState.DOCX_GENERATION)
            on_change(job)
            master = build_docx(document, work / "master.docx")

            key = artifact_key(job.book_id or job.id, ARTIFACT_FILENAMES["docx"])
            store.upload(master, key, content_type=CONTENT_TYPES.get(master.suffix))
            job.artifacts["docx"] = key

            job.advance(JobState.COMPLETED)
            on_change(job)
            return job

    except Exception as error:  # noqa: BLE001 — a job must never take the worker down
        log.exception("master job %s failed", job.id)
        job.advance(JobState.FAILED, error=_readable(error))
        on_change(job)
        return job


def run_formats_job(job: Job, store: ObjectStore | None, *, on_change=lambda job: None) -> Job:
    """Phase 2: build the reader-facing formats from the master.

    Reads the DOCX and nothing else. That is the rule the whole two-phase
    split exists to enforce — CLAUDE.md section 5 says formats are
    generated from the approved master, so reading the original source
    here would silently discard every correction an editor made.

    Cheap enough to re-run on every edit, which is what makes the master
    genuinely editable rather than nominally so.
    """
    try:
        with tempfile.TemporaryDirectory(prefix=f"noblesee-{job.id}-") as tmp:
            work = Path(tmp)
            if store is None:
                raise RuntimeError("object storage is not configured")
            if not job.master_key:
                raise RuntimeError("this book has no DOCX master to build from")

            job.advance(JobState.NORMALIZING)
            on_change(job)

            master = work / "master.docx"
            store.download(job.master_key, master)
            document = load_source(master, title=job.title, author=job.author)

            job.advance(JobState.FORMAT_GENERATION)
            on_change(job)

            wanted = _wanted_formats(job)
            produced: dict[str, Path] = {}

            if "epub" in wanted:
                produced["epub"] = build_epub(document, work / "book.epub", identifier=job.id)

            # One PDF, and which renderer produces it is the whole
            # point. The book's PDF has to mirror the original's own
            # layout; when the original *is* this master — a DOCX
            # upload — that means letting LibreOffice lay out the Word
            # document rather than re-typesetting its text in ours.
            #
            # A master built by this pipeline from a scan or from plain
            # text has no such layout to preserve, so it is rendered
            # through our own typography instead. The web application
            # never asks for a PDF for a book uploaded *as* a PDF: that
            # book's PDF is the file the reader uploaded.
            if "pdf" in wanted:
                produced["pdf"] = _render_pdf(document, master, work / "book.pdf")

            # Always, even when no PDF was built: the count is the book's
            # length and prices it, and it must not depend on which
            # formats happened to be requested.
            job.page_count = page_count(document)

            for fmt, path in produced.items():
                key = artifact_key(job.book_id or job.id, ARTIFACT_FILENAMES[fmt])
                store.upload(path, key, content_type=CONTENT_TYPES.get(path.suffix))
                job.artifacts[fmt] = key

            job.advance(JobState.COMPLETED)
            on_change(job)
            return job

    except Exception as error:  # noqa: BLE001
        log.exception("formats job %s failed", job.id)
        job.advance(JobState.FAILED, error=_readable(error))
        on_change(job)
        return job


def run_cover_job(job: Job, store: ObjectStore | None, *, on_change=lambda job: None) -> Job:
    """Render page one of a finished book as its default cover.

    Neither phase of production, and deliberately nothing like them: it
    reads one artifact the book already has, writes one image, and
    touches no format the reader is given. A book whose cover cannot be
    rendered is still a whole book — the web side records the failure on
    the cover alone and the tile falls back to the title's own first
    character (`apps/web/src/domain/cover.ts`).

    Which artifact to read is decided on the web side, because only that
    side knows what the book has; this runs what it is told.
    """
    try:
        with tempfile.TemporaryDirectory(prefix=f"noblesee-cover-{job.id}-") as tmp:
            work = Path(tmp)
            if store is None:
                raise RuntimeError("object storage is not configured")
            if not job.source_key or not job.cover_key:
                raise RuntimeError("a cover job needs a source and a destination key")

            job.advance(JobState.FORMAT_GENERATION)
            on_change(job)

            source = work / Path(job.source_key).name
            store.download(job.source_key, source)

            cover = render_cover(
                source,
                job.source_format or Path(job.source_key).suffix.lstrip("."),
                work / "cover.jpg",
            )
            store.upload(cover, job.cover_key, content_type=CONTENT_TYPES[".jpg"])
            job.cover = job.cover_key

            job.advance(JobState.COMPLETED)
            on_change(job)
            return job

    except CoverUnavailable as reason:
        # An ordinary outcome, not a broken converter: an EPUB with no
        # declared cover is a valid EPUB. Logged at info so a run of them
        # does not read as a service in trouble.
        log.info("book %s has no cover to render: %s", job.book_id, reason)
        job.advance(JobState.FAILED, error=_readable(reason))
        on_change(job)
        return job

    except Exception as error:  # noqa: BLE001
        log.exception("cover job %s failed", job.id)
        job.advance(JobState.FAILED, error=_readable(error))
        on_change(job)
        return job


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
            pdf_path = _render_pdf(document, master, work / "book.pdf")
            job.page_count = page_count(document)

            produced = {"docx": master, "epub": epub_path, "pdf": pdf_path}
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
