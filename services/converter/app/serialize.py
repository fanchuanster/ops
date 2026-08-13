"""Persist a reconstructed document between pipeline stages.

The OCR pass takes hours; the correction and format stages take minutes
and will be re-run many times against the same read. So the structured
document is written to disk as JSON, and every stage after `convert`
starts from that file rather than from the scan.

This is also what makes block and line indices meaningful: a `Suggestion`
points at `blocks[7].lines[2]`, and that reference has to survive the
process that produced it exiting.
"""

from __future__ import annotations

import json
from pathlib import Path

from .models import Block, BlockKind, Document, Suggestion

# Bumped when the on-disk shape changes incompatibly, so an old document
# fails loudly here rather than being half-read by a newer pipeline.
SCHEMA_VERSION = 1


def document_to_dict(doc: Document) -> dict:
    return {
        "schema": SCHEMA_VERSION,
        "title": doc.title,
        "author": doc.author,
        "low_confidence_pages": doc.low_confidence_pages,
        "blocks": [
            {
                "kind": block.kind.value,
                "lines": block.lines,
                "page": block.page,
                "confidence": round(block.confidence, 4),
                "source_ref": block.source_ref,
                "starts_paragraph": block.starts_paragraph,
            }
            for block in doc.blocks
        ],
    }


def document_from_dict(data: dict) -> Document:
    schema = data.get("schema")
    if schema != SCHEMA_VERSION:
        raise ValueError(
            f"document schema {schema!r} is not {SCHEMA_VERSION} — "
            "re-run `converter convert` to regenerate it"
        )
    return Document(
        title=data["title"],
        author=data.get("author"),
        low_confidence_pages=list(data.get("low_confidence_pages", [])),
        blocks=[
            Block(
                kind=BlockKind(b["kind"]),
                lines=list(b["lines"]),
                page=b["page"],
                confidence=b.get("confidence", 1.0),
                source_ref=b.get("source_ref"),
                starts_paragraph=b.get("starts_paragraph", False),
            )
            for b in data["blocks"]
        ],
    )


def write_document(doc: Document, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(document_to_dict(doc), ensure_ascii=False, indent=2) + "\n"
    )
    return path


def read_document(path: Path) -> Document:
    return document_from_dict(json.loads(path.read_text()))


def suggestion_to_dict(suggestion: Suggestion) -> dict:
    return {
        "block": suggestion.block,
        "line": suggestion.line,
        "category": suggestion.category,
        "confidence": round(suggestion.confidence, 3),
        "reason": suggestion.reason,
        "original": suggestion.original,
        "suggested": suggestion.suggested,
        "approved": suggestion.approved,
    }


def suggestion_from_dict(data: dict) -> Suggestion:
    return Suggestion(
        block=data["block"],
        line=data["line"],
        original=data["original"],
        suggested=data["suggested"],
        reason=data.get("reason", ""),
        confidence=data.get("confidence", 0.0),
        category=data.get("category", "characters"),
        approved=data.get("approved"),
    )


def read_suggestions(path: Path) -> list[Suggestion]:
    data = json.loads(path.read_text())
    return [suggestion_from_dict(s) for s in data["suggestions"]]
