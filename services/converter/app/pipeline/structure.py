"""Turn positioned OCR lines into a structured document.

Every threshold here was derived from measured page geometry rather than
guessed; `docs/CONVERSION_PIPELINE.md` records the measurements and why
each rule is shaped the way it is. All of them are fractions of the page
box, because page dimensions are not constant even within one scan.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from statistics import median

from ..models import Block, BlockKind, Document, Line, OcrPage
from .lines import group_lines
from .normalize import NormalizationLog, normalize_attribution, normalize_text
from .render import OutlineEntry

# Everything above the printed rule is a running head. Measured: heads end
# by 9.2% of page height at the latest, and body content never begins
# before 11.8%.
HEAD_BAND = 0.10

# Verse is set in a narrow centred measure; prose runs the full width.
# Measured: verse lines begin at 34–39% of page width, prose at 11–19%.
# The left edge separates them where line width cannot — a short last line
# of a paragraph is narrow but still starts at the prose margin.
VERSE_MIN_LEFT = 0.28
VERSE_MAX_WIDTH = 0.55

# A footnote sits at the foot of the page, set smaller than body text.
# A y-threshold alone is not enough: verse reaches 86% of page height,
# below where footnotes start.
FOOT_BAND = 0.78
FOOT_MAX_HEIGHT_RATIO = 0.85

# Chinese prose opens a paragraph with a two-character first-line indent
# and no blank line, so the indent is the only paragraph boundary there
# is. Measured on this book: continuation lines start at 11.3–12.2% of
# page width, first lines at 18.4–19.0%.
PARAGRAPH_INDENT = 0.03

# Re-exported from `patterns`, which holds them so that a reader needing
# only the text patterns does not import PyMuPDF through this module.
from .patterns import DASH_RE, FOOTNOTE_CUE_RE, MARKER_RE, REF_RE  # noqa: E402

# An attribution names a source; it never ends in sentence punctuation.
# This is what separates 「——唐·李白《静夜思》」 from a verse line whose
# leading dash is OCR noise, such as 「——不能容物只容身。」.
SENTENCE_END = ("，", "。", "；", "？", "！", "、", "：")


@dataclass
class StructureReport:
    """What the pass did, for human review rather than blind trust."""

    dropped_furniture: list[tuple[int, str]] = field(default_factory=list)
    normalization: NormalizationLog = field(default_factory=NormalizationLog)
    low_confidence: list[tuple[int, float, str]] = field(default_factory=list)
    skipped_pages: list[int] = field(default_factory=list)


def _fracs(line: Line, page: OcrPage) -> tuple[float, float, float]:
    box = line.box
    return box.y0 / page.height, box.x0 / page.width, box.width / page.width


def strip_furniture(
    lines: list[Line], page: OcrPage, report: StructureReport
) -> list[Line]:
    kept = []
    for line in lines:
        if line.box.y1 < HEAD_BAND * page.height:
            report.dropped_furniture.append((page.index, line.text))
        else:
            kept.append(line)
    return kept


def extract_ref(text: str) -> tuple[str, str | None]:
    """Split a source cross-reference off a line.

    「（见第 71 页）」 points into the cited edition of the work the poem was
    quoted from — the footnote on the first page of each chapter says so.
    They are content, not pagination of this book, so they are preserved
    rather than stripped. They appear both as their own detected box and
    merged into the attribution's box, so this works on the joined line
    text and handles both.
    """
    match = REF_RE.search(text)
    if not match:
        return text, None
    return (text[: match.start()] + text[match.end() :]).strip(), match.group(0)


def _is_footnote(line: Line, page: OcrPage, body_height: float) -> bool:
    """A note set small, at the foot of the page, outside the text block.

    `body_height` is a fraction of page height measured across the whole
    book rather than the current page. Type size is constant in a printed
    book, and a single page is far too small a sample: a page whose only
    lines are two verses and a footnote has a median that the footnote
    itself drags down, so the footnote stops looking small.
    """
    y0, x0, _ = _fracs(line, page)
    if y0 <= FOOT_BAND:
        return False
    if line.box.height / page.height >= FOOT_MAX_HEIGHT_RATIO * body_height:
        return False
    return bool(FOOTNOTE_CUE_RE.match(line.text)) or x0 < 0.25


def _measure_body_height(pages: list[OcrPage]) -> float:
    """Median line height across the book, as a fraction of page height.

    Normalized because page dimensions are not constant even within one
    scan — this book has pages at 1634×2400 and at 1698×2432.
    """
    heights = [
        line.box.height / page.height
        for page in pages
        for line in group_lines(page)
        if line.box.y1 >= HEAD_BAND * page.height
    ]
    return median(heights) if heights else 0.0


def build_document(
    pages: list[OcrPage],
    outline: list[OutlineEntry],
    title: str,
    skip_titles: frozenset[str] = frozenset({"封面", "书名", "版权", "目录", "封底"}),
    low_confidence_below: float = 0.80,
    normalize: bool = True,
) -> tuple[Document, StructureReport]:
    """Structure positioned lines into a document.

    `normalize` repairs the punctuation an OCR engine reports as ASCII
    where the printed page sets it full-width. Turn it off for text that
    was never OCR'd — a born-digital PDF or a DOCX carries exact
    characters, and "repairing" those is editing the author rather than
    correcting the machine.
    """
    report = StructureReport()
    doc = Document(title=title)

    body_height = _measure_body_height(pages)
    chapter_at = {e.page: e.title for e in outline}
    skipped = _pages_to_skip(outline, skip_titles, max_page=max((p.index for p in pages), default=0))

    open_verse: Block | None = None
    # The poem a cross-reference belongs to. It has to outlive
    # `open_verse`, which closes the moment the attribution line arrives:
    # a reference set on its own line below the attribution still refers
    # to the poem, not to the attribution. Reset at the next marker.
    current_poem: Block | None = None
    # Footnotes are anchored to the foot of a printed page, which can fall
    # in the middle of a poem that continues overleaf. Emitting them in
    # page order would cut the poem in half, so they are held and released
    # once the poem they interrupted has closed.
    held_footnotes: list[Block] = []

    def flush_footnotes() -> None:
        doc.blocks.extend(held_footnotes)
        held_footnotes.clear()

    def close_verse() -> None:
        nonlocal open_verse
        if open_verse and open_verse.lines:
            doc.blocks.append(open_verse)
        open_verse = None
        flush_footnotes()

    for page in pages:
        if page.index in skipped:
            report.skipped_pages.append(page.index)
            continue

        lines = strip_furniture(group_lines(page), page, report)
        if not lines:
            continue

        # The prose left margin on this page, taken from the lines that
        # run the full measure — those are necessarily continuation lines
        # or full first lines, never a short last line of a paragraph.
        full_measure = [ln for ln in lines if ln.box.width / page.width >= VERSE_MAX_WIDTH]
        body_left = min((ln.box.x0 / page.width for ln in full_measure), default=0.0)

        if page.index in chapter_at:
            close_verse()
            current_poem = None
            # The printed display heading is taken from the PDF outline,
            # not from OCR: large widely-spaced display type loses its
            # first character reliably (「目录」 reads as 「录」), and the
            # outline carries the title exactly.
            doc.blocks.append(
                Block(kind=BlockKind.CHAPTER, lines=[chapter_at[page.index]], page=page.index)
            )
            lines = _drop_display_heading(lines, page)

        for line in lines:
            text, ref = extract_ref(line.text)
            if normalize:
                text = normalize_text(text, report.normalization)
                if ref:
                    ref = normalize_text(ref, report.normalization)
            else:
                text = text.strip()
                ref = ref.strip() if ref else ref

            if line.confidence < low_confidence_below:
                report.low_confidence.append((page.index, line.confidence, line.text))
                if page.index not in doc.low_confidence_pages:
                    doc.low_confidence_pages.append(page.index)

            if not text:
                _attach_ref(current_poem, doc, ref)
                continue

            y0, x0, width = _fracs(line, page)

            if MARKER_RE.match(text):
                close_verse()
                current_poem = None
                doc.blocks.append(
                    Block(
                        kind=BlockKind.MARKER,
                        lines=[text],
                        page=page.index,
                        confidence=line.confidence,
                    )
                )
                continue

            if _is_footnote(line, page, body_height):
                footnote = Block(
                    kind=BlockKind.FOOTNOTE,
                    lines=[text],
                    page=page.index,
                    confidence=line.confidence,
                )
                if open_verse is not None:
                    held_footnotes.append(footnote)
                else:
                    doc.blocks.append(footnote)
                    _attach_ref(None, doc, ref)
                continue

            # An attribution is always set in a short measure and never
            # ends in sentence punctuation. The width guard matters:
            # prose wraps onto lines beginning with an em-dash often
            # enough that a dash alone is not evidence.
            narrow = width < VERSE_MAX_WIDTH
            # A signature runs to two lines — 「练性乾 / 一九九五年二月」 —
            # and only the first carries the dash.
            follows_prose = bool(doc.blocks) and doc.blocks[-1].kind in (
                BlockKind.BODY,
                BlockKind.ATTRIBUTION,
            )
            is_attribution = (
                narrow
                and not text.endswith(SENTENCE_END)
                and (
                    bool(DASH_RE.match(text))
                    # A short indented line closing a poem or a prose
                    # section is a source or a signature — the preface
                    # ends 「练性乾 / ——一九九五年二月」.
                    or (
                        (open_verse is not None or follows_prose)
                        and x0 > VERSE_MIN_LEFT
                    )
                )
            )

            if is_attribution:
                close_verse()
                doc.blocks.append(
                    Block(
                        kind=BlockKind.ATTRIBUTION,
                        lines=[
                            normalize_attribution(text, report.normalization)
                            if normalize
                            else text
                        ],
                        page=page.index,
                        confidence=line.confidence,
                    )
                )
                _attach_ref(current_poem, doc, ref)
                continue

            if x0 > VERSE_MIN_LEFT and width < VERSE_MAX_WIDTH:
                if open_verse is None:
                    open_verse = Block(
                        kind=BlockKind.VERSE, lines=[], page=page.index, confidence=1.0
                    )
                    current_poem = open_verse
                open_verse.lines.append(text)
                open_verse.confidence = min(open_verse.confidence, line.confidence)
                _attach_ref(current_poem, doc, ref)
            else:
                close_verse()
                current_poem = None
                doc.blocks.append(
                    Block(
                        kind=BlockKind.BODY,
                        lines=[text],
                        page=page.index,
                        confidence=line.confidence,
                        starts_paragraph=x0 > body_left + PARAGRAPH_INDENT,
                    )
                )
                _attach_ref(None, doc, ref)

    close_verse()
    doc.blocks = _merge_body(doc.blocks)
    return doc, report


def _attach_ref(target: Block | None, doc: Document, ref: str | None) -> None:
    if not ref:
        return
    block = target if target is not None else (doc.blocks[-1] if doc.blocks else None)
    if block is None:
        return
    block.source_ref = ref if not block.source_ref else f"{block.source_ref}{ref}"


def _drop_display_heading(lines: list[Line], page: OcrPage) -> list[Line]:
    """Drop the printed chapter title on a chapter's opening page.

    Structural rather than geometric: skip leading lines until the first
    poem marker or the first full-measure prose line, which is where the
    chapter's content actually starts.
    """
    for i, line in enumerate(lines):
        _, x0, width = _fracs(line, page)
        if MARKER_RE.match(line.text) or x0 <= VERSE_MIN_LEFT:
            return lines[i:]
    return []


def _merge_body(blocks: list[Block]) -> list[Block]:
    """Join consecutive prose lines into paragraphs.

    Only BODY is merged. Verse line breaks are the poem's own and are
    carried through untouched — reflowing them would destroy the text
    this project exists to preserve.
    """
    merged: list[Block] = []
    for block in blocks:
        if (
            block.kind is BlockKind.BODY
            and not block.starts_paragraph
            and merged
            and merged[-1].kind is BlockKind.BODY
            and merged[-1].source_ref is None
        ):
            merged[-1].lines.append(block.lines[0])
            merged[-1].confidence = min(merged[-1].confidence, block.confidence)
            merged[-1].source_ref = block.source_ref
        else:
            merged.append(block)
    return merged


def _pages_to_skip(
    outline: list[OutlineEntry], skip_titles: frozenset[str], max_page: int
) -> set[int]:
    """Pages belonging to front matter that the generated book replaces.

    The printed table of contents is dropped because the DOCX and EPUB
    carry a real, navigable one; the cover and copyright pages are not
    reflowable text.
    """
    skip: set[int] = set()
    starts = sorted({e.page for e in outline})
    for entry in outline:
        if entry.title not in skip_titles:
            continue
        following = [p for p in starts if p > entry.page]
        end = following[0] if following else max_page + 1
        skip.update(range(entry.page, end))
    return skip
