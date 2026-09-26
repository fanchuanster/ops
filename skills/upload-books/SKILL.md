---
name: upload-books
description: Stage recently downloaded books (PDF/TXT pairs) into a CSV for manual review before uploading to NobleSee
argument-hint: "[hours] [downloads-folder]"
---

# Upload Books Skill

Prepares a CSV of candidate books to upload to NobleSee. It never calls the
upload API itself — the person running this reviews the CSV and creates each
book by hand afterwards (`tools/ns.py create`, docs/API.md). No conversion, no
EPUB generation: this step is metadata staging only.

Request: $ARGUMENTS

Parse it for an hours window (default 24) and a Downloads folder override
(default the user's own Downloads folder). Then run:

```powershell
python tools\prepare_upload_csv.py --hours <hours> --downloads <folder>
```

Omit `--hours`/`--downloads` when the request gives no override — the script's
own defaults already match "past 24 hours" and the OS Downloads folder.

## What it does

1. Scans the Downloads folder for files modified within the window, in the
   formats NobleSee accepts (`tools/ns.py`'s `CONTENT_TYPE_BY_SUFFIX`: pdf,
   docx, epub, txt, md).
2. Runs `tools/clean-book.ps1` on those files first — strips the mirror
   site's numeric prefix off each filename, shrinks an oversized scan, checks
   the text layer — the same pass a person would otherwise run by hand
   before staging a batch. Pass `--skip-clean` to sample the files as found
   instead.
3. Groups the (now clean) files by filename stem across suffixes — `title.pdf`
   and `title.txt` are the same book, one row.
4. Infers `title`, `author` and `language` from the filename and the book's
   own first two pages (PDF) or first ~4000 characters (TXT) — the same idea
   as the upload route's `extractMetadata()`
   (`apps/web/src/lib/extractMetadata.ts`), reimplemented here since that code
   is TypeScript running inside the Worker, not reachable from a local script.
5. Reads the live catalog (`NOBLESEE_TOKEN`, same credential `tools/ns.py`
   uses) to drop a book whose inferred title already matches one in NobleSee,
   and to guess a `collection_id` from other books by the same author.
6. Writes `tmp/copilot_new_downloads_files.csv` (or wherever `--output`
   points), overwriting it in place on every run rather than piling up a
   timestamped file per run, columns: `title`, `author`, `language`,
   `collection_id`, `collection_title`, `pdf_path`, `txt_path`,
   `other_paths`, `source_stem`, `notes`. The path columns are bare
   filenames, since `clean-book.ps1` already made them the real, clean
   names on disk. Quote marks — straight, curly, or CJK corner brackets —
   are stripped from both filenames (`clean-book.ps1`, via `clean_stem()`)
   and inferred titles, since a cover's own typographic emphasis has no
   place in a filename or a title field.

## Reporting back

After it runs, tell the user the CSV path, how many books were staged, and
how many were skipped as already-in-catalog. Point out any row whose `notes`
column flags a missing author, an unmatched collection, or a possible
duplicate — those need a manual look before anyone uploads. Do not attempt to
create the books; that is the next, separate, human-reviewed step.

## Requirements

- `NOBLESEE_TOKEN` in the environment — the same personal access token
  `tools/ns.py` reads, from `/account/tokens`. Ask for it (or `setx
  NOBLESEE_TOKEN ...`) if it is not set; never write it into a file.
- PyMuPDF (`pip install pymupdf`) for reading a PDF's first two pages. Without
  it, PDF-only groups fall back to a filename-derived title with no author or
  language guess — say so rather than silently guessing.

## Known limits (tell the user, don't silently paper over them)

- Duplicate detection matches on normalized title text. A simplified-vs-
  traditional retitling of the same book (like 寿康宝鉴 vs 壽康寶鑒) is **not**
  caught — flag it if you happen to notice one, but the script can't.
- Author/collection inference is a best-effort text heuristic, not a
  guarantee — every row is meant to be read, not trusted blind.
