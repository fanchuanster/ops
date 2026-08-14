"""PDF in three sizes, rendered from the same HTML the EPUB uses.

WeasyPrint rather than Playwright or LibreOffice. It takes HTML and CSS
and produces a properly paginated PDF with real page boxes, it needs no
browser and no headless Chromium, and it runs in a container without a
display — which matters because this service is meant to be deployable
somewhere small. Its weakness is CSS coverage, and the CSS here is a
page box, a font stack and margins.

The three sizes are the point (CLAUDE.md section 11). A fixed-layout PDF
cannot reflow, so the only way to serve a reader who needs larger type
is to render the book again at a larger size. That is also why none of
this is a substitute for the EPUB.
"""

from __future__ import annotations

from pathlib import Path

from weasyprint import HTML

from ..models import Document
from ..render.html import BOOK_CSS, document_html

# Base body size in points. The names match the artifact formats the web
# application knows about: pdf_standard, pdf_large, pdf_xl.
PDF_VARIANTS: dict[str, int] = {
    "pdf_standard": 12,
    "pdf_large": 16,
    "pdf_xl": 22,
}

# A5 keeps the measure close to a printed book at the standard size.
# Larger variants keep the same page and simply fit less on it, which is
# the honest trade — the alternative is a bigger sheet nobody can hold.
_PAGE_CSS = """
@page {{
  size: A5;
  margin: 2cm 1.8cm;
  @bottom-center {{ content: counter(page); font-size: 9pt; color: #888; }}
}}
body {{
  font-family: "Noto Serif TC", "Source Han Serif TC", "Songti TC",
               "Droid Sans Fallback", Georgia, serif;
  font-size: {size}pt;
  color: #1a1a1a;
}}
/* Chapters start on a fresh page, as they would in print. */
h2 {{ page-break-before: always; }}
h2:first-of-type {{ page-break-before: avoid; }}
/* A heading stranded at the foot of a page, or one line of a paragraph
   carried over, is the most visible way a generated book looks
   generated. */
h1, h2 {{ page-break-after: avoid; }}
p, .verse {{ orphans: 2; widows: 2; }}
"""


def _html_for(document: Document, size: int) -> str:
    css = _PAGE_CSS.format(size=size) + BOOK_CSS
    return f"<html><head><meta charset='utf-8'><style>{css}</style></head><body>{document_html(document)}</body></html>"


def build_pdf(document: Document, path: Path, *, variant: str = "pdf_standard") -> Path:
    if variant not in PDF_VARIANTS:
        raise ValueError(f"unknown PDF variant: {variant}")
    path.parent.mkdir(parents=True, exist_ok=True)
    HTML(string=_html_for(document, PDF_VARIANTS[variant])).write_pdf(str(path))
    return path


def build_all_pdfs(document: Document, directory: Path) -> dict[str, Path]:
    """Every variant, keyed by the artifact format the catalog uses."""
    return {
        variant: build_pdf(document, directory / f"{variant}.pdf", variant=variant)
        for variant in PDF_VARIANTS
    }


def page_count(document: Document) -> int:
    """Pages at the standard size — what the credit price is derived from.

    The web application prices a book by the length of its DOCX master,
    but a DOCX carries no reliable page count: pagination is a rendering
    decision and python-docx writes no `<Pages>` property. The standard
    PDF is rendered from the same content, so its length is the honest
    answer to the same question.
    """
    return len(HTML(string=_html_for(document, PDF_VARIANTS["pdf_standard"])).render().pages)
