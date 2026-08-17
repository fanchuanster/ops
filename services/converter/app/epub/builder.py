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
from ..render.html import BOOK_CSS, chapter_html, chapters, sections


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

    # Two levels deep where the book has two. A chapter with section
    # heads gets them as children, so a reader navigating a four-hundred
    # page classic lands on the passage rather than at the top of the
    # chapter containing it — which is the whole difference between a
    # table of contents and a list of files.
    book.toc = tuple(
        _entry(item, index, title, blocks)
        for index, (item, (title, blocks)) in enumerate(zip(documents, grouped), start=1)
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


def _entry(item, index: int, title: str, blocks):
    """One chapter's table-of-contents entry, with its sections under it.

    A bare Link when the chapter has no section heads, rather than a
    parent with an empty child list: some readers draw a disclosure
    arrow for anything that could have children, and an arrow opening
    onto nothing is a small lie told on every chapter of most books.
    """
    link = epub.Link(item.file_name, title, f"ch{index}")
    children = [
        epub.Link(f"{item.file_name}#{anchor}", text, f"ch{index}-{anchor}")
        for anchor, text in sections(blocks)
    ]
    return (link, children) if children else link


def _escape(value: str) -> str:
    from html import escape

    return escape(value)
