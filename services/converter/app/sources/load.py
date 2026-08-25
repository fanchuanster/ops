"""One way in, whatever the reader uploaded.

The portal accepts a scanned PDF, a born-digital PDF, a DOCX or plain
text, and CLAUDE.md section 6.1 is explicit that all four converge on
the same DOCX master with no second-class path. This module is where
that convergence actually happens: it picks the right reader and hands
back a `Document`, so the job runner does not need a branch per format.

The one real difference between them is OCR, and it is a difference of
*cost*, not of outcome — a scanned page has to be rasterised and read
before there is any text at all, which is why `on_stage` exists: that
stage takes minutes to hours and a caller needs to say so.

Note "page", not "file". Both PDF kinds go to the same reader, which
decides page by page and OCRs only what it must (`pdf_in.read_pdf`).
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
        # One reader for both. The OCR cache under `cache_dir` is kept
        # because a book takes hours to read and an editor re-running the
        # structure stage must not pay for the OCR again — the same
        # reason the CLI exists (services/converter/README).
        from .pdf_in import read_pdf

        document, _report, _sources = read_pdf(
            path,
            title=name,
            author=author,
            cache_dir=cache_dir or path.parent / "cache",
            engine="paddle",
            on_stage=on_stage,
        )
        return document

    raise UnsupportedSource(f"cannot read {path.name}")
