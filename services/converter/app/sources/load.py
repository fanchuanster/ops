"""One way in, whatever the reader uploaded.

The portal accepts a scanned PDF, a born-digital PDF, a DOCX or plain
text, and CLAUDE.md section 6.1 is explicit that all four converge on
the same DOCX master with no second-class path. This module is where
that convergence actually happens: it picks the right reader and hands
back a `Document`, so the job runner does not need a branch per format.

The one real difference between them is OCR, and it is a difference of
*cost*, not of outcome — a scanned PDF has to be rasterised and read
before there is any text at all, which is why `on_stage` exists: that
stage takes minutes to hours and a caller needs to say so.
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

    if kind is SourceKind.PDF_TEXT:
        on_stage("reading pdf text")
        from .pdf_text import read_pdf_text

        document, _report = read_pdf_text(path, title=name, author=author)
        return document

    if kind is SourceKind.PDF_SCANNED:
        on_stage("ocr")
        return _ocr_pdf(path, name, author, cache_dir or path.parent / "cache")

    raise UnsupportedSource(f"cannot read {path.name}")


def _ocr_pdf(path: Path, title: str, author: str | None, cache_dir: Path) -> Document:
    """The expensive path: rasterise every page, then read it.

    The OCR cache is kept because a book takes hours to read and an
    editor re-running the structure stage must not pay for the OCR
    again — the same reason the CLI exists (services/converter/README).
    """
    from ..ocr.paddle import PaddleOcrEngine
    from ..pipeline.ocr_pass import ocr_pages
    from ..pipeline.render import read_outline, render_pages
    from ..pipeline.structure import build_document

    images = render_pages(path, cache_dir / "pages")
    pages = ocr_pages(images, PaddleOcrEngine(), cache_dir / "ocr")
    document, _report = build_document(pages, read_outline(path), title)
    document.author = author
    return document
