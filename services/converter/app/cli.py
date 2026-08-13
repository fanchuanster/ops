"""Command-line entry point for the conversion pipeline.

The service will eventually drive this from a job queue (CLAUDE.md
section 13). A CLI exists first because a conversion has to be runnable
and inspectable by hand: a book takes hours to OCR, and an editor needs
to be able to re-run the structure and DOCX stages against a cached read
without paying for the OCR again.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

from .docx.builder import build_docx
from .models import BlockKind
from .ocr.base import get_engine
from .pipeline.ocr_pass import ocr_pages
from .pipeline.render import has_text_layer, read_outline, render_pages
from .pipeline.structure import build_document


def cmd_inspect(args: argparse.Namespace) -> int:
    import pymupdf

    with pymupdf.open(args.pdf) as doc:
        print(f"pages:      {doc.page_count}")
        for key, value in doc.metadata.items():
            if value:
                print(f"  {key:<12}{value}")
        print(f"text layer: {has_text_layer(Path(args.pdf))}")
    outline = read_outline(Path(args.pdf))
    print(f"outline:    {len(outline)} entries")
    for entry in outline:
        print(f"  {entry.page:4d}  {'  ' * (entry.level - 1)}{entry.title}")
    return 0


def cmd_convert(args: argparse.Namespace) -> int:
    pdf = Path(args.pdf)
    work = Path(args.work)
    out = Path(args.out)

    if has_text_layer(pdf) and not args.force_ocr:
        print(
            f"{pdf.name} already has a text layer — OCR would only degrade it.\n"
            "Re-run with --force-ocr if the embedded text is known to be bad.",
            file=sys.stderr,
        )
        return 2

    pages = list(range(args.limit)) if args.limit else None

    print("rendering pages…", flush=True)
    images = render_pages(pdf, work / "images", dpi=args.dpi, pages=pages)
    indices = pages if pages is not None else list(range(len(images)))
    print(f"  {len(images)} pages", flush=True)

    engine = get_engine(args.engine)
    started = time.time()
    done = 0

    def tick(page):
        nonlocal done
        done += 1
        elapsed = time.time() - started
        rate = elapsed / done
        remaining = (len(images) - done) * rate
        print(
            f"  ocr {done}/{len(images)}  {rate:.1f}s/page  ~{remaining/60:.0f} min left",
            end="\r",
            flush=True,
        )

    print(f"reading with {engine.name}…", flush=True)
    ocr = ocr_pages(images, engine, work / "ocr", indices=indices, on_page=tick)
    print()

    outline = read_outline(pdf)
    title = args.title or pdf.stem
    doc, report = build_document(ocr, outline, title)

    kinds = Counter(b.kind.value for b in doc.blocks)
    print(f"structure:  {dict(kinds)}")
    print(f"furniture:  {len(report.dropped_furniture)} lines dropped")
    print(f"normalized: {len(report.normalization)} changes")
    print(f"low conf:   {len(report.low_confidence)} lines on {len(doc.low_confidence_pages)} pages")

    out.mkdir(parents=True, exist_ok=True)
    docx_path = build_docx(doc, out / f"{title}.docx", author=args.author)
    print(f"wrote {docx_path}")

    # The review report is not optional output. A pipeline that corrects
    # a historical text without showing what it changed is not auditable
    # (CLAUDE.md section 7).
    review = out / f"{title}.review.json"
    review.write_text(
        json.dumps(
            {
                "title": title,
                "source": str(pdf),
                "blocks": dict(kinds),
                "dropped_furniture": report.dropped_furniture,
                "normalizations": report.normalization.changes,
                "low_confidence": report.low_confidence,
                "skipped_pages": sorted(report.skipped_pages),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print(f"wrote {review}")

    text_path = out / f"{title}.txt"
    text_path.write_text(
        "\n\n".join(
            f"[{b.kind.value}] {b.text}" + (f"\n{b.source_ref}" if b.source_ref else "")
            for b in doc.blocks
        )
    )
    print(f"wrote {text_path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="converter")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("inspect", help="report a PDF's structure without converting it")
    p.add_argument("pdf")
    p.set_defaults(func=cmd_inspect)

    p = sub.add_parser("convert", help="scanned PDF → editable DOCX master")
    p.add_argument("pdf")
    p.add_argument("-o", "--out", default="out", help="where the DOCX and review report go")
    p.add_argument("-w", "--work", default="work", help="render and OCR cache")
    p.add_argument("--title", help="defaults to the PDF filename")
    p.add_argument("--author")
    p.add_argument("--engine", default="paddle")
    p.add_argument("--dpi", type=int, default=300, help="only used for pages that must be rasterized")
    p.add_argument("--limit", type=int, help="convert only the first N pages")
    p.add_argument("--force-ocr", action="store_true", help="OCR even if a text layer exists")
    p.set_defaults(func=cmd_convert)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
