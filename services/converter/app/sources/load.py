"""One way in, whatever the reader uploaded.

The portal accepts a scanned PDF, a born-digital PDF, a DOCX or plain
text, and CLAUDE.md section 6.1 is explicit that all four converge on
the same DOCX master with no second-class path. This module is where
that convergence actually happens: it picks the right reader and hands
back a `Document`, so the job runner does not need a branch per format.

None of them costs anything to speak of. Reading a *scan* did, and it
is no longer here: Adobe's Export PDF returns a finished master from the
web application, so what reaches this module is only ever a file that
can be parsed. `on_stage` remains because the caller still wants to name
what it is doing, not because anything here takes minutes.
"""

from __future__ import annotations

from pathlib import Path

from ..models import Document
from .detect import SourceKind, UnsupportedSource, detect


def load_source(
    path: Path,
    *,
    title: str | None = None,
    author: str | None = None,
    cache_dir: Path | None = None,
    on_stage=lambda name: None,
) -> Document:
    kind = detect(path)
    name = title or path.stem

    if kind is SourceKind.DOCX:
        on_stage("reading docx")
        from .docx_in import read_docx

        document = read_docx(path, title=name)
        document.author = author or document.author
        return document

    if kind is SourceKind.TEXT:
        on_stage("reading text")
        from .text import read_text

        document = read_text(path, title=name)
        document.author = author or document.author
        return document

    if kind in (SourceKind.PDF_TEXT, SourceKind.PDF_SCANNED):
        # One reader for both, and it refuses the one it cannot read: a
        # scan is mastered by Adobe from the web application, never here.
        from .pdf_in import read_pdf

        document, _report, _sources = read_pdf(
            path, title=name, author=author, on_stage=on_stage
        )
        return document

    raise UnsupportedSource(f"cannot read {path.name}")
