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
4. Reads the live catalog (`NOBLESEE_TOKEN`, same credential `tools/ns.py`
   uses) to drop a book whose inferred title already matches one in NobleSee,
   and to build the `book-collections` shelf list xAI is shown.
5. Sends each group's (cleaned) filenames plus its first page — a rendered
   image for a PDF, sampled text otherwise — to xAI, using the same model,
   system prompt and JSON schema as `identifyFromFirstPage()`
   (`apps/web/src/lib/identifyBook.ts`, `apps/web/src/domain/bookIdentity.ts`),
   the call behind NobleSee's own "Auto-fill with AI" button. Requires
   `XAI_API_KEY` in the environment; without it (or with `--skip-clean`'s
   sibling `--no-ai`), falls back to a local filename/text regex heuristic
   and says so in `notes` — Chinese-only role-marker patterns (编著/著/编述
   etc.), so an English-language book's author is essentially never found
   this way.
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

Warn before that step runs: `tools/ns.py create` now goes live in one call —
it uploads the source, renders the PDF's first page as the cover (via
PyMuPDF, matching `domain/cover.ts`'s box and quality), and publishes the
book, all by default. There is no draft pause to catch a bad row afterward;
review the CSV first. `--skip-cover` and `--skip-publish` opt out of either
step, and `--rights-status` (default `unknown`, not `create`'s public-domain
default) overrides what publishing claims about rights.

## Requirements

- `NOBLESEE_TOKEN` in the environment — the same personal access token
  `tools/ns.py` reads, from `/account/tokens`. Ask for it (or `setx
  NOBLESEE_TOKEN ...`) if it is not set; never write it into a file.
- `XAI_API_KEY` in the environment for the AI-backed title/author/language/
  collection read. Ask for it (or `setx XAI_API_KEY ...`) the same way if
  it is not set; without it the script falls back to the older filename/text
  heuristic and flags every row as such.
- PyMuPDF (`pip install pymupdf`) to render a PDF's first page as the image
  sent to xAI (or, without `XAI_API_KEY`, to read its first two pages for the
  fallback heuristic). Without it, PDF-only groups fall back further still to
  a filename-derived title with no author or language guess.

## Known limits (tell the user, don't silently paper over them)

- Duplicate detection matches on normalized title text. A simplified-vs-
  traditional retitling of the same book (like 寿康宝鉴 vs 壽康寶鑒) is **not**
  caught — flag it if you happen to notice one, but the script can't.
- xAI reads what the page shows, not a general-knowledge lookup — a title or
  author it cannot read with confidence from the filenames and first page
  comes back null, and `notes` says so. Without `XAI_API_KEY`, the fallback
  heuristic is weaker still (regex patterns tuned for Chinese role markers,
  blind to English authorship credits) — every row is meant to be read, not
  trusted blind either way.
