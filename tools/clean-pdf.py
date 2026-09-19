#!/usr/bin/env python3
"""Clean a downloaded book's filename and check that it's fit to upload.

Files pulled from public archive mirrors carry two unrelated problems.
The filename is usually a database id and a byte-range suffix that
nobody typing a book's title would ever include -- prefixed and suffixed
runs of digits and hyphens around the title that actually matters. And
the file itself is routinely wrong in a way its extension doesn't show:
a PDF scan oversized for the 100 MB upload ceiling (see tools/shrink-pdf.py,
whose reasoning applies unchanged here), or a plain-text source so small
it is nothing but a truncated download or an empty placeholder. This
tool answers all of it, in one pass, at the point of intake, for both
formats NobleSee takes as a plain-text or scanned source:

    tools/clean-pdf.py *.pdf *.txt
    tools/clean-pdf.py scan.pdf --dry-run
    tools/clean-pdf.py scan.pdf --skip-shrink
    tools/clean-pdf.py scan.pdf --skip-rename
    tools/clean-pdf.py scan.pdf --keep-original
    tools/clean-pdf.py book.txt

For each input, any leading or trailing run of digits and '-' is
stripped from the file's stem (the extension is untouched) and the file
is renamed in place:

    619294728-13230487-南怀瑾选集-第9卷-...-2013-03-P699.pdf
    -> 南怀瑾选集-第9卷-...-2013-03-P.pdf

The strip is literal -- only digits and '-' -- so a trailing letter such
as the "P" above stops it and is kept; this is a filename cleanup, not a
guess at where the title "really" ends.

What the strip exposes at the edge is then trimmed with it: the space,
'.' or '_' that was separating the digits from the title, which is
nobody's idea of a name once the digits are gone.

    南怀瑾著作诗词辑录.练性乾编.复旦大学出版社.19.pdf
    -> 南怀瑾著作诗词辑录.练性乾编.复旦大学出版社.pdf

That trim runs once, after the digits, and does not send the strip round
again -- so "book.2013.03" comes back as "book.2013" rather than "book".
An edge is cleaned here; where the title ends is still the uploader's
judgement. Renaming applies the same way to a .txt input as to a .pdf --
mirror sites hang the same digit-and-byte-range cruft off a plain-text
download as they do off a scan.

What happens next depends on the extension, because the two formats fail
in opposite directions. A PDF is checked against the same 100 MB ceiling
tools/shrink-pdf.py enforces; anything over it is handed to that tool's
own re-encoding ladder and, by default, replaces the file in place -- one
file at a clean name is what is left afterwards, not an original plus a
"-small" copy sitting beside it. Pass --keep-original to leave the input
where it is and put the shrunk copy beside it, named for the size it came
out at, the way shrink-pdf.py names its own results. A PDF is then also
checked for whether its text layer is a text at all (tools/pdf.py's
check_readability -- see that module for why the vocabulary a file draws
on answers that and a font's own metadata does not); this is a report,
not a fix, because no re-encoding step here can put back characters the
file never carried.

A .txt file has no page images to shrink and no font to render, so
neither of those applies. What it can fail at is the opposite of
oversized: a plain-text source under 1 KB is not a book, it is a
truncated download or an empty placeholder, and is reported as a
failure rather than silently accepted.

Renaming, shrinking and the glyph check are independent passes and
either of the PDF ones can be skipped; a .txt input only ever runs
renaming and the size floor.

The engine -- the ladder, the Ghostscript call, the survey and the glyph
check -- lives in tools/pdf.py, shared with tools/shrink-pdf.py. This file
is the CLI: filename cleanup, the size floor for text sources, argument
parsing and the per-file loop.
"""

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pdf as pdf_lib

LEADING = re.compile(r"^[0-9\-]+")
TRAILING = re.compile(r"[0-9\-]+$")
SEPARATORS = " \t._"
MIN_TEXT_BYTES = 1024


def clean_stem(stem: str) -> str:
    """Strip a leading/trailing run of digits and '-' from a file's stem.

    Applied once, as a single contiguous run from each edge -- not
    repeatedly and not token-by-token -- so a title that legitimately
    starts or ends with a number in the middle of other characters is
    left alone.

    The separator the digits were hanging off goes with them, or the
    tidied name ends in the dot that used to introduce a volume number
    and "...出版社.19.pdf" becomes "...出版社..pdf". A leading one matters
    for a second reason: a name starting with '.' is a hidden file.
    """
    cleaned = TRAILING.sub("", LEADING.sub("", stem))
    return cleaned.strip(SEPARATORS)


def unique_path(path: Path) -> Path:
    """Avoid clobbering an unrelated file already at the clean name.

    Numbered the same way NobleSee's own storage numbers a repeated stem
    (docs/STORAGE.md section 14): stem, stem-2, stem-3, ...
    """
    if not path.exists():
        return path
    n = 2
    while True:
        candidate = path.with_name(f"{path.stem}-{n}{path.suffix}")
        if not candidate.exists():
            return candidate
        n += 1


def rename_clean(path: Path, dry_run: bool) -> Path:
    cleaned = clean_stem(path.stem)
    if not cleaned:
        print(f"  name is nothing but digits and '-' -- leaving it as is")
        return path
    if cleaned == path.stem:
        print(f"  name is already clean")
        return path

    dst = unique_path(path.with_name(f"{cleaned}{path.suffix}"))
    if dst != path.with_name(f"{cleaned}{path.suffix}"):
        print(f"  '{cleaned}{path.suffix}' is taken -- using '{dst.name}' instead")

    print(f"  '{path.name}' -> '{dst.name}'")
    if not dry_run:
        path.rename(dst)
    return path if dry_run else dst


def shrink_if_needed(path: Path, args: argparse.Namespace) -> bool:
    """Hand an oversized file to pdf.py's ladder and keep the result.

    The ladder writes its winner where it is told and refuses to write
    over its own input, so replacing the file in place is a shrink to a
    scratch name beside it and then a rename -- which is what leaves one
    file at one clean name rather than an original with a smaller copy
    sitting next to it.

    --keep-original names nothing itself: the destination is left to
    pdf.py's shrink(), so the copy is "<stem>-28MB.pdf", carrying the
    size it came out at exactly as shrink-pdf.py's own runs do.
    """
    limit, source = pdf_lib.upload_limit()
    size = path.stat().st_size
    if size <= limit:
        print(f"  {pdf_lib.human(size)}, under the {pdf_lib.human(limit)} limit -- nothing to shrink")
        return True

    print(f"  {pdf_lib.human(size)}, over the {pdf_lib.human(limit)} limit ({source}) -- shrinking")
    if args.dry_run:
        print("  (dry run: would shrink here)")
        return True

    target = int(limit - args.margin * pdf_lib.MIB)
    shrink_args = argparse.Namespace(
        min_dpi=args.min_dpi,
        quality=args.quality,
        mono_dpi=args.mono_dpi,
        gray=args.gray,
        force=False,
    )

    if args.keep_original:
        return pdf_lib.shrink(path, path.parent, None, target, shrink_args)

    scratch = path.with_name(f"{path.stem}.shrinking{path.suffix}")
    ok = pdf_lib.shrink(path, path.parent, scratch, target, shrink_args)
    if ok and scratch.exists():
        scratch.replace(path)
    elif scratch.exists():
        scratch.unlink()
    return ok


def check_min_size(path: Path) -> bool:
    """Reject a plain-text source too small to be a real book.

    A .txt has no page count and no font to fail against, so the one
    thing left to check for is the failure mode that is specific to
    text: a mirror download that stopped partway, or a placeholder file
    with nothing in it. 1 KB is generous -- even a short poem clears it
    by a wide margin -- so this only ever catches the broken case.
    """
    size = path.stat().st_size
    if size >= MIN_TEXT_BYTES:
        print(f"  {pdf_lib.human(size)} -- at or above the {pdf_lib.human(MIN_TEXT_BYTES)} floor")
        return True
    print(f"  {pdf_lib.human(size)} -- under the {pdf_lib.human(MIN_TEXT_BYTES)} floor, likely truncated or empty")
    return False


def process_one(path: Path, args: argparse.Namespace) -> bool:
    """Run rename plus the format-appropriate checks on one file, in order.

    Each step can fail independently, and none of them is worth running
    past a failure: a renamed-but-still-oversized file is not a file
    shrink-pdf.py's ladder should be pointed at again under a name that
    no longer matches what's on disk, so the first failing step stops
    the file right there rather than pressing on to report on state that
    is already wrong. Returns False for anything that isn't a clean
    result -- a step that failed outright, or a step that ran cleanly but
    reports the file as unusable -- and True only for a file that cleared
    every check that applies to its format with nothing to flag.

    A PDF gets the size ceiling and the glyph check; a .txt has neither
    a page image to shrink nor a font to render, so it gets the size
    floor instead. Which checks apply is decided once, by extension, so
    a .txt is never handed to Ghostscript and a .pdf is never judged by
    a plain-text byte count.
    """
    print(f"{path.name}")
    current = path
    if not args.skip_rename:
        current = rename_clean(current, args.dry_run)

    if current.suffix.lower() == ".txt":
        if not check_min_size(current):
            return False
        return True

    if not args.skip_shrink:
        if not shrink_if_needed(current, args):
            print(f"  {current.name}: shrink failed -- stopping")
            return False

    found = pdf_lib.check_readability(current)
    pdf_lib.describe_readability(current, found)
    if found is None or not found.readable():
        return False

    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("pdf", metavar="file", nargs="+", type=Path, help=".pdf and/or .txt sources")
    parser.add_argument("--dry-run", action="store_true", help="show what would happen, change nothing")
    parser.add_argument("--skip-rename", action="store_true", help="only run the size / glyph checks")
    parser.add_argument("--skip-shrink", action="store_true", help="only clean the filename (PDFs)")
    parser.add_argument(
        "--keep-original",
        action="store_true",
        help="leave the input alone and write the shrunk copy beside it, named for its size",
    )
    parser.add_argument("--min-dpi", type=int, default=None, help="passed through to the shrink ladder")
    parser.add_argument("--quality", type=int, default=None, help="passed through to the shrink ladder")
    parser.add_argument("--mono-dpi", type=int, default=None, help="passed through to the shrink ladder")
    parser.add_argument("--gray", action="store_true", help="passed through to the shrink ladder")
    parser.add_argument("--margin", type=float, default=None, help="passed through to the shrink ladder")
    args = parser.parse_args()

    if args.min_dpi is None:
        args.min_dpi = pdf_lib.DEFAULT_MIN_DPI
    if args.quality is None:
        args.quality = pdf_lib.DEFAULT_QUALITY
    if args.mono_dpi is None:
        args.mono_dpi = pdf_lib.DEFAULT_MONO_DPI
    if args.margin is None:
        args.margin = pdf_lib.DEFAULT_MARGIN_MIB

    for path in args.pdf:
        if not path.is_file():
            print(f"{path}: no such file")
            return 1

        if not process_one(path, args):
            return 1
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
