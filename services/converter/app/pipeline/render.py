"""What a PDF's pages are made of, and the outline when it carries one.

This rasterized pages for the OCR engine until 2026-08-26. Both are
gone: reading a scan is Adobe's Export PDF, called from the web
application, and nothing local needs a picture of a page any more —
covers are rendered in the browser (CLAUDE.md section 5). What is left
is classification, which is cheap and is what decides whether this
service can read a given PDF at all.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pymupdf


@dataclass(frozen=True)
class OutlineEntry:
    level: int
    title: str
    page: int  # 0-based page index


@dataclass(frozen=True)
class PageSources:
    """Where each page's text has to come from.

    A book is not all one thing. A scanned volume routinely carries a
    born-digital title page or colophon, and a born-digital book carries
    blank versos and plates. So the question "does this PDF have a text
    layer" has no useful answer at the document level, and answering it
    there was doing real damage: `has_text_layer` sampled ~40 pages and
    returned true if *any* of them had text, after which the whole book
    was read through the text-layer path — and every scanned page, having
    no text to extract, contributed nothing at all. A 400-page scan with
    a digital title page converted successfully into a one-page book.

    Classifying per page fixes that, and pays for itself twice over:
    OCR is the only expensive stage in the pipeline, so the pages that
    already carry exact text are pages nobody has to rasterize, read or
    pay for.
    """

    #: Pages whose own text layer is exact. Extracted, never OCR'd.
    text: tuple[int, ...]
    #: Pages that must be rasterized and read. The expensive ones.
    ocr: tuple[int, ...]
    #: Pages carrying neither text nor image — nothing to recover.
    blank: tuple[int, ...]

    @property
    def total(self) -> int:
        return len(self.text) + len(self.ocr) + len(self.blank)


def classify_pages(pdf_path: Path, pages: list[int] | None = None) -> PageSources:
    """Decide, page by page, how each page's text must be recovered.

    Every page is examined — no sampling. Reading a page's text objects
    is cheap next to rasterizing it, and next to OCR it is free, so the
    only thing sampling ever bought was the bug described above.

    A page with no text but with an image is a scan and needs OCR. A page
    with neither is blank: a chapter verso or a spacer, which OCR would
    read for several seconds in order to return nothing. Vector art with
    no image XObject is the one shape this misreads as blank, and it is
    not a shape scanners produce.
    """
    text: list[int] = []
    ocr: list[int] = []
    blank: list[int] = []

    with pymupdf.open(pdf_path) as doc:
        wanted = pages if pages is not None else range(doc.page_count)
        for index in wanted:
            page = doc[index]
            # One parse, both answers: `dict` carries text spans and image
            # blocks alike, so this does not walk the page twice.
            data = page.get_text("dict")
            blocks = data.get("blocks", [])
            has_text = any(
                span.get("text", "").strip()
                for block in blocks
                if block.get("type") == 0
                for line in block.get("lines", [])
                for span in line.get("spans", [])
            )
            if has_text:
                text.append(index)
            elif any(block.get("type") == 1 for block in blocks) or page.get_images():
                ocr.append(index)
            else:
                blank.append(index)

    return PageSources(text=tuple(text), ocr=tuple(ocr), blank=tuple(blank))


def read_outline(pdf_path: Path) -> list[OutlineEntry]:
    with pymupdf.open(pdf_path) as doc:
        return [
            OutlineEntry(level=lvl, title=title.strip(), page=page - 1)
            for lvl, title, page in doc.get_toc()
            if page > 0
        ]
