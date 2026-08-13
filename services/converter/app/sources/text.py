"""Plain text → Document.

The least structured input there is, and so the one where it is most
tempting to guess. This deliberately infers very little: blank lines
separate paragraphs, a Markdown-style `#` prefix or a lone poem marker
is a heading, and everything else is prose.

It does *not* try to detect verse by line length, which is the guess a
text importer usually reaches for. On Chinese material that misfires
constantly — classical prose is set in short lines too — and the cost of
being wrong is a paragraph shattered into fake poetry in a published
book. Verse in a plain text file is better recovered by an editor in the
DOCX master, where the mistake is visible and cheap to fix.
"""

from __future__ import annotations

import re
from pathlib import Path

from ..models import Block, BlockKind, Document
from ..pipeline.structure import MARKER_RE

# `# Chapter`, `## Chapter` — the one heading convention common enough in
# plain text files to be worth honouring.
_ATX_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*$")


def read_text(
    path: Path | None = None,
    *,
    content: str | None = None,
    title: str | None = None,
) -> Document:
    """Read a UTF-8 text file, or a string, into a Document."""
    if content is None:
        if path is None:
            raise ValueError("read_text needs either a path or content")
        # Strict rather than lenient: a mis-encoded file must fail here,
        # not become mojibake in a published book. See detect.py.
        content = path.read_text(encoding="utf-8")

    doc = Document(title=title or (path.stem if path else "Untitled"))

    for chunk in re.split(r"\n\s*\n", content):
        lines = [line.strip() for line in chunk.splitlines() if line.strip()]
        if not lines:
            continue

        heading = _ATX_HEADING.match(lines[0])
        if heading and len(lines) == 1:
            doc.blocks.append(
                Block(kind=BlockKind.CHAPTER, lines=[heading.group(2)], page=0)
            )
            continue

        if len(lines) == 1 and MARKER_RE.match(lines[0]):
            doc.blocks.append(Block(kind=BlockKind.MARKER, lines=lines, page=0))
            continue

        # A blank-line-separated run is one paragraph. Its internal line
        # breaks are the text file's wrapping, not the author's — the same
        # reasoning the OCR path applies to a printed measure.
        doc.blocks.append(
            Block(kind=BlockKind.BODY, lines=lines, page=0, starts_paragraph=True)
        )

    return doc
