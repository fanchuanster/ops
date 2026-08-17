# NobleSee Converter

Turns a book into the editable DOCX master that everything reader-facing
is generated from (`CLAUDE.md` sections 5, 7–11).

Four kinds of input, one master:

    scanned PDF ─────── convert ──┐   (OCR; hours)
    text-layer PDF ──── import ───┤   (extract; instant)
    DOCX ────────────── import ───┼──> DOCX master + document.json
    plain text ──────── import ───┘          │
                                             │
                                        correct ──> suggestions.json
                                             │
                                     ✋ human review
                                             │
                                         apply ──> corrected DOCX
                                                   + document.json

The split between `convert` and `import` is OCR and nothing else. OCR
takes hours, needs a cache and reports progress; the other three paths
return in milliseconds and have nothing to resume. Downstream, none of
them are distinguishable — correction, review and format generation all
start from a `Document` and do not know where it came from.

It is driven by a CLI rather than an API. That is deliberate and
temporary: a book takes hours to OCR, and an editor needs to re-run the
later stages against a cached read without paying for the OCR again. The
FastAPI job API and the Cloudflare Queues consumer come later
(`docs/ROADMAP.md`).

## Running it

    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python -m app.cli --help

### `inspect` — what is in this PDF?

    .venv/bin/python -m app.cli inspect book.pdf

Reports the page count, metadata, whether there is already a text layer,
and the outline. A PDF that has a real text layer should not be OCR'd —
`convert` refuses unless you pass `--force-ocr`.

### `convert` — scan to master

    .venv/bin/python -m app.cli convert book.pdf --title 論語別裁 --author 南懷瑾

Renders pages (PyMuPDF), reads them (PaddleOCR, behind
`app/ocr/base.py`), reconstructs structure from page geometry, and writes:

| file | what it is |
|---|---|
| `<title>.docx` | the editable master, in real named styles |
| `<title>.document.json` | the structured document, input to every later stage |
| `<title>.review.json` | what the pass dropped, normalized and could not read confidently |
| `<title>.txt` | a flat read-through, for eyeballing |

`--limit N` converts the first N pages, which is how to shake out a new
book without waiting hours. Rendered pages and OCR results are cached
under `--work`, so a re-run costs nothing until the OCR itself changes.

### `import` — everything that is not a scan

    .venv/bin/python -m app.cli import book.docx --title 論語 --author 孔子
    .venv/bin/python -m app.cli import notes.txt
    .venv/bin/python -m app.cli import born-digital.pdf

Produces the same `<title>.docx` and `<title>.document.json` that
`convert` does. The input kind is detected from the file's **content**,
not its extension — an uploaded file's name is whatever the uploader's
browser claimed, and a `.pdf` that is really a zip is refused rather than
handed to PyMuPDF.

| input | how it is read |
|---|---|
| DOCX | paragraph styles. A NobleSee master round-trips exactly, heading *levels* included — `Heading 1`/`Title` → chapter, anything below it → section, everything else → prose. A foreign DOCX takes the same fallback |
| text-layer PDF | PyMuPDF spans fed through the *same* geometry rules the scanned path uses, so verse, footnotes and attributions are recovered identically — with no OCR |
| plain text | blank lines separate paragraphs; `# heading` and a lone `（十一）` marker are recognised |
| scanned PDF | refused, with a pointer to `convert` |

Two deliberate refusals to guess:

- **Punctuation normalization is off for exact text.** Those rules repair
  what an OCR engine got wrong about full-width punctuation. A DOCX or a
  born-digital PDF has nothing to repair, and "repairing" it would be
  editing the author rather than correcting the machine.
- **Short lines in a text file are not treated as verse.** Classical
  Chinese prose is set in short lines too, and a wrong guess shatters a
  paragraph into fake poetry. Verse is better marked up by an editor in
  the master, where the mistake is visible and cheap.

A text file must be UTF-8. GB18030 or Big5 decoded as UTF-8 does not fail
cleanly — it produces mojibake that would flow into a published book — so
a mis-encoded file is refused with a message rather than accepted.

### `correct` — AI proofreading, as suggestions

    .venv/bin/python -m app.cli correct out/論語別裁.document.json

**This command changes nothing.** It asks a model to find places where
the OCR engine misread the page, and writes them to
`<title>.suggestions.json` for a human to accept or decline. That
separation is the requirement in `CLAUDE.md` section 7 — the AI must not
blindly rewrite literary or historical source material — and it is
enforced by there being two commands with a review step between them.

The model is not trusted. Every proposal goes through deterministic
guardrails in `app/llm/correct.py` before it is even offered for review,
because "preserve the original wording" cannot be enforced by asking
politely in a prompt. A proposal is refused if it:

- changes the line's length by more than 3 characters or 15%
- is less than 75% similar to the original
- changes more than 2 substantive (non-punctuation) characters
- carries a confidence below `--min-confidence` (0.7 by default)
- points at a line that was not in the batch

Refusals are written into the same file under `refused`, with the reason.
A stage that silently discards what the model said would be as
unauditable as one that silently applies it.

Each accepted suggestion is categorized from the diff itself, never from
the model's own description of it:

- **`punctuation`** — only punctuation and spacing differ. The safest
  class, and the same kind of repair `pipeline/normalize.py` already
  makes deterministically.
- **`characters`** — a character the reader would actually read has
  changed. Give these the closest look. A model will happily describe
  「說」 → 「説」 as "punctuation fixes" in passing.

### `apply` — take the approved corrections

Edit the suggestions file, set `"approved": true` on what you accept
(and `false` on what you decline), then:

    .venv/bin/python -m app.cli apply out/論語別裁.document.json \
                                     out/論語別裁.suggestions.json

Only approved suggestions are applied, and only where the line still
reads exactly as it did when the suggestion was made. A document that has
been re-OCR'd or hand-edited in between has moved on, and a stale
suggestion applied to it would corrupt a line nobody reviewed — so those
are reported and skipped, and the command exits non-zero.

## The LLM provider

Endpoint, model and key all come from the environment; none of them may
be hard-coded (`CLAUDE.md` section 4). Two providers ship, both speaking
the OpenAI chat-completions shape, so nothing downstream of
`app/llm/client.py` knows which is answering.

| variable | default | notes |
|---|---|---|
| `LLM_PROVIDER` | `xai` | or `vllm` |
| `XAI_API_KEY` | — | required for xAI; read from the repo-root `.env`, which is gitignored |
| `XAI_MODEL` | `grok-4.20-0309-non-reasoning` | the cheap text model |
| `VLLM_BASE_URL` | — | required for vLLM; no default, it is deployment configuration |
| `VLLM_MODEL` | `google/gemma-4-31B-it-qat-w4a16-ct` | |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | — | override whichever provider is selected |
| `LLM_JSON_MODE` | `1` | set `0` for an endpoint that rejects `response_format` |

**On the model choice.** Correction is a narrow task over short inputs,
so it does not need the frontier model. `grok-4.20-0309-non-reasoning`
spends no reasoning tokens — which are billed as output at twice the
input rate and are the real cost of running a whole book — and produced
the same corrections as `grok-4.6` on sample lines at 2.4× cheaper
output. Note that `grok-imagine-*` are image and video models and cannot
serve this stage at all.

**On vLLM.** The self-hosted Gemma endpoint remains a legitimate option
and needs no API key, but it is reachable on the internal network only.
A converter running on that network can point straight at it:

    LLM_PROVIDER=vllm VLLM_BASE_URL=http://10.211.51.231:8000/v1 \
      .venv/bin/python -m app.cli correct out/book.document.json

A converter running anywhere else — Cloudflare Containers, or any host
off that network — needs the endpoint exposed through a tunnel first, and
that tunnel must be authenticated. An unauthenticated OpenAI-compatible
endpoint on the public internet is someone else's free GPU. Put
Cloudflare Access in front of it and set `LLM_BASE_URL` to the tunnel
hostname; nothing in the code changes.

**On what gets sent.** The provider is now a third party, which the
self-hosted endpoint was not. Public-domain library text is fine to send.
A reader's private upload is a different question — see `CLAUDE.md`
section 6 on user-owned content, which becomes load-bearing the moment
the conversion portal accepts uploads.

## Tests

    .venv/bin/python -m pytest tests/ -q

No network. The model is untrusted input, so what the tests exercise is
the layer that refuses it, with canned completions standing in for the
endpoint.

## Layout

```
app/
  cli.py            the entry point: inspect, convert, import, correct, apply
  models.py         Box, OcrPage, Block, Document, Suggestion — no library types
  serialize.py      document.json and suggestions.json
  sources/          input adapters: detect, docx_in, text, pdf_text
  ocr/              the OCR abstraction; PaddleOCR behind it
  pipeline/         render, OCR pass, line grouping, normalization, structure
  llm/              client (provider-agnostic), correct (guardrails), apply
  docx/             the editable master
```

The round trip is the property that holds this together: a `Document`
written to a master and read back is the same document, verified in
`tests/test_sources.py`. Without it, "generate reader formats from the
*approved* master" (CLAUDE.md section 5) could not be true — the approved
file has to be readable, which is why the builder writes real named
styles rather than direct formatting.

## The job API

`POST /api/v1/jobs` returns a job id immediately and `GET
/api/v1/jobs/{id}` reports where it has got to, through the states in
CLAUDE.md section 13. The request never waits for the work: a scanned
book takes minutes to hours to OCR.

```bash
uvicorn app.api.main:app --port 8000

curl -X POST localhost:8000/api/v1/jobs -H 'Content-Type: application/json' \
  -d '{"source_key":"conversion/<id>/input/source.pdf","book_id":"42","title":"..."}'
# -> 202 {"job_id":"...","status":"queued"}

curl localhost:8000/api/v1/jobs/<job_id>
# -> {"status":"format_generation", ...}
```

`allow_third_party_ai` defaults to **false** and that default is
load-bearing: a reader's private upload must not be sent to xAI
(CLAUDE.md section 6.1). Forgetting the field cannot leak someone's
book — only a caller that deliberately sets it opts in.

Work runs on a bounded thread pool, not Celery. The pipeline is
CPU-bound and drops into native code (PyMuPDF, PaddleOCR, WeasyPrint)
where it matters, and the durable record of a conversion is the Book row
in the web application — so a broker would be a second stateful service
to operate for queueing a thread pool already does. Scaling past one
machine means putting a queue between the web app and *several* of
these, which is the boundary CLAUDE.md already describes, not a broker
inside this one.

## Formats

EPUB 3 (`app/epub`) and three PDF sizes (`app/pdf`) are generated from
the same HTML rendering in `app/render`, so the two cannot drift — a
footnote that appears in one and vanishes in the other is the classic
failure and it is invisible until a reader hits that page.

The EPUB deliberately sets no page size, no font size and no measure:
the device decides, which is the whole reason EPUB is the primary format
(CLAUDE.md section 10).

Its table of contents is two levels deep where the book is: one XHTML
document per chapter, with the chapter's section heads beneath it as
anchors into that document. A chapter with no sections is a plain entry
rather than a parent with nothing under it. That nesting is why heading
*level* has to survive the master round trip — a section read back as a
chapter would start a new page, a new file and a new contents entry, and
the corrected master would come back as a different book from the one
the editor approved. The PDFs exist because a fixed layout cannot
reflow, so serving a reader who needs larger type means rendering the
book again — hence three variants rather than one.

WeasyPrint rather than Playwright or LibreOffice: it needs no browser
and no display, which is what keeps this service deployable somewhere
small. Its weakness is CSS coverage, and the CSS here is a page box, a
font stack and margins.

`app/pdf.page_count()` is what the credit price is derived from. A DOCX
carries no reliable page count — pagination is a rendering decision and
python-docx writes no `<Pages>` property — so the standard PDF, rendered
from the same content, is the honest answer to the same question.

Storage is R2 over the S3 API (`app/storage`). This service is not a
Worker and has no binding, so it is the one component that legitimately
holds an R2 key; keeping that in one small module is the point.

## The handoff, and the two phases

`python -m app.handoff` polls the web application for work
(`app/handoff/poller.py`). The converter has no inbound port — the thing
that lets it run behind a filtered egress — so the direction of the wire
is always outward.

    NOBLESEE_API=https://noblesee.com
    CONVERTER_SECRET=...
    CONVERTER_POLL_SECONDS=30

Book production is **two phases joined at the DOCX master**, and a job
says which one it is:

| `kind` | reads | writes |
| --- | --- | --- |
| `master` | `ocr_key`, or `source_key` when the upload was already text | the DOCX master |
| `formats` | `master_key` | EPUB and the PDF variants |
| `full` | `source_key` | everything, in one pass |

`full` is what the CLI and the job API do; the handoff never asks for it.
The split exists so that a corrected master is cheap to act on: an
editor fixes what the OCR misread, and only `formats` runs again.
Re-running `master` would pay Google a second time to read pages already
read, and would discard the correction that prompted it.

**OCR no longer happens here for books that come through the portal.**
The web application calls Google Document AI and writes the result to
R2 as JSON — `ocr_key`, read by `app/sources/ocr_json.py`, format
version pinned and refused if it does not match. OCR became an HTTP
request when it stopped being a local model, and a Worker is billed
almost nothing to wait on one. The local OCR path
(`app/ocr`, `pipeline/structure.py`) is untouched and still runs for the
CLI.

Structure crosses the boundary, but only what the web side can support
with evidence. Format **version 2** carries each paragraph's role —
`h1`, `h2` or `body` — decided there from the type size and position
Document AI reports, and `ocr_json.py` maps those to `CHAPTER`,
`SECTION` and `BODY`. Version 1 wrote bare strings and is still read:
those pages have been paid for once, and refusing them would mean paying
Google again to read text already sitting in R2.

What it still costs: verse, attributions and footnotes. Those are
recognised by `structure.py` from *where a line sits on the page* at a
resolution the handoff does not carry, so a book that came through the
portal gets no verse detection and `ocr_json.py` does not guess. They
are left for a human to mark up in the master. A missing distinction is
cheap to fix there; a fabricated one is not — and a role that arrives
unrecognised falls back to body for the same reason.

Still open: where this service runs. Nothing is deployed, so nothing
polls, and a book uploaded through the portal waits at `queued` — its
OCR included, since the poll is also what drives that.
`tools/generate-seed-content.py` remains the way the seed library's
files are produced.
