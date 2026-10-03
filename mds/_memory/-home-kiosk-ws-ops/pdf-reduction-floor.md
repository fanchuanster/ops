---
name: pdf-reduction-floor
description: "The most aggressive PDF shrink settings the maintainer accepts — quality 40 at one rung below the scan's own resolution."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c89e64e2-5625-4f4b-899a-60a9c1109808
  modified: 2026-09-16T20:16:54.896Z
---

`--quality 40` with the ladder one rung below the scan's own resolution is
the *worst* combination of reductions to use on a book — the floor, not a
setting to reach for. Measured on 南怀瑾选集-典藏版-第05卷-扫描版.pdf
(225.7 MB, 659 pages, 150 dpi, JPEG2000) on 2026-09-16: q60 → 163.7 MB,
q40 → 134.2 MB, q20 → 117.6 MB, all at 200 dpi and downsampling nothing;
only `--min-dpi 120 --quality 40` fit, at 92.0 MB, 60% off.

**Why:** past that point the page stops being a faithful copy of the book,
and the whole reason NobleSee keeps the original PDF is fidelity. Both
levers at once compounds: 120 dpi *and* hard JPEG on dense Chinese type is
where a scan starts to look like a photocopy of a photocopy.

**How to apply:** spend `--quality` before resolution — it never
downsamples. Treat `--min-dpi` below the scan's own resolution as the last
lever, take one rung only, and render a page and look at it before handing
the result over. A book that needs more than this wants rescanning, not
harder compression.
