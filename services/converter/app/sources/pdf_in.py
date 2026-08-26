"""PDF → Document, for the pages a PDF can answer for itself.

**There is no OCR here any more.** Reading a scan is Adobe's Export PDF
operation, called from the web application (`domain/adobe.ts`), which
returns a finished DOCX master rather than text to be reassembled. The
PaddleOCR backend and the whole `app/ocr` abstraction behind it are
gone: a second OCR engine that nothing called was a model download, a
native toolchain and a container to run them in, kept against the
possibility of not using Adobe.

What remains is the case Adobe was never needed for: a PDF that already
carries its own text. That costs nothing, needs no network and no model,
and is exact — OCR could only degrade it.

A PDF is still read **page by page**, and that matters more here than it
did when there was a fallback:

    page carries text  ──  extracted exactly, no cost
    page is an image   ──  nothing here can read it
    page is empty      ──  skipped entirely

A book with any image page is refused outright, because the alternative
is the bug this classification was written to fix: the document-level
test it replaced sampled ~40 pages and asked whether *any* of them had
text, so a 400-page scan with one born-digital title page was read
through the text path and converted "successfully" into a one-page book.
Every scanned page yielded nothing and vanished. Refusing is the honest
answer, and the message says where such a book goes instead.

The layout problem is identical whichever way text arrived — positioned
fragments grouped into lines, classified into verse, prose, footnotes
and attributions by where they sit — so this still feeds the same
structure pass. Normalization is the one thing switched off: those rules
repair what an OCR engine got wrong, and over exact text they would be
editing the author (`OcrPage.exact`).
"""

from __future__ import annotations

from pathlib import Path

from ..models import Box, Document, OcrPage, OcrSpan
from ..pipeline.render import PageSources, classify_pages, read_outline
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


def plan_pages(pdf_path: Path, pages: list[int] | None = None) -> PageSources:
    """Which pages carry their own text, which cannot be read, which are
    empty.

    Separated from `read_pdf` so a caller can say what is about to happen
    before any of it happens. The CLI prints it; the refusal below is
    built from it.
    """
    return classify_pages(pdf_path, pages)


def read_pdf(
    pdf_path: Path,
    *,
    title: str | None = None,
    author: str | None = None,
    pages: list[int] | None = None,
    on_stage=lambda name: None,
) -> tuple[Document, StructureReport, PageSources]:
    """Structure a PDF that carries its own text, or refuse it.

    Refusing is not a failure of this module — it is the boundary. A
    scanned page has to be *read*, and reading pages is Adobe's, from the
    web application. Nothing local can do it, so nothing local pretends
    to.
    """
    sources = plan_pages(pdf_path, pages)

    if sources.ocr:
        raise UnsupportedSource(
            f"{pdf_path.name} has no text layer on {len(sources.ocr)} of its "
            f"{sources.total} pages, so those pages have to be read rather than "
            "extracted. Scans are mastered by Adobe's Export PDF from the web "
            "application; there is no local OCR."
        )

    on_stage("reading pdf text")
    read: list[OcrPage] = extract_pages(pdf_path, list(sources.text))

    document, report = build_document(read, read_outline(pdf_path), title or pdf_path.stem)
    document.author = author
    return document, report, sources
