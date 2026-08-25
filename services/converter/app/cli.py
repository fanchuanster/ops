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
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

from .docx.builder import build_docx
from .models import BlockKind
from .pipeline.render import classify_pages, read_outline
from .serialize import (
    read_document,
    read_suggestions,
    suggestion_to_dict,
    write_document,
)
from .sources.pdf_in import plan_pages, read_pdf


def cmd_inspect(args: argparse.Namespace) -> int:
    import pymupdf

    with pymupdf.open(args.pdf) as doc:
        print(f"pages:      {doc.page_count}")
        for key, value in doc.metadata.items():
            if value:
                print(f"  {key:<12}{value}")
        sources = classify_pages(Path(args.pdf))
        print(f"text layer: {len(sources.text)} pages")
        print(f"needs ocr:  {len(sources.ocr)} pages")
        print(f"blank:      {len(sources.blank)} pages")
    outline = read_outline(Path(args.pdf))
    print(f"outline:    {len(outline)} entries")
    for entry in outline:
        print(f"  {entry.page:4d}  {'  ' * (entry.level - 1)}{entry.title}")
    return 0


def cmd_convert(args: argparse.Namespace) -> int:
    pdf = Path(args.pdf)
    work = Path(args.work)
    out = Path(args.out)

    pages = list(range(args.limit)) if args.limit else None

    # Said before anything happens, because what it says is how long this
    # will take: OCR is charged per page, and the pages that carry their
    # own text are free.
    sources = plan_pages(pdf, pages, force_ocr=args.force_ocr)
    print(f"pages:      {sources.total}")
    print(f"  text layer  {len(sources.text)}  (extracted, no OCR)")
    print(f"  needs ocr   {len(sources.ocr)}")
    print(f"  blank       {len(sources.blank)}  (skipped)")

    if not sources.ocr and not sources.text:
        print(f"{pdf.name} has no readable pages.", file=sys.stderr)
        return 2

    started = time.time()
    done = 0

    def tick(page):
        nonlocal done
        done += 1
        elapsed = time.time() - started
        rate = elapsed / done
        remaining = (len(sources.ocr) - done) * rate
        print(
            f"  ocr {done}/{len(sources.ocr)}  {rate:.1f}s/page  ~{remaining/60:.0f} min left",
            end="\r",
            flush=True,
        )

    def stage(name):
        print(f"{name}…", flush=True)

    title = args.title or pdf.stem
    doc, report, _ = read_pdf(
        pdf,
        title=title,
        author=args.author,
        cache_dir=work,
        # A name, not an engine: constructing one loads an OCR model
        # into memory, and a PDF that needs no OCR must not pay for that.
        engine=args.engine,
        dpi=args.dpi,
        pages=pages,
        force_ocr=args.force_ocr,
        on_stage=stage,
        on_page=tick,
    )
    if sources.ocr:
        print()

    kinds = Counter(b.kind.value for b in doc.blocks)
    print(f"structure:  {dict(kinds)}")
    print(f"furniture:  {len(report.dropped_furniture)} lines dropped")
    print(f"normalized: {len(report.normalization)} changes")
    print(f"low conf:   {len(report.low_confidence)} lines on {len(doc.low_confidence_pages)} pages")

    out.mkdir(parents=True, exist_ok=True)
    docx_path = build_docx(doc, out / f"{title}.docx", author=args.author)
    print(f"wrote {docx_path}")

    # The structured document, so the later stages can start from the OCR
    # read instead of paying for it again.
    print(f"wrote {write_document(doc, out / f'{title}.document.json')}")

    # The review report is not optional output. A pipeline that corrects
    # a historical text without showing what it changed is not auditable
    # (CLAUDE.md section 7).
    review = out / f"{title}.review.json"
    review.write_text(
        json.dumps(
            {
                "title": title,
                "source": str(pdf),
                "pages": {
                    "text_layer": list(sources.text),
                    "ocr": list(sources.ocr),
                    "blank": list(sources.blank),
                },
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


def cmd_import(args: argparse.Namespace) -> int:
    """Any non-scanned input → the same DOCX master `convert` produces."""
    from .sources import UnsupportedSource, load_source

    source = Path(args.source)
    out = Path(args.out)

    try:
        result = load_source(source, title=args.title, author=args.author)
    except UnsupportedSource as exc:
        print(str(exc), file=sys.stderr)
        return 2

    doc = result.document
    kinds = Counter(b.kind.value for b in doc.blocks)
    print(f"source:     {result.kind.value}")
    print(f"structure:  {dict(kinds)}")
    for note in result.notes:
        print(f"  note: {note}")

    out.mkdir(parents=True, exist_ok=True)
    title = doc.title
    print(f"wrote {build_docx(doc, out / f'{title}.docx', author=doc.author)}")
    print(f"wrote {write_document(doc, out / f'{title}.document.json')}")
    return 0


def cmd_correct(args: argparse.Namespace) -> int:
    from .llm.client import LlmConfig, LlmError, get_client
    from .llm.correct import suggest_corrections

    doc_path = Path(args.document)
    doc = read_document(doc_path)

    try:
        config = LlmConfig.from_env()
    except LlmError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if args.model:
        config = replace(config, model=args.model)

    print(f"proofreading with {config.provider}:{config.model}", flush=True)
    started = time.time()

    def tick(number, total, report):
        elapsed = time.time() - started
        remaining = (total - number) * (elapsed / number)
        print(
            f"  batch {number}/{total}  {len(report.suggestions)} suggested, "
            f"{len(report.rejected)} refused  ~{remaining/60:.0f} min left",
            end="\r",
            flush=True,
        )

    client = get_client(config)
    try:
        report = suggest_corrections(
            doc,
            client,
            batch_chars=args.batch_chars,
            min_confidence=args.min_confidence,
            on_batch=tick,
        )
    except LlmError as exc:
        print(f"\n{exc}", file=sys.stderr)
        return 1
    finally:
        client.close()
    print()

    by_category = Counter(s.category for s in report.suggestions)
    print(f"lines:      {report.lines_examined} in {report.batches} batches")
    print(f"suggested:  {len(report.suggestions)} {dict(by_category)}")
    print(f"refused:    {len(report.rejected)} by the guardrails")

    out = Path(args.out) if args.out else doc_path.with_suffix(".suggestions.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "title": doc.title,
                "document": str(doc_path),
                "model": f"{config.provider}:{config.model}",
                "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "how_to_review": (
                    "Nothing here has been applied. Read each suggestion, set "
                    '"approved": true on the ones you accept and false on the '
                    "rest, then run `converter apply`. Suggestions in the "
                    '"characters" category change what the reader reads and '
                    "deserve the closest look."
                ),
                "suggestions": [suggestion_to_dict(s) for s in report.suggestions],
                "refused": [
                    {
                        "block": r.block,
                        "line": r.line,
                        "original": r.original,
                        "suggested": r.suggested,
                        "model_reason": r.reason,
                        "rejected_because": r.rejected_because,
                    }
                    for r in report.rejected
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    print(f"wrote {out}")
    print("nothing has been changed — review it, then run `converter apply`")
    return 0


def cmd_apply(args: argparse.Namespace) -> int:
    from .llm.apply import apply_suggestions

    doc_path = Path(args.document)
    doc = read_document(doc_path)
    suggestions = read_suggestions(Path(args.suggestions))
    report = apply_suggestions(doc, suggestions)

    print(f"applied:    {len(report.applied)}")
    print(f"declined:   {report.rejected}")
    print(f"unreviewed: {report.pending}")

    for suggestion, current in report.drifted:
        print(
            f"  SKIPPED block {suggestion.block} line {suggestion.line}: the line "
            f"now reads {current!r}, not {suggestion.original!r}",
            file=sys.stderr,
        )
    for suggestion in report.unresolved:
        print(
            f"  SKIPPED block {suggestion.block} line {suggestion.line}: "
            "no such line in this document",
            file=sys.stderr,
        )

    if not report.applied:
        if report.pending:
            print(
                f"\nNothing applied. {report.pending} suggestions are still "
                'unreviewed — set "approved" on them first.',
                file=sys.stderr,
            )
        return 0 if report.ok else 1

    out = Path(args.out) if args.out else doc_path.parent
    out.mkdir(parents=True, exist_ok=True)
    print(f"wrote {write_document(doc, out / doc_path.name)}")
    docx_path = build_docx(doc, out / f"{doc.title}.docx", author=doc.author)
    print(f"wrote {docx_path}")
    return 0 if report.ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="converter")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("inspect", help="report a PDF's structure without converting it")
    p.add_argument("pdf")
    p.set_defaults(func=cmd_inspect)

    p = sub.add_parser(
        "convert", help="PDF → DOCX master, OCR'ing only the pages that need it"
    )
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

    p = sub.add_parser(
        "import",
        help="DOCX, plain text or a text-layer PDF → DOCX master (no OCR)",
    )
    p.add_argument("source")
    p.add_argument("-o", "--out", default="out")
    p.add_argument("--title", help="defaults to the file's own title or filename")
    p.add_argument("--author")
    p.set_defaults(func=cmd_import)

    p = sub.add_parser(
        "correct",
        help="propose AI corrections for review — applies nothing",
    )
    p.add_argument("document", help="the .document.json written by `convert`")
    p.add_argument("-o", "--out", help="defaults to <document>.suggestions.json")
    p.add_argument("--model", help="override the model for this run")
    p.add_argument(
        "--min-confidence",
        type=float,
        default=0.7,
        dest="min_confidence",
        help="refuse suggestions the model is less sure of than this",
    )
    p.add_argument(
        "--batch-chars",
        type=int,
        default=1200,
        dest="batch_chars",
        help="how much text to proofread per request",
    )
    p.set_defaults(func=cmd_correct)

    p = sub.add_parser("apply", help="apply the approved corrections and rebuild the DOCX")
    p.add_argument("document")
    p.add_argument("suggestions")
    p.add_argument("-o", "--out", help="defaults to the document's own directory")
    p.set_defaults(func=cmd_apply)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
