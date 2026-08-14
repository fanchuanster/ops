"""One HTML rendering of a Document, used by both EPUB and PDF.

Deliberately shared. EPUB and PDF are the same book set two ways, and
generating them from two hand-written templates is how they drift —
a footnote that renders in one and vanishes in the other is the classic
failure, and it is invisible until a reader hits that page.

The CSS here carries the typography that matters for Chinese text and
is the same in both formats. What differs is only what *must*: the PDF
gets a page box and a font size, the EPUB gets neither because the
device decides (CLAUDE.md section 10 — do not fight the reflow).
"""

from __future__ import annotations

from html import escape

from ..models import Block, BlockKind, Document

# Kept out of the per-format builders so a change lands in both at once.
BOOK_CSS = """
body { line-height: 1.75; }
h1 { font-size: 1.6em; text-align: center; margin: 0 0 .2em; }
h2 { font-size: 1.25em; margin: 1.6em 0 .6em; }
.byline { text-align: center; font-style: italic; color: #555;
          margin: 0 0 2em; }
.marker { font-weight: 600; color: #444; margin: 1.4em 0 .4em; }
/* Verse line breaks are the poem. Never reflow them. */
.verse { white-space: pre-wrap; margin: 1em 0 1em 1.5em; }
.attribution { text-align: right; font-style: italic; color: #555;
               margin: .2em 0 1.4em; }
.footnote { font-size: .85em; color: #666; border-top: 1px solid #ddd;
            padding-top: .4em; margin-top: 1.4em; }
.source-ref { font-size: .85em; color: #888; }
/* Marks a page the OCR pass was unsure of, so a proofreader can find
   it. Invisible in the reader; present in the markup. */
.uncertain { background: rgba(255, 220, 120, .25); }
"""


def _block_html(block: Block) -> str:
    body = escape(block.text)
    uncertain = ' class="uncertain"' if block.confidence < 0.75 else ""
    ref = (
        f'<span class="source-ref">{escape(block.source_ref)}</span>'
        if block.source_ref
        else ""
    )

    if block.kind is BlockKind.CHAPTER:
        return f"<h2{uncertain}>{body}</h2>"
    if block.kind is BlockKind.MARKER:
        return f'<p class="marker"{uncertain}>{body}</p>'
    if block.kind is BlockKind.VERSE:
        # pre-wrap preserves the newlines already in `text`.
        return f'<div class="verse"{uncertain}>{body}</div>'
    if block.kind is BlockKind.ATTRIBUTION:
        return f'<p class="attribution"{uncertain}>{body}</p>'
    if block.kind is BlockKind.FOOTNOTE:
        return f'<p class="footnote"{uncertain}>{body}{ref}</p>'

    # BODY: the printed line breaks were an artifact of the measure, so
    # they are joined into a paragraph and left to reflow.
    return f"<p{uncertain}>{escape(' '.join(block.lines))}{ref}</p>"


def chapters(document: Document) -> list[tuple[str, list[Block]]]:
    """Split the document at CHAPTER blocks.

    A book with no chapter headings is one chapter, which is correct and
    not a special case worth branching on elsewhere: the EPUB builder
    just gets a single-entry list.
    """
    grouped: list[tuple[str, list[Block]]] = []
    for block in document.blocks:
        if block.kind is BlockKind.CHAPTER or not grouped:
            title = block.text if block.kind is BlockKind.CHAPTER else document.title
            grouped.append((title, []))
        grouped[-1][1].append(block)
    return grouped


def document_html(document: Document, *, include_title: bool = True) -> str:
    """The whole book as one HTML body fragment. Used by the PDF path."""
    head = ""
    if include_title:
        head = f"<h1>{escape(document.title)}</h1>"
        if document.author:
            head += f'<p class="byline">{escape(document.author)}</p>'

    return f"<article>{head}{''.join(_block_html(b) for b in document.blocks)}</article>"


def chapter_html(title: str, blocks: list[Block], *, opening: str = "") -> str:
    """One chapter as an HTML body fragment. Used by the EPUB path."""
    rendered = "".join(_block_html(b) for b in blocks)
    # A CHAPTER block renders its own <h2>, so adding the title again
    # would print it twice.
    heading = "" if blocks and blocks[0].kind is BlockKind.CHAPTER else f"<h2>{escape(title)}</h2>"
    return f"<article>{opening}{heading}{rendered}</article>"
