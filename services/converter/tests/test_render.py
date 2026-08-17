"""Tests for the shared HTML rendering and the EPUB it feeds.

EPUB is the primary format (CLAUDE.md section 10), and the thing that
makes it a book rather than a long scroll is navigation. So most of what
is checked here is the table of contents: that its entries point at
places that exist, and that its shape follows the book's.

The other property under test is that EPUB and PDF are rendered from one
HTML. They are the same book set two ways, and a footnote that appears in
one and vanishes in the other is invisible until a reader reaches that
page.
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.epub import build_epub  # noqa: E402
from app.models import Block, BlockKind, Document  # noqa: E402
from app.render.html import chapter_html, chapters, document_html, sections  # noqa: E402


def block(kind: BlockKind, text: str) -> Block:
    return Block(kind=kind, lines=[text], page=1)


def book() -> Document:
    return Document(
        title="論語別裁",
        author="南懷瑾",
        blocks=[
            block(BlockKind.CHAPTER, "學而第一"),
            block(BlockKind.SECTION, "一、學問的目的"),
            block(BlockKind.BODY, "子曰：學而時習之，不亦說乎。"),
            block(BlockKind.SECTION, "二、朋友之道"),
            block(BlockKind.BODY, "有朋自遠方來，不亦樂乎。"),
            block(BlockKind.CHAPTER, "為政第二"),
            block(BlockKind.BODY, "為政以德，譬如北辰。"),
        ],
    )


# --------------------------------------------------------------------------
# Section anchors
# --------------------------------------------------------------------------


def test_every_anchor_the_contents_uses_exists_in_the_chapter():
    """The one invariant holding the table of contents together.

    `sections` and the renderer number section heads independently, and a
    disagreement between them is a contents entry that lands nowhere —
    which a reader only discovers by tapping it.
    """
    for title, blocks in chapters(book()):
        html = chapter_html(title, blocks)
        for anchor, _ in sections(blocks):
            assert f'id="{anchor}"' in html


def test_anchors_are_unique_within_a_single_document():
    # The PDF is one HTML document for the whole book, so numbering that
    # restarted per chapter would repeat ids across it.
    html = document_html(book())
    assert html.count('id="sec-1"') == 1
    assert html.count('id="sec-2"') == 1


def test_a_chapter_head_needs_no_anchor():
    # It is its own EPUB document; the file name is the address.
    html = chapter_html("學而第一", [block(BlockKind.CHAPTER, "學而第一")])
    assert "id=" not in html


def test_a_section_renders_below_a_chapter_not_beside_it():
    html = document_html(book())
    assert "<h2>學而第一</h2>" in html
    assert '<h3 id="sec-1">一、學問的目的</h3>' in html


# --------------------------------------------------------------------------
# Splitting
# --------------------------------------------------------------------------


def test_the_book_splits_at_chapters_and_not_at_sections():
    """A section divides a chapter; it does not start one.

    Splitting here would mean a new page in the PDF and a new file in the
    EPUB at every subheading — the book arriving in fragments.
    """
    assert [title for title, _ in chapters(book())] == ["學而第一", "為政第二"]


def test_a_book_with_no_headings_is_one_chapter():
    doc = Document(title="無題", blocks=[block(BlockKind.BODY, "一段文字。")])
    assert [title for title, _ in chapters(doc)] == ["無題"]


# --------------------------------------------------------------------------
# The EPUB itself
# --------------------------------------------------------------------------


def nav_of(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        name = next(n for n in archive.namelist() if n.endswith("nav.xhtml"))
        return archive.read(name).decode("utf-8")


def test_the_contents_nests_sections_under_their_chapter(tmp_path):
    nav = nav_of(build_epub(book(), tmp_path / "book.epub"))

    assert "學而第一" in nav
    assert "一、學問的目的" in nav
    # Nesting, not a flat list: the sections live in a list inside the
    # chapter's own list item.
    assert "<ol>" in nav.split("學而第一", 1)[1].split("為政第二", 1)[0]


def test_contents_entries_point_at_real_anchors(tmp_path):
    path = build_epub(book(), tmp_path / "book.epub")
    nav = nav_of(path)

    with zipfile.ZipFile(path) as archive:
        chapter = next(n for n in archive.namelist() if n.endswith("chapter-1.xhtml"))
        content = archive.read(chapter).decode("utf-8")

    assert "#sec-1" in nav
    assert 'id="sec-1"' in content


def test_a_chapter_without_sections_is_a_plain_entry(tmp_path):
    """No disclosure arrow opening onto nothing."""
    doc = Document(
        title="無題",
        blocks=[block(BlockKind.CHAPTER, "第一章"), block(BlockKind.BODY, "文字。")],
    )
    nav = nav_of(build_epub(doc, tmp_path / "book.epub"))

    # One list: the top-level one. A childless chapter that was still
    # rendered as a parent would open a second.
    assert nav.count("<ol>") == 1
