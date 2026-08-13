"""Group OCR spans into printed lines."""

from __future__ import annotations

from ..models import Line, OcrPage, OcrSpan

# Two spans belong to the same printed line when their vertical extents
# overlap by at least this much of the shorter one. It has to tolerate a
# real case from this book: a cross-reference set in a smaller face beside
# a verse line, where the boxes overlap well but their centres do not.
SAME_LINE_OVERLAP = 0.45


def group_lines(page: OcrPage) -> list[Line]:
    """Cluster a page's spans into lines, top to bottom, left to right."""
    if not page.spans:
        return []

    ordered = sorted(page.spans, key=lambda s: (s.box.y0, s.box.x0))
    clusters: list[list[OcrSpan]] = [[ordered[0]]]

    for span in ordered[1:]:
        current = clusters[-1]
        # Compare against the tallest span already on the line rather than
        # the last one added. A short cross-reference joined to the line
        # would otherwise shrink the target the next span has to overlap.
        anchor = max(current, key=lambda s: s.box.height)
        if span.box.vertical_overlap(anchor.box) >= SAME_LINE_OVERLAP:
            current.append(span)
        else:
            clusters.append([span])

    return [Line(spans=sorted(c, key=lambda s: s.box.x0)) for c in clusters]
