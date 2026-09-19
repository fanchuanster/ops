#!/usr/bin/env python3
"""Shrink an oversized scan until NobleSee will take it.

NobleSee refuses a source over 100 MB, and that refusal is not ours to
relax: it is Adobe's published ceiling for the Export PDF call that turns
a scan into a DOCX master, and it is Cloudflare's request cap on the plan
the Worker runs under (docs/ARCHITECTURE.md, docs/STORAGE.md). A 400-page book
scanned at 300dpi clears 100 MB without difficulty, and those are exactly
the historical scans this library exists to preserve. This is the tool
for those books.

    tools/shrink-pdf.py scan.pdf              # -> scan-28MB.pdf
    tools/shrink-pdf.py scan.pdf -o ready.pdf
    tools/shrink-pdf.py --inspect scan.pdf
    tools/shrink-pdf.py --gray --min-dpi 150 huge.pdf
    tools/shrink-pdf.py *.pdf --out-dir ready/

It re-encodes the page images at a lower resolution and does nothing
else. Pages are never dropped and the book is never split: a book is
whole (docs/BOOKS.md section 5), so half a scan is not an answer to an
oversized one. Text and vector content are carried through as text and
vectors, so a born-digital PDF keeps the text layer it arrived with.

The resolution is chosen by descending a ladder and stopping at the first
rung that fits, so the result is the best quality under the limit rather
than the smallest file that could be made. Often the top rung wins on
re-encoding alone and no resolution is given up at all.

The ladder stops at --min-dpi, 200 by default, because below that Adobe
starts losing dense traditional Chinese glyphs, and a file that uploads
and then OCRs into noise has spent a document transaction and a
proofreader's afternoon to produce something worse than nothing. Going
lower is allowed, deliberately, and says so on the way past.

RESOLUTION IS NOT ALWAYS THE LEVER. A rung above the scan's own
resolution downsamples nothing, and a scan already compressed harder than
--quality re-encodes to the size it started at. The tool measures this
rather than assuming it: a rung is judged against the rung above it, not
against the input, so the re-encoding every rung does is never mistaken
for a downsample, and no estimate is extrapolated from a rung that did
not earn it. A scan under the whole ladder is given one pass rather than
four identical ones, and is told that resolution is the wrong lever and
--quality, --gray and --mono-dpi are the right ones.

KEEP THE ORIGINAL. NobleSee preserves the file it is given: the upload
*is* the book's PDF artifact and is what a reader is sent. Shrinking is
how a book gets in, not an archival step — the full-resolution scan
belongs in your own storage either way.

--inspect also reports whether the file's embedded fonts can draw its
own text (tools/pdf.py's check_readability) — a PDF can have a perfectly
good text layer and still render as blank boxes if the wrong font got
embedded, which no amount of shrinking fixes.

This is a maintainer utility and not part of the runtime stack.
Ghostscript is a native binary, and nothing native runs in the Worker.

Requires ghostscript. PyMuPDF (`pip install pymupdf`) is strongly
recommended: without it the ladder cannot be trimmed to the scan's own
resolution, and the report falls back to counting compression filters in
the raw bytes.

The engine — the ladder, the Ghostscript call, the survey and the glyph
check — lives in tools/pdf.py, shared with tools/clean-pdf.py. This file
is the CLI: argument parsing and the per-file loop.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pdf as pdf_lib


def main() -> int:
    limit, source = pdf_lib.upload_limit()

    parser = argparse.ArgumentParser(
        description="Shrink a scanned PDF until NobleSee will accept it.",
        epilog=f"The limit is {pdf_lib.human(limit)}, from {source}.",
    )
    parser.add_argument("pdf", nargs="+", type=Path)
    parser.add_argument("-o", "--output", type=Path, help="only with a single input")
    parser.add_argument("--out-dir", type=Path, help="write results here instead of beside each input")
    parser.add_argument("--inspect", action="store_true", help="report what is in each file and stop")
    parser.add_argument(
        "--min-dpi",
        type=int,
        default=pdf_lib.DEFAULT_MIN_DPI,
        help=f"how far the ladder may descend (default {pdf_lib.DEFAULT_MIN_DPI}, the OCR floor)",
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=pdf_lib.DEFAULT_QUALITY,
        help=f"image quality, 0-100 (default {pdf_lib.DEFAULT_QUALITY}, Ghostscript's own)",
    )
    parser.add_argument(
        "--mono-dpi",
        type=int,
        default=pdf_lib.DEFAULT_MONO_DPI,
        help=f"resolution floor for bitonal pages (default {pdf_lib.DEFAULT_MONO_DPI})",
    )
    parser.add_argument(
        "--gray",
        action="store_true",
        help="discard colour — often a large win, but red seals and marginalia go with it",
    )
    parser.add_argument(
        "--margin",
        type=float,
        default=pdf_lib.DEFAULT_MARGIN_MIB,
        metavar="MB",
        help=f"headroom under the limit (default {pdf_lib.DEFAULT_MARGIN_MIB})",
    )
    parser.add_argument("--force", action="store_true", help="re-encode even a file already under the limit")
    args = parser.parse_args()

    if args.output and len(args.pdf) > 1:
        parser.error("--output takes one input; use --out-dir for several")
    if args.out_dir:
        args.out_dir.mkdir(parents=True, exist_ok=True)

    target = int(limit - args.margin * pdf_lib.MIB)
    if target <= 0:
        parser.error("--margin leaves nothing to aim at")

    if not args.inspect:
        print(f"Target {pdf_lib.human(target)} ({pdf_lib.human(limit)} from {source}, {args.margin:g} MB spare)\n")

    failed = 0
    for path in args.pdf:
        if not path.is_file():
            print(f"{path}: no such file")
            failed += 1
            continue

        if args.inspect:
            pdf_lib.describe(path, pdf_lib.survey(path), pdf_lib.check_readability(path))
            print()
            continue

        out_dir = args.output.parent if args.output else (args.out_dir or path.parent)
        out_dir.mkdir(parents=True, exist_ok=True)

        if not pdf_lib.shrink(path, out_dir, args.output, target, args):
            failed += 1

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
