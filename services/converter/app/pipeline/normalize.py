"""Deterministic typography repair for Chinese OCR output.

Everything here is a mechanical, reversible normalization — restoring the
full-width punctuation the printed page actually uses, which the OCR
engine reports as ASCII. None of it changes wording, and every change is
recorded so a human reviewer can audit the pass. AI-assisted correction
is a separate stage and never runs silently (CLAUDE.md section 7).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

CJK = r"　-〿一-鿿＀-￯"

# A dash-led attribution: the printed page sets a full-width double dash
# (——) which the engine frequently reads as one dash, or as a hyphen.
_LEADING_DASH = re.compile(r"^[—–\-―─]+\s*")

# Half-width parentheses around Chinese content, which the printed book
# sets full-width.
_PARENS = re.compile(rf"\(\s*([^()]*[{CJK}][^()]*?)\s*\)")

# Digits spaced away from the Chinese around them: 「见第 71 页」. The
# spacing is letterspacing in the original setting, not a word break.
_SPACED_DIGITS = re.compile(rf"(?<=[{CJK}])\s+(?=\d)|(?<=\d)\s+(?=[{CJK}])")


@dataclass
class NormalizationLog:
    """Every change made, so the pass can be reviewed rather than trusted."""

    changes: list[tuple[str, str, str]] = field(default_factory=list)

    def record(self, rule: str, before: str, after: str) -> None:
        if before != after:
            self.changes.append((rule, before, after))

    def __len__(self) -> int:
        return len(self.changes)


def normalize_text(text: str, log: NormalizationLog | None = None) -> str:
    original = text

    text = _PARENS.sub(lambda m: f"（{m.group(1)}）", text)
    if log is not None:
        log.record("full-width-parens", original, text)

    before = text
    text = _SPACED_DIGITS.sub("", text)
    if log is not None:
        log.record("spaced-digits", before, text)

    return text.strip()


def normalize_attribution(text: str, log: NormalizationLog | None = None) -> str:
    """Restore the leading 「——」 of an attribution line.

    The engine reads it as one dash about half the time and drops it
    entirely on occasion. Restoring it is safe because the classifier only
    calls this for lines it has already decided are attributions.
    """
    body = _LEADING_DASH.sub("", text).strip()
    result = f"——{body}"
    if log is not None:
        log.record("attribution-dash", text, result)
    return result
