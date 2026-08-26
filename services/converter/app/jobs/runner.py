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
from ..sources.load import load_source
from ..sources.ocr_json import page_count_of, read_ocr_json
from ..storage.r2 import CONTENT_TYPES, ObjectStore, artifact_key
from .model import Job, JobKind, JobState

log = logging.getLogger(__name__)

# Filenames inside `books/{id}/book/`, matching what the catalog seeds.
#
# No `pdf`. Nothing here renders one: a PDF's job in this library is to
# be a faithful picture of the *original*, so it exists only when the
# original is a PDF, in which case it is that file and needs no
# rendering (CLAUDE.md section 11).
ARTIFACT_FILENAMES = {
    "docx": "master.docx",
    "epub": "book.epub",
}

# What phase 2 builds when the caller does not say. One format, which
# makes this list look redundant — it is kept because the *shape* of the
# job protocol has a format list in it, and a second reader format is a
# plausible future (section 12) rather than an impossible one.
ALL_READER_FORMATS = ("epub",)


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
    if job.kind is JobKind.CORRECT:
        return run_correct_job(job, store, on_change=on_change)
    if job.kind is JobKind.APPLY:
        return run_apply_job(job, store, on_change=on_change)
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


def _read_master(job: Job, store: ObjectStore, work: Path) -> Document:
    """The master, read back as a Document.

    Heading levels survive the round trip — `Heading 1` and `Heading 2`
    map back to CHAPTER and SECTION in `sources/docx_in.py` — which is
    what makes a corrected master come back as the same book rather than
    as flat prose.
    """
    from ..sources.docx_in import read_docx

    if not job.master_key:
        raise RuntimeError("no master to read: this job carries no master_key")
    local = work / "master.docx"
    store.download(job.master_key, local)
    document = read_docx(local, title=job.title)
    # `build_docx` stamps the author into the core properties and
    # `read_docx` reads it back, so this only fires for a master written
    # by something else — an uploader's own Word file, most likely.
    if not document.author and job.author:
        document.author = job.author
    return document


def run_correct_job(job: Job, store: ObjectStore | None, *, on_change=lambda job: None) -> Job:
    """Propose corrections to the master. Change nothing.

    The output is a suggestions file for a person to read, which is what
    CLAUDE.md section 7 requires: original, proposal, reason, confidence,
    and a human approval that has not happened yet. Every proposal has
    already been through the deterministic guardrails in `llm.correct`
    before it reaches the file, so what a reviewer sees has survived
    "is this a correction or a rewrite?" without being asked politely.

    Refusing outright when consent is absent is deliberate. The flag is
    the reader's answer to a question about their own book, and a job
    that quietly proceeded without it would make the checkbox a lie.
    """
    import json

    from ..llm.client import LlmConfig, get_client
    from ..llm.correct import suggest_corrections
    from ..serialize import suggestion_to_dict

    try:
        with tempfile.TemporaryDirectory(prefix=f"noblesee-{job.id}-") as tmp:
            work = Path(tmp)
            if store is None:
                raise RuntimeError("object storage is not configured")
            if not job.allow_third_party_ai:
                raise RuntimeError(
                    "this book has not been cleared to go to a third-party model; "
                    "correction needs the uploader's own answer, not a default"
                )

            job.advance(JobState.NORMALIZING)
            on_change(job)
            document = _read_master(job, store, work)

            job.advance(JobState.AI_PROCESSING)
            on_change(job)
            config = LlmConfig.from_env()
            client = get_client(config)
            try:
                report = suggest_corrections(document, client)
            finally:
                client.close()

            payload = {
                "title": document.title,
                "model": f"{config.provider}:{config.model}",
                "how_to_review": (
                    "Nothing here has been applied. Each suggestion is a proposal "
                    "about one line of the master; adopting one rewrites that line "
                    "and rebuilds the reading edition."
                ),
                "suggestions": [suggestion_to_dict(s) for s in report.suggestions],
                "refused": [
                    {
                        "block": r.block,
                        "line": r.line,
                        "original": r.original,
                        "suggested": r.suggested,
                        "model_reason": r.reason,
                        "rejected_because": r.rejected_because,
                    }
                    for r in report.rejected
                ],
            }
            local = work / "suggestions.json"
            local.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )

            # Beside the book but not among its artifacts: this is never
            # served to a reader and never delivered to a device.
            key = artifact_key(job.book_id or job.id, "suggestions.json")
            store.upload(local, key, content_type="application/json")
            job.suggestions_key = key
            job.suggestion_count = len(report.suggestions)

            # HUMAN_REVIEW, not COMPLETED. The job is done; the *stage*
            # is waiting on a person, and saying so is the whole point of
            # having that state in the vocabulary.
            job.advance(JobState.HUMAN_REVIEW)
            on_change(job)
            return job

    except Exception as error:  # noqa: BLE001 — a job must never take the worker down
        log.exception("correct job %s failed", job.id)
        job.advance(JobState.FAILED, error=_readable(error))
        on_change(job)
        return job


def run_apply_job(job: Job, store: ObjectStore | None, *, on_change=lambda job: None) -> Job:
    """Rewrite the master from what a person adopted.

    Only what they adopted. `apply_suggestions` ignores anything without
    `approved` set true, and refuses any line whose text has moved on
    since the suggestion was made — so an edit to the master between the
    proposal and the decision costs that one line rather than silently
    overwriting the newer text.

    The result is an ordinary master edit: a new DOCX under the same key,
    reported as the `docx` artifact, which returns the book to
    `master_ready` and has phase 2 rebuild the reading edition from the
    corrected text.
    """
    from ..llm.apply import apply_suggestions
    from ..serialize import read_suggestions

    try:
        with tempfile.TemporaryDirectory(prefix=f"noblesee-{job.id}-") as tmp:
            work = Path(tmp)
            if store is None:
                raise RuntimeError("object storage is not configured")
            if not job.decisions_key:
                raise RuntimeError("no decisions to apply: this job carries no decisions_key")

            job.advance(JobState.NORMALIZING)
            on_change(job)
            document = _read_master(job, store, work)

            decisions_path = work / "decisions.json"
            store.download(job.decisions_key, decisions_path)
            decisions = read_suggestions(decisions_path)

            report = apply_suggestions(document, decisions)
            for suggestion, current in report.drifted:
                log.warning(
                    "book %s: skipped block %s line %s — the master now reads %r",
                    job.book_id,
                    suggestion.block,
                    suggestion.line,
                    current,
                )
            if not report.applied:
                # Not a failure. Nothing adopted, or everything drifted;
                # either way the master is already what it should be, and
                # reporting no artifact leaves it exactly as it stands.
                job.advance(JobState.COMPLETED)
                on_change(job)
                return job

            job.advance(JobState.DOCX_GENERATION)
            on_change(job)
            master = build_docx(document, work / "master.docx", author=document.author)

            key = artifact_key(job.book_id or job.id, ARTIFACT_FILENAMES["docx"])
            store.upload(master, key, content_type=CONTENT_TYPES.get(master.suffix))
            job.artifacts["docx"] = key

            log.info("book %s: applied %s corrections", job.book_id, len(report.applied))
            job.advance(JobState.COMPLETED)
            on_change(job)
            return job

    except Exception as error:  # noqa: BLE001 — a job must never take the worker down
        log.exception("apply job %s failed", job.id)
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

            # No page count is reported any more. It used to be the
            # number of pages WeasyPrint produced laying this document
            # out, which is gone with the renderer — and a page was
            # always a fact about *our* typesetting rather than about the
            # book. The web application prices from its own estimate
            # instead: the PDF page tree for a scan, characters for
            # everything else (`domain/uploadQuota.ts`).

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

            produced = {"docx": master, "epub": epub_path}
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
