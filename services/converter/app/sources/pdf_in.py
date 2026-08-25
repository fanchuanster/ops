"""PDF → Document, one page at a time.

A PDF is not one kind of thing all the way through. A scanned volume
routinely carries a born-digital title page, a colophon or an index; a
born-digital book carries blank versos and full-page plates. So the way a
page's text has to be recovered is a property of the page, and this
module reads each one the way it needs to be read:

    page carries text  ──  extracted exactly, no OCR, no cost
    page is an image   ──  rasterized and read by the OCR engine
    page is empty      ──  skipped entirely

Everything then merges back into one `list[OcrPage]` in page order and
goes through the same structure pass, because the *layout* problem is
identical whichever way the text arrived — positioned fragments that have
to be grouped into lines and classified into verse, prose, footnotes and
attributions by where they sit on the page.

Two things this buys, and the second is the one that matters:

  - **Cost and time.** OCR is the only expensive stage in the pipeline —
    seconds per page, hours per book, and money when it is a hosted
    engine. Pages that already carry exact text are pages nobody pays to
    read. A book that is half born-digital costs half as much.
  - **Correctness.** The document-level test this replaces sampled ~40
    pages and asked whether *any* of them had text. A 400-page scan with
    one digital title page passed that test, was read through the
    text-layer path, and converted "successfully" into a one-page book:
    every scanned page yielded no text and silently contributed nothing.

Normalization follows the page too. The punctuation rules repair what an
OCR engine got wrong; run over exact text they would be editing the
author, so extracted pages are marked `exact` and opt out of them
individually (`OcrPage.exact`).
"""

from __future__ import annotations

from pathlib import Path

from ..models import Box, Document, OcrPage, OcrSpan
from ..pipeline.render import PageSources, classify_pages, read_outline, render_pages
from ..pipeline.structure import StructureReport, build_document
from .detect import UnsupportedSource


def extract_pages(pdf_path: Path, pages: list[int] | None = None) -> list[OcrPage]:
    """Read a text-layer PDF into the same shape the OCR engine produces.

    PyMuPDF spans are presented as `OcrSpan`s at confidence 1.0, so
    everything downstream — line grouping, furniture stripping, the
    geometry rules — works unchanged on them.
    """
    import pymupdf

    out: list[OcrPage] = []
    with pymupdf.open(pdf_path) as doc:
        wanted = pages if pages is not None else range(doc.page_count)
        for index in wanted:
            page = doc[index]
            rect = page.rect
            spans: list[OcrSpan] = []

            data = page.get_text("dict")
            for block in data.get("blocks", []):
                # Type 0 is text; type 1 is an image, which has no text
                # to recover and no bearing on the layout rules.
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        text = span.get("text", "").strip()
                        if not text:
                            continue
                        x0, y0, x1, y1 = span["bbox"]
                        spans.append(
                            OcrSpan(
                                text=text,
                                # Exact text. Confidence is an OCR concept
                                # and there is no uncertainty to express.
                                confidence=1.0,
                                box=Box(x0, y0, x1, y1),
                            )
                        )

            out.append(
                OcrPage(
                    index=index,
                    # The structure rules are all fractions of the page
                    # box, so points serve exactly as pixels did.
                    width=int(rect.width),
                    height=int(rect.height),
                    spans=spans,
                    # This text came off the page itself, not off a
                    # picture of it. Nothing may "correct" it.
                    exact=True,
                )
            )

    return out


def plan_pages(
    pdf_path: Path,
    pages: list[int] | None = None,
    *,
    force_ocr: bool = False,
) -> PageSources:
    """Which pages will be extracted, read and skipped.

    Separated from `read_pdf` so a caller can say what is about to happen
    — and how long it will take — before any of it happens. The CLI
    prints it; the refusal below is built from it.

    `force_ocr` sends every page to the engine, blank ones included. It
    means "the embedded text is wrong", and a caller who believes that
    has no reason to trust this classification either.
    """
    if force_ocr:
        import pymupdf

        with pymupdf.open(pdf_path) as doc:
            every = list(pages if pages is not None else range(doc.page_count))
        return PageSources(text=(), ocr=tuple(every), blank=())
    return classify_pages(pdf_path, pages)


def read_pdf(
    pdf_path: Path,
    *,
    title: str | None = None,
    author: str | None = None,
    cache_dir: Path | None = None,
    engine: str | None = None,
    dpi: int = 300,
    pages: list[int] | None = None,
    force_ocr: bool = False,
    on_stage=lambda name: None,
    on_page=None,
) -> tuple[Document, StructureReport, PageSources]:
    """Structure any PDF, OCR'ing only the pages that need it.

    `engine` is a name rather than an engine because constructing one
    loads a model into memory, and a PDF that turns out to need no OCR
    must not pay for that. `None` means the caller cannot run OCR at all;
    a book needing it is then refused rather than half-read, which is the
    distinction `converter import` relies on (OCR takes hours and belongs
    to `converter convert`).
    """
    sources = plan_pages(pdf_path, pages, force_ocr=force_ocr)

    if sources.ocr and engine is None:
        raise UnsupportedSource(
            f"{pdf_path.name} needs OCR for {len(sources.ocr)} of its "
            f"{sources.total} pages, which takes hours rather than milliseconds. "
            "Use `converter convert` for that — it caches the read and reports "
            "progress."
        )

    read: list[OcrPage] = []

    if sources.text:
        on_stage("reading pdf text")
        read.extend(extract_pages(pdf_path, list(sources.text)))

    if sources.ocr:
        on_stage("ocr")
        from ..ocr.base import get_engine
        from ..pipeline.ocr_pass import ocr_pages

        work = cache_dir or pdf_path.parent / "cache"
        # Only the pages that need reading are rendered. Rasterizing a
        # page at 300dpi is not free either, and a page whose text we
        # already have exactly is a page there is nothing to look at.
        images = render_pages(pdf_path, work / "pages", dpi=dpi, pages=list(sources.ocr))
        read.extend(
            ocr_pages(
                images,
                get_engine(engine),
                work / "ocr",
                indices=list(sources.ocr),
                on_page=on_page,
            )
        )

    # Back into page order. The two readers ran in whatever order was
    # convenient; the book has only one.
    read.sort(key=lambda page: page.index)

    document, report = build_document(read, read_outline(pdf_path), title or pdf_path.stem)
    document.author = author
    return document, report, sources
