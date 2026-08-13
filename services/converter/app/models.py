"""Data structures shared by the conversion pipeline.

These deliberately know nothing about PaddleOCR, PyMuPDF or python-docx.
The OCR engine produces `OcrPage`, the structure pass turns that into
`Document`, and the DOCX builder consumes `Document` — so any one of the
three can be replaced without touching the others.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


@dataclass(frozen=True)
class Box:
    """An axis-aligned box in page-image pixel space, origin top-left."""

    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    def vertical_overlap(self, other: "Box") -> float:
        """Fraction of the shorter box's height that overlaps the other.

        This is what decides whether two detected boxes are on the same
        printed line. A plain centre-distance test fails on this book,
        where a cross-reference sits beside a verse line but is set in a
        smaller face, so their centres differ by more than either height
        would suggest.
        """
        top = max(self.y0, other.y0)
        bottom = min(self.y1, other.y1)
        if bottom <= top:
            return 0.0
        shorter = min(self.height, other.height)
        return (bottom - top) / shorter if shorter else 0.0

    @staticmethod
    def hull(boxes: list["Box"]) -> "Box":
        return Box(
            min(b.x0 for b in boxes),
            min(b.y0 for b in boxes),
            max(b.x1 for b in boxes),
            max(b.y1 for b in boxes),
        )


@dataclass(frozen=True)
class OcrSpan:
    """One text region as the OCR engine detected it."""

    text: str
    confidence: float
    box: Box


@dataclass
class OcrPage:
    """Everything the OCR engine saw on one page image."""

    index: int  # 0-based page index within the source PDF
    width: int
    height: int
    spans: list[OcrSpan] = field(default_factory=list)


@dataclass
class Line:
    """Spans that share a printed line, ordered left to right."""

    spans: list[OcrSpan]

    @property
    def text(self) -> str:
        return " ".join(s.text for s in self.spans)

    @property
    def box(self) -> Box:
        return Box.hull([s.box for s in self.spans])

    @property
    def confidence(self) -> float:
        # The weakest span governs: a line is only as trustworthy as its
        # worst-read part, and averaging would hide a single bad word in
        # an otherwise clean line.
        return min(s.confidence for s in self.spans)


class BlockKind(str, Enum):
    CHAPTER = "chapter"  # 《论语别裁》诗词
    MARKER = "marker"  # （十一） — the poem's number within a chapter
    VERSE = "verse"  # a poem; line breaks are significant
    ATTRIBUTION = "attribution"  # ——唐·李白《静夜思》
    BODY = "body"  # ordinary reflowable prose
    FOOTNOTE = "footnote"  # set below the rule at the foot of the page


@dataclass
class Block:
    """A structural unit of the reconstructed book.

    `lines` holds one entry per printed line. For VERSE that distinction
    is load-bearing — the lines are the poem's lines and must survive to
    the DOCX and onward to the EPUB. For BODY the lines are joined into
    a paragraph, because there the breaks really are an artifact of the
    printed measure.
    """

    kind: BlockKind
    lines: list[str]
    page: int
    confidence: float = 1.0
    source_ref: str | None = None  # （见第 71 页）, into the cited edition
    # BODY only: this line was first-line indented, so it opens a new
    # paragraph rather than continuing the previous one.
    starts_paragraph: bool = False

    @property
    def text(self) -> str:
        return "\n".join(self.lines)


@dataclass
class Document:
    """A whole reconstructed book, ready for format generation."""

    title: str
    blocks: list[Block] = field(default_factory=list)
    # Page indices the OCR pass could not read confidently, for the
    # human review step. Never silently dropped.
    low_confidence_pages: list[int] = field(default_factory=list)
