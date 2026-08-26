"""Every accepted input, converging on one DOCX master.

    text-layer PDF ─ extract ───┐
    DOCX ─────────── styles ────┼──> Document ──> DOCX master
    plain text ───── paragraphs ┘

A scan is not on that list. It is read by Adobe's Export PDF from the
web application, which returns the master directly.

The DOCX master is the source of truth (CLAUDE.md section 5), so this is
the only entry the rest of the pipeline needs: correction, review and —
once they exist — EPUB and PDF generation all start from a `Document`
and know nothing about where it came from.

Everything here is near-instant, which is why there is only one command
for it now. `convert` was a separate command for the OCR path — hours of
work, a cache to preserve, progress to report — and went with the OCR.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ..models import Document
from .detect import SourceKind, UnsupportedSource, detect

__all__ = [
    "SourceKind",
    "UnsupportedSource",
    "detect",
    "load_source",
    "SourceResult",
]


@dataclass
class SourceResult:
    document: Document
    kind: SourceKind
    # Set only for the paths that run the geometric structure pass; a
    # DOCX or text file has nothing to report about page furniture.
    notes: list[str] = field(default_factory=list)
    structure_report: object | None = None


def load_source(
    path: Path,
    *,
    title: str | None = None,
    author: str | None = None,
    kind: SourceKind | None = None,
) -> SourceResult:
    """Read any supported input into a `Document`.

    A PDF with any page that has no text layer is refused, and refused
    over a *single* such page in an otherwise born-digital book — that
    page is the book's content too, and dropping it silently is the
    failure this whole path exists to avoid. Such a book is mastered by
    Adobe from the web application instead.
    """
    kind = kind or detect(path)

    if kind in (SourceKind.PDF_TEXT, SourceKind.PDF_SCANNED):
        from .pdf_in import read_pdf

        document, report, sources = read_pdf(path, title=title, author=author)
        notes = [
            f"{len(sources.text)} of {sources.total} pages read from the text layer"
            + (f", {len(sources.blank)} blank" if sources.blank else ""),
            f"{len(report.dropped_furniture)} running-head lines dropped",
            "punctuation normalization skipped — the text layer is exact",
        ]
        return SourceResult(
            document=document, kind=kind, notes=notes, structure_report=report
        )

    if kind is SourceKind.DOCX:
        from .docx_in import read_docx

        document = read_docx(path, title=title)
        if author:
            document.author = author
        return SourceResult(document=document, kind=kind)

    if kind is SourceKind.TEXT:
        from .text import read_text

        document = read_text(path, title=title)
        document.author = author
        return SourceResult(
            document=document,
            kind=kind,
            notes=[
                "structure inferred from blank lines only — verse and headings "
                "should be marked up in the DOCX master by an editor"
            ],
        )

    raise UnsupportedSource(f"no reader for {kind}")
