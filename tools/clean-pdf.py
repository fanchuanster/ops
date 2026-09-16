#!/usr/bin/env python3
"""Clean a scanned PDF's filename and keep it under the upload limit.

Files pulled from public archive mirrors carry two unrelated problems.
The filename is usually a database id and a byte-range suffix that
nobody typing a book's title would ever include -- prefixed and suffixed
runs of digits and hyphens around the title that actually matters. And
the scan itself is routinely oversized (see tools/shrink-pdf.py, whose
reasoning about the 100 MB ceiling applies unchanged here). This tool
answers both, in one pass, at the point of intake:

    tools/clean-pdf.py *.pdf
    tools/clean-pdf.py scan.pdf --dry-run
    tools/clean-pdf.py scan.pdf --skip-shrink
    tools/clean-pdf.py scan.pdf --skip-rename
    tools/clean-pdf.py scan.pdf --keep-original

For each input, any leading or trailing run of digits and '-' is
stripped from the file's stem (the extension is untouched) and the file
is renamed in place:

    619294728-13230487-南怀瑾选集-第9卷-...-2013-03-P699.pdf
    -> 南怀瑾选集-第9卷-...-2013-03-P.pdf

The strip is literal -- only digits and '-' -- so a trailing letter such
as the "P" above stops it and is kept; this is a filename cleanup, not a
guess at where the title "really" ends. Leftover whitespace at either
edge, which naturally appears once the surrounding digits are gone, is
also trimmed.

The (possibly renamed) file is then checked against the same 100 MB
ceiling tools/shrink-pdf.py enforces. Anything over it is handed to that
tool's own re-encoding ladder and, by default, replaces the file in
place -- one file at a clean name is what is left afterwards, not an
original plus a "-small" copy sitting beside it. Pass --keep-original to
leave the input where it is and put the shrunk copy beside it, named for
the size it came out at, the way shrink-pdf.py names its own results.

Renaming never touches page content, and shrinking never touches the
name -- the two passes are independent and either can be skipped.
"""

import argparse
import importlib.util
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = Path(__file__).resolve().parent

LEADING = re.compile(r"^[0-9\-]+")
TRAILING = re.compile(r"[0-9\-]+$")


def _load_shrink_pdf():
    """Import tools/shrink-pdf.py despite the hyphen in its filename.

    A hyphenated module can't be named in an `import` statement, so it is
    loaded by path instead. This keeps the two tools sharing one
    implementation of the upload limit and the re-encoding ladder rather
    than drifting into two copies of the same numbers.
    """
    spec = importlib.util.spec_from_file_location("shrink_pdf", TOOLS_DIR / "shrink-pdf.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def clean_stem(stem: str) -> str:
    """Strip a leading/trailing run of digits and '-' from a file's stem.

    Applied once, as a single contiguous run from each edge -- not
    repeatedly and not token-by-token -- so a title that legitimately
    starts or ends with a number in the middle of other characters is
    left alone.
    """
    cleaned = TRAILING.sub("", LEADING.sub("", stem))
    return cleaned.strip()


def unique_path(path: Path) -> Path:
    """Avoid clobbering an unrelated file already at the clean name.

    Numbered the same way NobleSee's own storage numbers a repeated stem
    (CLAUDE.md section 14): stem, stem-2, stem-3, ...
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


def shrink_if_needed(path: Path, args: argparse.Namespace, shrink_pdf) -> bool:
    """Hand an oversized file to shrink-pdf.py's ladder and keep the result.

    The ladder writes its winner where it is told and refuses to write
    over its own input, so replacing the file in place is a shrink to a
    scratch name beside it and then a rename -- which is what leaves one
    file at one clean name rather than an original with a smaller copy
    sitting next to it.

    --keep-original names nothing itself: the destination is left to
    shrink-pdf.py, so the copy is "<stem>-28MB.pdf", carrying the size it
    came out at exactly as that tool's own runs do.
    """
    limit, source = shrink_pdf.upload_limit()
    size = path.stat().st_size
    if size <= limit:
        print(f"  {shrink_pdf.human(size)}, under the {shrink_pdf.human(limit)} limit -- nothing to shrink")
        return True

    print(f"  {shrink_pdf.human(size)}, over the {shrink_pdf.human(limit)} limit ({source}) -- shrinking")
    if args.dry_run:
        print("  (dry run: would call shrink-pdf.py here)")
        return True

    target = int(limit - args.margin * shrink_pdf.MIB)
    shrink_args = argparse.Namespace(
        min_dpi=args.min_dpi,
        quality=args.quality,
        mono_dpi=args.mono_dpi,
        gray=args.gray,
        force=False,
    )

    if args.keep_original:
        return shrink_pdf.shrink(path, path.parent, None, target, shrink_args)

    scratch = path.with_name(f"{path.stem}.shrinking{path.suffix}")
    ok = shrink_pdf.shrink(path, path.parent, scratch, target, shrink_args)
    if ok and scratch.exists():
        scratch.replace(path)
    elif scratch.exists():
        scratch.unlink()
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("pdf", nargs="+", type=Path)
    parser.add_argument("--dry-run", action="store_true", help="show what would happen, change nothing")
    parser.add_argument("--skip-rename", action="store_true", help="only check size / shrink")
    parser.add_argument("--skip-shrink", action="store_true", help="only clean the filename")
    parser.add_argument(
        "--keep-original",
        action="store_true",
        help="leave the input alone and write the shrunk copy beside it, named for its size",
    )
    parser.add_argument("--min-dpi", type=int, default=None, help="passed through to shrink-pdf.py")
    parser.add_argument("--quality", type=int, default=None, help="passed through to shrink-pdf.py")
    parser.add_argument("--mono-dpi", type=int, default=None, help="passed through to shrink-pdf.py")
    parser.add_argument("--gray", action="store_true", help="passed through to shrink-pdf.py")
    parser.add_argument("--margin", type=float, default=None, help="passed through to shrink-pdf.py")
    args = parser.parse_args()

    shrink_pdf = _load_shrink_pdf()
    if args.min_dpi is None:
        args.min_dpi = shrink_pdf.DEFAULT_MIN_DPI
    if args.quality is None:
        args.quality = shrink_pdf.DEFAULT_QUALITY
    if args.mono_dpi is None:
        args.mono_dpi = shrink_pdf.DEFAULT_MONO_DPI
    if args.margin is None:
        args.margin = shrink_pdf.DEFAULT_MARGIN_MIB

    failed = 0
    for path in args.pdf:
        if not path.is_file():
            print(f"{path}: no such file")
            failed += 1
            continue

        print(f"{path.name}")
        current = path
        if not args.skip_rename:
            current = rename_clean(current, args.dry_run)
        if not args.skip_shrink:
            if not shrink_if_needed(current, args, shrink_pdf):
                failed += 1
        print()

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
