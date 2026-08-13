"""AI-assisted OCR correction, as suggestions rather than edits.

CLAUDE.md section 7 is unambiguous: the AI must not blindly rewrite
literary or historical source material. The output of this stage is
therefore a list of `Suggestion`s — original, proposal, reason,
confidence — that a human approves before `apply` touches anything.

The model is advisory and is not trusted. Every proposal is put through
the deterministic checks in `vet()` before it is even offered for review,
because "preserve original wording" cannot be enforced by asking politely
in a prompt. A model that decides to modernize 「說」 into a paraphrase, or
to helpfully complete a truncated line, is rejected here rather than
reaching a reviewer who might wave it through.
"""

from __future__ import annotations

import difflib
import json
import re
import unicodedata
from dataclasses import dataclass, field

from ..models import BlockKind, Document, Suggestion
from .client import ChatClient

# The chapter headings come from the PDF outline, not from OCR — they are
# authoritative and there is nothing to correct.
SKIP_KINDS = frozenset({BlockKind.CHAPTER})

SYSTEM_PROMPT = """\
You are proofreading OCR output from a scanned printed Chinese book for a \
digital preservation project. The text is often classical or literary \
Chinese, in traditional or simplified characters.

Your ONLY job is to identify places where the OCR engine misread the \
printed page. You are correcting the machine, not the author.

You MAY suggest:
- a character the OCR clearly misrecognized (visually similar shapes)
- half-width punctuation that the printed page sets full-width \
(, . ? ! : ; ( ) -> ，。？！：；（）)
- a missing or duplicated punctuation mark
- obvious OCR artifacts: stray Latin letters or digits inside Chinese text, \
repeated characters, dropped quotation marks

You MUST NOT:
- change, modernize, simplify or paraphrase the author's wording
- convert between traditional and simplified characters
- translate anything
- add, remove, complete or reorder content
- "improve" style, grammar or clarity
- fix a line that merely looks incomplete: lines are printed lines and a \
sentence legitimately continues onto the next one
- suggest anything you are not confident about

If a line has no clear OCR error, say nothing about it. Most lines are \
correct. Returning an empty list is the expected outcome for a clean page.

Respond with JSON only, in exactly this shape:

{"suggestions": [{"id": "L3", "suggested": "corrected line text", \
"reason": "brief reason in English", "confidence": 0.95}]}

`suggested` must be the complete corrected line, not a fragment. \
`confidence` is between 0 and 1: use it honestly, and stay above 0.9 only \
for errors you are certain about.\
"""

# How far a proposal may stray from the original before it stops being a
# correction and starts being a rewrite. Derived from the shape of a real
# OCR error: a misread character, a punctuation mark, occasionally two.
MAX_LENGTH_DELTA_RATIO = 0.15
MAX_LENGTH_DELTA_CHARS = 3
MIN_SIMILARITY = 0.75
# Substantive (non-punctuation) characters that may change in one line.
MAX_CONTENT_EDITS = 2

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")


@dataclass
class Rejection:
    """A proposal the guardrails refused, kept for audit.

    These are written into the review file alongside the accepted ones.
    A stage that silently discards what the model said is as unauditable
    as one that silently applies it.
    """

    block: int
    line: int
    original: str
    suggested: str
    reason: str
    rejected_because: str


@dataclass
class CorrectionReport:
    suggestions: list[Suggestion] = field(default_factory=list)
    rejected: list[Rejection] = field(default_factory=list)
    batches: int = 0
    lines_examined: int = 0
    model: str = ""


@dataclass(frozen=True)
class _Candidate:
    """One line offered to the model, addressed by its position."""

    block: int
    line: int
    kind: BlockKind
    text: str


def _is_punctuation(ch: str) -> bool:
    return unicodedata.category(ch).startswith("P") or ch.isspace()


def classify(original: str, suggested: str) -> tuple[str, int]:
    """Describe an edit: its category, and how many content chars changed.

    "punctuation" means only punctuation and spacing differ — the safest
    class of correction and the one this pipeline already does
    deterministically in `pipeline/normalize.py`. Anything that touches a
    character the reader would read is "characters", and is counted so
    the caller can hold the line at a couple of characters per line.
    """
    content_edits = 0
    matcher = difflib.SequenceMatcher(None, original, suggested, autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            continue
        changed = original[i1:i2] + suggested[j1:j2]
        content_edits += sum(1 for ch in changed if not _is_punctuation(ch))
    return ("punctuation" if content_edits == 0 else "characters"), content_edits


def vet(
    candidate: _Candidate,
    suggested: str,
    reason: str,
    confidence: float,
    *,
    min_confidence: float,
) -> tuple[Suggestion | None, str | None]:
    """Accept a proposal, or say why not.

    Returns `(suggestion, None)` or `(None, rejection reason)`. Pure and
    deterministic — this is the part of the stage that is actually tested,
    because it is the part that protects the text.
    """
    original = candidate.text
    suggested = suggested.strip()

    if not suggested:
        return None, "empty suggestion"
    if suggested == original:
        return None, "no change"
    if not 0.0 <= confidence <= 1.0:
        return None, f"confidence {confidence} out of range"
    if confidence < min_confidence:
        return None, f"confidence {confidence:.2f} below {min_confidence:.2f}"

    delta = abs(len(suggested) - len(original))
    allowed = max(MAX_LENGTH_DELTA_CHARS, int(len(original) * MAX_LENGTH_DELTA_RATIO))
    if delta > allowed:
        return None, f"length changed by {delta} chars (limit {allowed})"

    ratio = difflib.SequenceMatcher(None, original, suggested, autojunk=False).ratio()
    if ratio < MIN_SIMILARITY:
        return None, f"only {ratio:.2f} similar to the original (limit {MIN_SIMILARITY})"

    category, content_edits = classify(original, suggested)
    if content_edits > MAX_CONTENT_EDITS:
        return None, (
            f"{content_edits} content characters changed (limit {MAX_CONTENT_EDITS}) "
            "— that is a rewrite, not an OCR correction"
        )

    return (
        Suggestion(
            block=candidate.block,
            line=candidate.line,
            original=original,
            suggested=suggested,
            reason=reason.strip()[:300],
            confidence=confidence,
            category=category,
        ),
        None,
    )


def collect_candidates(doc: Document) -> list[_Candidate]:
    candidates: list[_Candidate] = []
    for b, block in enumerate(doc.blocks):
        if block.kind in SKIP_KINDS:
            continue
        for ln, text in enumerate(block.lines):
            if text.strip():
                candidates.append(
                    _Candidate(block=b, line=ln, kind=block.kind, text=text)
                )
    return candidates


def _batch(candidates: list[_Candidate], budget: int) -> list[list[_Candidate]]:
    """Group consecutive lines into batches under a character budget.

    Consecutive because context matters: a verse line reads differently
    beside the rest of its poem, and a prose line beside the sentence it
    continues. Small because a model asked about forty lines at once
    attends to none of them properly.
    """
    batches: list[list[_Candidate]] = []
    current: list[_Candidate] = []
    size = 0
    for candidate in candidates:
        if current and size + len(candidate.text) > budget:
            batches.append(current)
            current, size = [], 0
        current.append(candidate)
        size += len(candidate.text)
    if current:
        batches.append(current)
    return batches


def _render_batch(batch: list[_Candidate]) -> tuple[str, dict[str, _Candidate]]:
    """Number the batch's lines and return the prompt plus an id lookup."""
    by_id: dict[str, _Candidate] = {}
    lines = []
    for i, candidate in enumerate(batch, start=1):
        line_id = f"L{i}"
        by_id[line_id] = candidate
        lines.append(f"{line_id}\t[{candidate.kind.value}]\t{candidate.text}")
    prompt = (
        "Proofread these consecutive lines from the scan. The tag in "
        "brackets is how the layout pass classified the line: `verse` "
        "lines are a poem's own lines, `body` is prose, `footnote` is a "
        "note at the foot of the page, `attribution` names a source.\n\n"
        + "\n".join(lines)
    )
    return prompt, by_id


def parse_response(raw: str) -> list[dict]:
    """Read the model's JSON, tolerating a code fence around it.

    A provider without JSON mode (a given vLLM build, say) will wrap the
    object in ```json, and that is not worth failing a batch over.
    """
    text = _FENCE_RE.sub("", raw.strip())
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"response was not JSON: {text[:200]}") from exc
    if isinstance(data, list):  # a model that skipped the envelope
        return [item for item in data if isinstance(item, dict)]
    items = data.get("suggestions", [])
    if not isinstance(items, list):
        raise ValueError("`suggestions` was not a list")
    return [item for item in items if isinstance(item, dict)]


def suggest_corrections(
    doc: Document,
    client: ChatClient,
    *,
    batch_chars: int = 1200,
    min_confidence: float = 0.7,
    on_batch=None,
) -> CorrectionReport:
    """Run the correction pass over a document, changing nothing.

    The document is read-only here by design. Applying an approved
    suggestion is `apply.py`'s job, and it is a separate command so that
    the human step between them is unavoidable rather than optional.
    """
    report = CorrectionReport(model=getattr(client, "model", ""))
    candidates = collect_candidates(doc)
    report.lines_examined = len(candidates)
    batches = _batch(candidates, batch_chars)

    for number, batch in enumerate(batches, start=1):
        prompt, by_id = _render_batch(batch)
        raw = client.complete(SYSTEM_PROMPT, prompt)
        report.batches += 1

        try:
            items = parse_response(raw)
        except ValueError as exc:
            # One unparseable batch must not lose the rest of the book.
            report.rejected.append(
                Rejection(
                    block=batch[0].block,
                    line=batch[0].line,
                    original="",
                    suggested="",
                    reason="",
                    rejected_because=f"batch {number}: {exc}",
                )
            )
            if on_batch:
                on_batch(number, len(batches), report)
            continue

        for item in items:
            line_id = str(item.get("id", ""))
            candidate = by_id.get(line_id)
            if candidate is None:
                report.rejected.append(
                    Rejection(
                        block=batch[0].block,
                        line=batch[0].line,
                        original="",
                        suggested=str(item.get("suggested", ""))[:200],
                        reason=str(item.get("reason", ""))[:200],
                        rejected_because=(
                            f"id {line_id!r} is not a line in this batch — "
                            "the model invented a reference"
                        ),
                    )
                )
                continue

            suggestion, refused = vet(
                candidate,
                str(item.get("suggested", "")),
                str(item.get("reason", "")),
                _as_float(item.get("confidence")),
                min_confidence=min_confidence,
            )
            if suggestion is not None:
                report.suggestions.append(suggestion)
            else:
                report.rejected.append(
                    Rejection(
                        block=candidate.block,
                        line=candidate.line,
                        original=candidate.text,
                        suggested=str(item.get("suggested", ""))[:200],
                        reason=str(item.get("reason", ""))[:200],
                        rejected_because=refused or "rejected",
                    )
                )

        if on_batch:
            on_batch(number, len(batches), report)

    return report


def _as_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        # An absent or unparseable confidence is treated as no confidence
        # rather than as certainty.
        return 0.0
