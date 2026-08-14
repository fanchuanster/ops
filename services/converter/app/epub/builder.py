"""EPUB 3 from a reconstructed Document.

EPUB is the primary format (CLAUDE.md section 10) because it is the one
that reflows: the *device* picks the font size, the margins and the line
spacing, and a book that fights that is a PDF wearing a different
extension. So this builder deliberately sets no page size, no font size
and no measure — only the structural typography that would be wrong to
lose, like verse line breaks.

One XHTML document per chapter rather than one per book. It gives the
reader a real table of contents to navigate by, and it keeps any single
document small enough that a cheap e-reader can paginate it without
stalling.
"""

from __future__ import annotations

from pathlib import Path

from ebooklib import epub

from ..models import Document
from ..render.html import BOOK_CSS, chapter_html, chapters


def build_epub(document: Document, path: Path, *, identifier: str | None = None) -> Path:
    book = epub.EpubBook()
    book.set_identifier(identifier or f"noblesee-{abs(hash(document.title)):x}")
    book.set_title(document.title)
    # Traditional Chinese unless we are told otherwise. Getting this
    # wrong makes a reader pick Japanese glyph forms for shared
    # characters, which looks subtly wrong on every page.
    book.set_language("zh-Hant")
    if document.author:
        book.add_author(document.author)

    style = epub.EpubItem(
        uid="style",
        file_name="style/noblesee.css",
        media_type="text/css",
        content=BOOK_CSS,
    )
    book.add_item(style)

    grouped = chapters(document)
    documents = []
    for index, (title, blocks) in enumerate(grouped, start=1):
        opening = ""
        if index == 1:
            opening = f"<h1>{_escape(document.title)}</h1>"
            if document.author:
                opening += f'<p class="byline">{_escape(document.author)}</p>'

        item = epub.EpubHtml(title=title, file_name=f"chapter-{index}.xhtml", lang="zh-Hant")
        item.content = (
            f"<html><head><title>{_escape(title)}</title></head>"
            f"<body>{chapter_html(title, blocks, opening=opening)}</body></html>"
        )
        item.add_item(style)
        book.add_item(item)
        documents.append(item)

    book.toc = tuple(
        epub.Link(item.file_name, title, f"ch{index}")
        for index, (item, (title, _)) in enumerate(zip(documents, grouped), start=1)
    )
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())

    # The text is the first page, not the table of contents. The nav
    # document stays in the manifest — EPUB 3 requires it, and it is what
    # feeds the reader's chapter list — it just is not where the book
    # opens. Landing a reader on a contents page is a small insult
    # repeated every time they open the book.
    book.spine = documents

    path.parent.mkdir(parents=True, exist_ok=True)
    epub.write_epub(str(path), book, {})
    return path


def _escape(value: str) -> str:
    from html import escape

    return escape(value)
