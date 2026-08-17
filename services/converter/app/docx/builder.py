"""Generate the editable DOCX master from a structured document.

The DOCX is the source of truth for everything downstream (CLAUDE.md
section 5): EPUB and the PDF variants are generated from the *approved*
master, never from the scan and never from each other. So this file's job
is to produce something an editor can actually work in — real named
styles rather than direct formatting, so that a proofreader changing how
verse looks changes it everywhere at once.
"""

from __future__ import annotations

from pathlib import Path

from docx import Document as DocxDocument
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.shared import Pt

from ..models import Block, BlockKind, Document

# Latin and CJK are bound separately in OOXML. Setting only `font.name`
# leaves Chinese to whatever the reader's Word falls back to, which is how
# a carefully typeset Chinese document ends up in a mismatched face.
LATIN_FONT = "Times New Roman"
CJK_FONT = "宋体"
CJK_HEADING_FONT = "黑体"


def _bind_fonts(style, latin: str = LATIN_FONT, cjk: str = CJK_FONT) -> None:
    style.font.name = latin
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.get_or_add_rFonts()
    rfonts.set(qn("w:eastAsia"), cjk)


def _make_styles(docx) -> None:
    from docx.enum.style import WD_STYLE_TYPE

    base = docx.styles["Normal"]
    base.font.size = Pt(11)
    _bind_fonts(base)

    # Every built-in style this builder emits, including "Heading 2" for
    # section heads: an unbound heading leaves Chinese to Word's fallback,
    # which is the mismatched-face problem above showing up on exactly the
    # lines a reader looks at first.
    for name in ("Title", "Heading 1", "Heading 2"):
        _bind_fonts(docx.styles[name], cjk=CJK_HEADING_FONT)

    def add(name: str, *, size: int, align, space_before=0, space_after=0,
            italic=False, bold=False, cjk=CJK_FONT, line_spacing=None):
        style = docx.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
        style.base_style = base
        style.font.size = Pt(size)
        style.font.italic = italic
        style.font.bold = bold
        _bind_fonts(style, cjk=cjk)
        fmt = style.paragraph_format
        fmt.alignment = align
        fmt.space_before = Pt(space_before)
        fmt.space_after = Pt(space_after)
        if line_spacing:
            fmt.line_spacing = line_spacing
            fmt.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        return style

    add("NobleSee Marker", size=12, align=WD_ALIGN_PARAGRAPH.CENTER,
        space_before=18, space_after=10, bold=True, cjk=CJK_HEADING_FONT)

    # Verse lines carry no space between them: the gap belongs between
    # poems, not between a poem's own lines.
    add("NobleSee Verse", size=11, align=WD_ALIGN_PARAGRAPH.CENTER,
        space_before=0, space_after=0, line_spacing=1.5)

    add("NobleSee Attribution", size=10, align=WD_ALIGN_PARAGRAPH.RIGHT,
        space_before=6, space_after=0)

    add("NobleSee Reference", size=9, align=WD_ALIGN_PARAGRAPH.RIGHT,
        space_before=2, space_after=6)

    add("NobleSee Footnote", size=9, align=WD_ALIGN_PARAGRAPH.LEFT,
        space_before=10, space_after=0)

    body = add("NobleSee Body", size=11, align=WD_ALIGN_PARAGRAPH.JUSTIFY,
               space_before=0, space_after=6, line_spacing=1.5)
    # Chinese prose indents the first line by two characters, not by a
    # fixed measure — so it should be expressed in character units and
    # follow the font size.
    body.paragraph_format.first_line_indent = Pt(22)


_STYLE_FOR = {
    BlockKind.MARKER: "NobleSee Marker",
    BlockKind.VERSE: "NobleSee Verse",
    BlockKind.ATTRIBUTION: "NobleSee Attribution",
    BlockKind.FOOTNOTE: "NobleSee Footnote",
    BlockKind.BODY: "NobleSee Body",
    # Handled ahead of this map, but present so a lookup can never fail.
    BlockKind.SECTION: "Heading 2",
}


def build_docx(doc: Document, out_path: Path, author: str | None = None) -> Path:
    docx = DocxDocument()
    _make_styles(docx)

    docx.core_properties.title = doc.title
    # Always written, even when empty: python-docx stamps its own name as
    # the author of a new document, and a master that claims python-docx
    # wrote it is both wrong and something a round trip would read back.
    docx.core_properties.author = author if author is not None else (doc.author or "")
    docx.core_properties.language = "zh-CN"

    docx.add_paragraph(doc.title, style="Title")

    pending_ref: str | None = None

    def flush_ref() -> None:
        nonlocal pending_ref
        if pending_ref:
            docx.add_paragraph(pending_ref, style="NobleSee Reference")
            pending_ref = None

    for block in doc.blocks:
        if block.kind is BlockKind.CHAPTER:
            flush_ref()
            docx.add_page_break()
            docx.add_paragraph(block.lines[0], style="Heading 1")
            continue

        if block.kind is BlockKind.SECTION:
            # No page break: a section head divides a chapter, it does
            # not start one. Word's built-in style, so the master keeps a
            # real outline — one an editor can navigate and restyle, and
            # one the EPUB's table of contents can be built from.
            flush_ref()
            docx.add_paragraph(block.lines[0], style="Heading 2")
            continue

        if block.kind is BlockKind.ATTRIBUTION:
            # The poem's reference is emitted after its attribution, as
            # the printed page sets it, even though it belongs to the
            # poem structurally.
            docx.add_paragraph(block.lines[0], style=_STYLE_FOR[block.kind])
            if block.source_ref:
                pending_ref = (pending_ref or "") + block.source_ref
            flush_ref()
            continue

        flush_ref()
        style = _STYLE_FOR[block.kind]

        if block.kind is BlockKind.BODY:
            # Prose is one paragraph; the printed line breaks were the
            # measure, not the author's.
            docx.add_paragraph("".join(block.lines), style=style)
        else:
            for line in block.lines:
                docx.add_paragraph(line, style=style)

        if block.source_ref:
            pending_ref = block.source_ref

    flush_ref()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    docx.save(str(out_path))
    return out_path
