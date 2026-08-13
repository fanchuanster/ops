"""Born-digital PDF → Document, without OCR.

A PDF that already carries a text layer must never be sent through OCR:
the embedded text is exact, and OCR can only degrade it. But the *layout*
problem is identical to the scanned case — text arrives as positioned
fragments that have to be grouped into lines, and lines classified into
verse, prose, footnotes and attributions by where they sit on the page.

So this reuses the structure pass rather than reimplementing it. PyMuPDF
spans are presented as `OcrSpan`s at confidence 1.0, and everything
downstream — line grouping, furniture stripping, the geometry rules —
works unchanged. The one thing that is switched off is normalization:
those rules exist to repair what an OCR engine got wrong about
punctuation, and applying them to exact text would be editing the author.
"""

from __future__ import annotations

from pathlib import Path

from ..models import Box, OcrPage, OcrSpan
from ..pipeline.render import OutlineEntry


def extract_pages(pdf_path: Path, pages: list[int] | None = None) -> list[OcrPage]:
    """Read a text-layer PDF into the same shape the OCR engine produces."""
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
                )
            )

    return out


def read_pdf_text(
    pdf_path: Path,
    title: str | None = None,
    author: str | None = None,
    pages: list[int] | None = None,
):
    """Structure a born-digital PDF. Returns `(Document, StructureReport)`."""
    from ..pipeline.render import read_outline
    from ..pipeline.structure import build_document

    ocr_pages = extract_pages(pdf_path, pages)
    outline: list[OutlineEntry] = read_outline(pdf_path)

    doc, report = build_document(
        ocr_pages,
        outline,
        title or pdf_path.stem,
        # The text is exact; the punctuation repair rules have nothing to
        # repair and would only edit the author.
        normalize=False,
    )
    doc.author = author
    return doc, report
