"""One PDF, rendered from the same HTML the EPUB uses.

WeasyPrint rather than Playwright. It takes HTML and CSS and produces a
properly paginated PDF with real page boxes, it needs no browser and no
headless Chromium, and it runs in a container without a display — which
matters because this service is meant to be deployable somewhere small.
Its weakness is CSS coverage, and the CSS here is a page box, a font
stack and margins.

There were three sizes here until 2026-08-20 — standard, large and extra
large — so a reader could pick their typography. That was three answers
to a question the EPUB already answers better, by letting the *device*
set the type size. What a PDF is actually good for is being a faithful
picture of the original, and there is only one of those.

Which means this renderer is no longer the whole story. It produces the
PDF for a source that has no layout of its own to mirror — plain text,
and a DOCX whose own rendering `docx_pdf.py` handles. A book uploaded as
a PDF never comes here at all: its PDF is the file the reader uploaded.
"""

from __future__ import annotations

from pathlib import Path

from weasyprint import HTML

from ..models import Document
from ..render.html import BOOK_CSS, document_html

# Body size in points. A5 at 12pt keeps the measure close to a printed
# book, which is the whole intent now that there is nothing to choose
# between.
BODY_SIZE = 12

# A5 keeps the measure close to a printed book.
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
/* A section head divides a chapter and must not start a page — but it
   must not be the last thing on one either. */
h3 {{ page-break-before: auto; }}
/* A heading stranded at the foot of a page, or one line of a paragraph
   carried over, is the most visible way a generated book looks
   generated. */
h1, h2, h3 {{ page-break-after: avoid; }}
p, .verse {{ orphans: 2; widows: 2; }}
"""


def _html_for(document: Document, size: int) -> str:
    css = _PAGE_CSS.format(size=size) + BOOK_CSS
    return f"<html><head><meta charset='utf-8'><style>{css}</style></head><body>{document_html(document)}</body></html>"


def build_pdf(document: Document, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    HTML(string=_html_for(document, BODY_SIZE)).write_pdf(str(path))
    return path


def page_count(document: Document) -> int:
    """How long the book is — what the credit price is derived from.

    The web application prices a book by the length of its DOCX master,
    but a DOCX carries no reliable page count: pagination is a rendering
    decision and python-docx writes no `<Pages>` property. Laying the
    same content out here answers the same question honestly, and does
    so whether or not a PDF is one of the formats being built.
    """
    return len(HTML(string=_html_for(document, BODY_SIZE)).render().pages)
