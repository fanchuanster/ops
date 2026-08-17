"""OCR text from the web application → Document.

The pipeline is split at the OCR boundary. The web application calls
Google Document AI — OCR became an HTTP request when it stopped being a
local model, and a Worker is billed almost nothing to wait on one — and
writes what came back to R2 as JSON. This module reads that file. See
`apps/web/src/domain/ocr.ts` for the writer and the format's version.

    {
      "version": 1,
      "bookId": "7",
      "pageCount": 412,
      "pages": [ { "number": 1, "paragraphs": ["…", "…"] } ]
    }

## What is lost across that boundary, and why that is acceptable

`pipeline/structure.py` reconstructs a book from OCR *geometry*: where a
line sits on the page decides whether it is a running head, a footnote,
a heading or a verse line. None of that survives here — Document AI
reports paragraphs, and the handoff carries text.

So this does not guess. Paragraphs become BODY blocks, poem markers are
recognised because that pattern is unambiguous, and everything else is
left for a human to fix in the DOCX master. That is the same stance
`text.py` takes for plain text, and for the same reason: on Chinese
material the usual heuristics (short line means verse, first line means
heading) misfire constantly, and the cost of being wrong is a published
book with shattered paragraphs and invented chapters. A missing heading
is visible and cheap to fix in the master; a fabricated one is neither.

The geometric path has not gone away — `structure.py` still runs for a
local OCR backend through `sources/load.py`. This is the path for books
read by the hosted engine.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..models import Block, BlockKind, Document
from ..pipeline.patterns import MARKER_RE

# Bumped by the writer when the shape changes incompatibly. Refusing an
# unknown version here means a format change is discovered in the first
# second, as a refusal, rather than an hour later as a malformed book.
SUPPORTED_VERSIONS = (1, 2)

# Kept for callers that still import it; version 2 is what the web
# application writes now.
SUPPORTED_VERSION = 2

# Roles the writer may assign to a paragraph, mapped to block kinds.
# Anything unrecognised falls back to BODY — a role this converter does
# not know is a newer writer being cautious, not a reason to fail a book.
_ROLE_KINDS = {
    "h1": BlockKind.CHAPTER,
    "h2": BlockKind.SECTION,
    "body": BlockKind.BODY,
}


class UnsupportedOcrDocument(RuntimeError):
    """The OCR handoff file is not one this converter can read."""


def read_ocr_json(
    path: Path | None = None,
    *,
    content: str | None = None,
    title: str | None = None,
    author: str | None = None,
) -> Document:
    """Read the handoff document into a Document."""
    if content is None:
        if path is None:
            raise ValueError("read_ocr_json needs either a path or content")
        content = path.read_text(encoding="utf-8")

    try:
        payload = json.loads(content)
    except json.JSONDecodeError as error:
        raise UnsupportedOcrDocument(f"the OCR file is not valid JSON: {error}") from error

    if not isinstance(payload, dict):
        raise UnsupportedOcrDocument("the OCR file is not an object")

    version = payload.get("version")
    if version not in SUPPORTED_VERSIONS:
        raise UnsupportedOcrDocument(
            f"OCR format version {version!r} is not supported "
            f"(this converter reads versions {', '.join(str(v) for v in SUPPORTED_VERSIONS)})"
        )

    pages = payload.get("pages")
    if not isinstance(pages, list) or not pages:
        raise UnsupportedOcrDocument("the OCR file has no pages")

    doc = Document(title=title or "Untitled")
    doc.author = author

    for page in pages:
        if not isinstance(page, dict):
            continue
        # 1-based in the handoff, as the engine reported it. Kept as-is:
        # `Block.page` is only ever shown to a human trying to find the
        # passage in the original, so it should match the printed book.
        number = page.get("number")
        page_number = number if isinstance(number, int) else 0

        for paragraph in page.get("paragraphs") or []:
            # Version 1 wrote bare strings; version 2 writes objects
            # carrying the paragraph's role. Both are read, because
            # books already OCR'd under version 1 have been paid for and
            # must not need re-reading to stay convertible.
            if isinstance(paragraph, str):
                text, role = paragraph.strip(), None
            elif isinstance(paragraph, dict):
                raw = paragraph.get("text")
                if not isinstance(raw, str):
                    continue
                text = raw.strip()
                role = paragraph.get("role")
            else:
                continue

            if not text:
                continue

            # A poem marker is still recognised by pattern, because that
            # pattern is unambiguous and does not depend on type size —
            # so it works on a version 1 document and on a version 2 one
            # OCR'd without the paid style feature.
            if MARKER_RE.match(text):
                kind = BlockKind.MARKER
            else:
                kind = _ROLE_KINDS.get(role, BlockKind.BODY) if isinstance(role, str) else BlockKind.BODY
            doc.blocks.append(
                Block(
                    kind=kind,
                    lines=[text],
                    page=page_number,
                    # The engine's own confidence is not carried across
                    # the boundary. Claiming 1.0 would assert something
                    # we did not measure, but every consumer treats this
                    # as "no reason to doubt" rather than as evidence,
                    # and there is no half-measure that means less.
                    confidence=1.0,
                    # Each paragraph opens its own, which is what a
                    # paragraph is. The line breaks inside one were
                    # already removed by the writer.
                    starts_paragraph=True,
                )
            )

    if not doc.blocks:
        raise UnsupportedOcrDocument("the OCR file has no text on any page")

    return doc


def page_count_of(content: str) -> int | None:
    """The book's real length, including pages with nothing on them.

    Read separately from the blocks because blank pages are dropped
    before the handoff is written but are still pages of the book — and
    the page count is what the credit price is derived from.
    """
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return None
    count = payload.get("pageCount") if isinstance(payload, dict) else None
    return count if isinstance(count, int) and count > 0 else None
