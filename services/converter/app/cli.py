"""Command-line entry point for the conversion pipeline.

A CLI exists so a conversion is runnable and inspectable by hand — most
of all the AI correction stage, which is two commands with a human
review file between them because that is what makes it auditable
(CLAUDE.md section 7).

`convert` used to live here too: rasterize a scan, read it with
PaddleOCR, structure it, write a master. It went on 2026-08-26 with the
OCR engine itself. Reading a scan is Adobe's Export PDF, called from the
web application, which returns the master already built — so there is
nothing left for a local command to do to a scan, and `import` covers
every file that can be read without one.
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


def cmd_import(args: argparse.Namespace) -> int:
    """Any readable input → a DOCX master."""
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
