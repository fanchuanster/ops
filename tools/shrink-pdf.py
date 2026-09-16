#!/usr/bin/env python3
"""Shrink an oversized scan until NobleSee will take it.

NobleSee refuses a source over 100 MB, and that refusal is not ours to
relax: it is Adobe's published ceiling for the Export PDF call that turns
a scan into a DOCX master, and it is Cloudflare's request cap on the plan
the Worker runs under (CLAUDE.md sections 3 and 14). A 400-page book
scanned at 300dpi clears 100 MB without difficulty, and those are exactly
the historical scans this library exists to preserve. This is the tool
for those books.

    tools/shrink-pdf.py scan.pdf
    tools/shrink-pdf.py scan.pdf -o ready.pdf
    tools/shrink-pdf.py --inspect scan.pdf
    tools/shrink-pdf.py --gray --min-dpi 150 huge.pdf
    tools/shrink-pdf.py *.pdf --out-dir ready/

It re-encodes the page images at a lower resolution and does nothing
else. Pages are never dropped and the book is never split: a book is
whole (CLAUDE.md section 5), so half a scan is not an answer to an
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

KEEP THE ORIGINAL. NobleSee preserves the file it is given: the upload
*is* the book's PDF artifact and is what a reader is sent. Shrinking is
how a book gets in, not an archival step — the full-resolution scan
belongs in your own storage either way.

This is a maintainer utility and not part of the runtime stack.
Ghostscript is a native binary, and nothing native runs in the Worker.

Requires ghostscript. PyMuPDF (`pip install pymupdf`) is optional, and is
used to report what is in a file and to confirm no page was lost.
"""

import argparse
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

MIB = 1024 * 1024
REPO_ROOT = Path(__file__).resolve().parent.parent
LIMIT_SOURCE = REPO_ROOT / "apps" / "web" / "src" / "domain" / "publication.ts"

DPI_LADDER = (400, 300, 250, 200, 150, 120, 96)
"""Descending, because the first rung that fits is the answer.

400 is here for the 600dpi bitonal scans libraries produce. The run at
the top rung is frequently a no-op for resolution and still wins, by
re-encoding images a scanner wrote at quality 95.
"""

DEFAULT_MIN_DPI = 200
DEFAULT_QUALITY = 75
DEFAULT_MARGIN_MIB = 1

MONO_FLOOR_DPI = 300
"""A bitonal page is already cheap and is destroyed by resampling.

It is held above the ladder rather than dragged down with it; the saving
is in the colour and greyscale images regardless.
"""

SKIP_SLACK = 1.15
"""How far over target a rung may be predicted before it is skipped untried.

Each rung costs a full Ghostscript pass — a minute or more on a 100 MB
book — so a rung the last result says cannot fit is not worth measuring.
The prediction scales with image area, which is the right model only
while both rungs actually downsample; where they do not, or where much of
the file is not images, it under-predicts the shrink and the rung is
tried anyway. The error runs towards trying, which is the safe direction.
"""


def human(n: float) -> str:
    if n < MIB:
        return f"{n / 1024:.0f} KB"
    return f"{n / MIB:.1f} MB"


def upload_limit() -> tuple[int, str]:
    """The site's own limit, read from the constant the site enforces.

    Hard-coding it here would be a second copy of a number that has
    already moved once — 64 MB until 2026-08-24 — and the copy that is
    wrong is always the one nobody is looking at. If the source is not
    beside us, because the script was copied somewhere on its own, fall
    back to the published Adobe ceiling and say which was used.
    """
    try:
        text = LIMIT_SOURCE.read_text(encoding="utf-8")
    except OSError:
        return 100 * MIB, "Adobe's published ceiling"

    match = re.search(r"MAX_UPLOAD_BYTES\s*=\s*([\d\s*]+)", text)
    if not match:
        return 100 * MIB, "Adobe's published ceiling"

    size = 1
    for factor in match.group(1).split("*"):
        size *= int(factor.strip())
    return size, "domain/publication.ts"


class Survey:
    """What is actually in a PDF, when PyMuPDF is here to say."""

    def __init__(self, pages: int, images: int, dpi: list[float], colour: bool):
        self.pages = pages
        self.images = images
        self.dpi = dpi
        self.colour = colour

    @property
    def median_dpi(self) -> float | None:
        return statistics.median(self.dpi) if self.dpi else None


def survey(path: Path, sample: int = 40) -> Survey | None:
    """Sample the pages for image resolution, or None if it cannot be read.

    A file too broken to survey may still be one Ghostscript can rewrite,
    and rewriting is often what repairs it — so an unreadable file costs
    the report rather than the run.
    """
    try:
        import pymupdf
    except ImportError:
        try:
            import fitz as pymupdf
        except ImportError:
            return None

    try:
        with pymupdf.open(path) as doc:
            pages = doc.page_count
            step = max(1, pages // sample)
            dpi: list[float] = []
            images = 0
            colour = False
            for index in range(0, pages, step):
                for info in doc[index].get_image_info():
                    images += 1
                    width = info.get("bbox", (0, 0, 0, 0))[2] - info["bbox"][0]
                    if width > 1 and info.get("width"):
                        dpi.append(info["width"] / (width / 72))
                    if info.get("cs-name", "") not in ("DeviceGray", ""):
                        colour = True
            return Survey(pages, images, dpi, colour)
    except Exception:
        return None


def page_count(path: Path) -> int | None:
    found = survey(path, sample=1)
    return found.pages if found else None


def ghostscript(src: Path, dst: Path, dpi: int, quality: int, gray: bool) -> str | None:
    """Re-encode `src` into `dst`. Returns an error message, or None.

    Two of these flags are traps rather than tuning.
    PassThroughJPEGImages defaults on, which hands an existing JPEG
    through untouched and makes -dJPEGQ silently do nothing on precisely
    the scans that need it most. And Ghostscript leaves an image alone
    until it is half again over target, which makes the requested
    resolution a suggestion and the resulting size unpredictable, so the
    downsample thresholds are pinned to 1.0 to get what was asked for.
    """
    args = [
        "gs",
        "-q",
        "-dSAFER",
        "-dBATCH",
        "-dNOPAUSE",
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.7",
        "-dAutoRotatePages=/None",
        "-dDetectDuplicateImages=true",
        "-dCompressFonts=true",
        "-dSubsetFonts=true",
        "-dPassThroughJPEGImages=false",
        "-dAutoFilterColorImages=false",
        "-dAutoFilterGrayImages=false",
        "-dColorImageFilter=/DCTEncode",
        "-dGrayImageFilter=/DCTEncode",
        f"-dJPEGQ={quality}",
        "-dDownsampleColorImages=true",
        "-dColorImageDownsampleType=/Bicubic",
        f"-dColorImageResolution={dpi}",
        "-dDownsampleGrayImages=true",
        "-dGrayImageDownsampleType=/Bicubic",
        f"-dGrayImageResolution={dpi}",
        "-dDownsampleMonoImages=true",
        "-dMonoImageDownsampleType=/Subsample",
        f"-dMonoImageResolution={max(dpi, MONO_FLOOR_DPI)}",
        "-dColorImageDownsampleThreshold=1.0",
        "-dGrayImageDownsampleThreshold=1.0",
        "-dMonoImageDownsampleThreshold=1.0",
    ]
    if gray:
        args += ["-sColorConversionStrategy=Gray", "-dProcessColorModel=/DeviceGray"]
    args += [f"-sOutputFile={dst}", str(src)]

    try:
        done = subprocess.run(args, capture_output=True, text=True)
    except FileNotFoundError:
        return "ghostscript is not installed (apt install ghostscript)"

    if done.returncode != 0:
        detail = (done.stderr or done.stdout or "").strip().splitlines()
        return detail[-1] if detail else f"ghostscript exited {done.returncode}"
    if not dst.exists() or dst.stat().st_size == 0:
        return "ghostscript wrote nothing"
    return None


def rungs_for(min_dpi: int, found: Survey | None) -> list[int]:
    """The ladder to walk, trimmed to what the scan can answer.

    Ghostscript will not invent detail, so a rung above the scan's own
    resolution is the same file written out again — minutes of work for a
    result the next rung down beats on every axis.
    """
    ladder = [d for d in DPI_LADDER if d >= min_dpi] or [min_dpi]

    median = found.median_dpi if found else None
    if median:
        within = [d for d in ladder if d <= median * 1.05]
        if within:
            return within
    return ladder


def describe(path: Path, found: Survey | None) -> None:
    print(f"{path.name}: {human(path.stat().st_size)}")
    if not found:
        print("  (install pymupdf for a look inside)")
        return
    plural = "" if found.pages == 1 else "s"
    print(f"  {found.pages} page{plural}, {found.images} images sampled", end="")
    if found.median_dpi:
        print(f", around {found.median_dpi:.0f} dpi", end="")
    print(", colour" if found.colour else ", greyscale or bitonal")
    if found.images == 0:
        print("  No raster content — this is not a scan, and resampling has")
        print("  nothing to work on. Look at embedded fonts or attachments.")


def shrink(src: Path, dst: Path, target: int, args: argparse.Namespace) -> bool:
    """Walk the ladder until something fits, then put it in place.

    Attempts are written beside the destination so the winner is a rename
    rather than a copy, and so a 200 MB attempt cannot fill a small /tmp.
    Skipped rungs are kept as predictions, so a run that fits nothing can
    still say how far down the ladder is worth going rather than
    reporting only the rung it happened to measure.
    """
    size = src.stat().st_size
    found = survey(src)
    describe(src, found)

    if size <= target and not args.force:
        print(f"  Already under {human(target)}. Nothing to do.\n")
        return True

    ladder = rungs_for(args.min_dpi, found)
    if args.min_dpi < DEFAULT_MIN_DPI:
        print(
            f"  Ladder goes down to {args.min_dpi} dpi, below the {DEFAULT_MIN_DPI} dpi"
            " OCR floor — check a page before trusting the master."
        )

    workdir = Path(tempfile.mkdtemp(prefix=".shrink-", dir=dst.parent))
    attempt = workdir / "attempt.pdf"
    tried: list[tuple[int, int, bool]] = []
    last: tuple[int, int] | None = None

    try:
        for dpi in ladder:
            if last:
                predicted = last[1] * (dpi / last[0]) ** 2
                if predicted > target * SKIP_SLACK:
                    print(f"  {dpi:>4} dpi  skipped, ≈{human(predicted)} by the last result")
                    tried.append((dpi, int(predicted), False))
                    continue

            started = time.monotonic()
            error = ghostscript(src, attempt, dpi, args.quality, args.gray)
            if error:
                print(f"  {dpi:>4} dpi  failed: {error}")
                return False

            made = attempt.stat().st_size
            elapsed = time.monotonic() - started
            fits = made <= target
            print(
                f"  {dpi:>4} dpi  {human(made):>9}  {elapsed:.0f}s"
                f"  {'fits' if fits else 'still too big'}"
            )
            last = (dpi, made)
            tried.append((dpi, made, True))

            if fits:
                return finish(src, attempt, dst, dpi, made, size)

        report_failure(tried, args)
        return False
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def report_failure(tried: list[tuple[int, int, bool]], args: argparse.Namespace) -> None:
    """Say how close the ladder got, and what is left to try.

    Only what is not already in play is offered: telling somebody to try
    the flag they just used is how a tool teaches you to stop reading it.
    """
    floor = min(tried, key=lambda rung: rung[1])
    measured = min((r for r in tried if r[2]), key=lambda rung: rung[1])
    print(f"  Nothing on the ladder fits. Smallest was {human(measured[1])} at {measured[0]} dpi", end="")
    if floor is not measured:
        print(f", and {floor[0]} dpi would be around {human(floor[1])}.")
    else:
        print(".")

    options = []
    if not args.gray:
        options.append("--gray, if the book is black-and-white and the scan is not")
    if args.min_dpi > min(DPI_LADDER):
        options.append(f"--min-dpi under {args.min_dpi}, checking a page afterwards")
    if args.quality > 50:
        options.append(f"--quality under {args.quality}")
    for option in options:
        print(f"    {option}")
    print("  A book too large for any of those wants rescanning, not splitting —")
    print("  a book is whole, and half a scan is not a book.")


def finish(src: Path, attempt: Path, dst: Path, dpi: int, made: int, was: int) -> bool:
    """Check the result is the same book, then put it in place."""
    before, after = page_count(src), page_count(attempt)
    if before is not None and after is not None and before != after:
        print(f"  Refusing it: {before} pages in, {after} out. Ghostscript lost pages.")
        return False

    os.replace(attempt, dst)
    saved = 100 - (made * 100 // max(was, 1))
    print(f"  -> {dst} at {dpi} dpi, {human(was)} to {human(made)} ({saved}% off)\n")
    return True


def main() -> int:
    limit, source = upload_limit()

    parser = argparse.ArgumentParser(
        description="Shrink a scanned PDF until NobleSee will accept it.",
        epilog=f"The limit is {human(limit)}, from {source}.",
    )
    parser.add_argument("pdf", nargs="+", type=Path)
    parser.add_argument("-o", "--output", type=Path, help="only with a single input")
    parser.add_argument("--out-dir", type=Path, help="write results here instead of beside each input")
    parser.add_argument("--inspect", action="store_true", help="report what is in each file and stop")
    parser.add_argument(
        "--min-dpi",
        type=int,
        default=DEFAULT_MIN_DPI,
        help=f"how far the ladder may descend (default {DEFAULT_MIN_DPI}, the OCR floor)",
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=DEFAULT_QUALITY,
        help=f"JPEG quality for re-encoded images (default {DEFAULT_QUALITY})",
    )
    parser.add_argument(
        "--gray",
        action="store_true",
        help="discard colour — often a large win, but red seals and marginalia go with it",
    )
    parser.add_argument(
        "--margin",
        type=float,
        default=DEFAULT_MARGIN_MIB,
        metavar="MB",
        help=f"headroom under the limit (default {DEFAULT_MARGIN_MIB})",
    )
    parser.add_argument("--force", action="store_true", help="re-encode even a file already under the limit")
    args = parser.parse_args()

    if args.output and len(args.pdf) > 1:
        parser.error("--output takes one input; use --out-dir for several")
    if args.out_dir:
        args.out_dir.mkdir(parents=True, exist_ok=True)

    target = int(limit - args.margin * MIB)
    if target <= 0:
        parser.error("--margin leaves nothing to aim at")

    if not args.inspect:
        print(f"Target {human(target)} ({human(limit)} from {source}, {args.margin:g} MB spare)\n")

    failed = 0
    for path in args.pdf:
        if not path.is_file():
            print(f"{path}: no such file")
            failed += 1
            continue

        if args.inspect:
            describe(path, survey(path))
            print()
            continue

        dst = args.output or (args.out_dir or path.parent) / f"{path.stem}-small.pdf"
        if dst.resolve() == path.resolve():
            print(f"{path}: refusing to write over the original")
            failed += 1
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)

        if not shrink(path, dst, target, args):
            failed += 1

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
