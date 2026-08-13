"""Apply approved corrections to a document.

Separate from `correct.py` on purpose. The suggestion pass and the edit
are two commands with a human decision between them, and that gap is the
whole safeguard CLAUDE.md section 7 asks for — a reviewer sets
`"approved": true` in the review file, and nothing else can.

This step is conservative twice over: it applies only what was approved,
and only where the line still reads exactly as it did when the suggestion
was made. A document re-run through OCR or edited by hand in between has
moved on, and applying a stale suggestion to it would corrupt a line
nobody reviewed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..models import Document, Suggestion


@dataclass
class ApplyReport:
    applied: list[Suggestion] = field(default_factory=list)
    # Approved, but the line had changed since — skipped and reported.
    drifted: list[tuple[Suggestion, str]] = field(default_factory=list)
    # Approved, but pointing at a block or line that no longer exists.
    unresolved: list[Suggestion] = field(default_factory=list)
    pending: int = 0  # nobody has decided yet
    rejected: int = 0  # explicitly declined by the reviewer

    @property
    def ok(self) -> bool:
        return not self.drifted and not self.unresolved


def apply_suggestions(doc: Document, suggestions: list[Suggestion]) -> ApplyReport:
    """Edit `doc` in place with the approved suggestions."""
    report = ApplyReport()

    for suggestion in suggestions:
        if suggestion.approved is None:
            report.pending += 1
            continue
        if suggestion.approved is False:
            report.rejected += 1
            continue

        if not 0 <= suggestion.block < len(doc.blocks):
            report.unresolved.append(suggestion)
            continue
        block = doc.blocks[suggestion.block]
        if not 0 <= suggestion.line < len(block.lines):
            report.unresolved.append(suggestion)
            continue

        current = block.lines[suggestion.line]
        if current != suggestion.original:
            report.drifted.append((suggestion, current))
            continue

        block.lines[suggestion.line] = suggestion.suggested
        report.applied.append(suggestion)

    return report
