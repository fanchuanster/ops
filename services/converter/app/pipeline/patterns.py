"""Text patterns the structure passes recognise.

Separated from `structure.py` for one practical reason: that module
reconstructs a book from OCR *geometry* and so imports PyMuPDF, while
these are pure text patterns that several readers need. Without the
split, reading a JSON file of paragraphs pulls in a PDF library.

Kept in one place rather than copied, because a pattern that drifts
between two readers is a bug that only shows up on the books that
happen to use it.
"""

from __future__ import annotations

import re

# （十一） — a poem's number within a chapter. Unambiguous enough to
# recognise from text alone, which is why it survives the OCR handoff
# where headings and verse do not.
MARKER_RE = re.compile(r"^[(（]\s*[一二三四五六七八九十百零〇]+\s*[)）]$")

# 「（见第 71 页）」 and its shorthand 「（同上）」 for a repeated source.
REF_RE = re.compile(r"[(（]\s*(?:见|同上)[^)）]{0,24}[)）]")

DASH_RE = re.compile(r"^[—–\-―─]{1,3}\s*[^\s]")
FOOTNOTE_CUE_RE = re.compile(r"^[*＊※注]")
