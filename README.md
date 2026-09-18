# NobleSee

A digital preservation and e-reader accessibility project: valuable books —
traditional Chinese classics, history, and works on wisdom and living well —
rebuilt from scans into clean, reflowable editions that are genuinely pleasant
to read.

The point is not to host PDFs. The point is to make these books readable: on a
phone, on a Kindle, in the dark, at whatever type size you need.

## Stack

Next.js 16 (App Router) + React + TypeScript, with **Payload 3 embedded inside
the same application** as CMS and admin. One deployable serves the public site,
the JSON API and the editorial admin.

It runs as a **Cloudflare Worker**, built by OpenNext, on **D1** for the
database and **R2** for book artifacts. Both are reached through Worker
bindings rather than credentials: there is no connection string and no S3 access
key in the environment, so there is no secret to lift and replay from elsewhere.
Infrastructure is managed by Terraform in `infra/`.

Business rules live in `apps/web/src/domain` — a framework-independent layer
that may not import Payload, Next or a database client. That boundary is
enforced by a check in `npm run verify`, not just documented.

> This replaced a WordPress implementation in August 2026. The deciding factor
> was that there were no users and no data to preserve. The old code is in git
> history — nothing was migrated.

## Running it

Everything goes through `apps/web/cf`, which runs the toolchain in a container.
That is not a style preference: wrangler ships `workerd`, the real Workers
runtime, and workerd needs glibc 2.32+. On an older host — this one is Ubuntu
20.04 on 2.31 — it cannot start, which takes out `wrangler dev`, the Miniflare
behind `getPlatformProxy`, and every Payload CLI command that needs a binding.

```bash
cp config.example.txt config.env                  # CLOUDFLARE_API_TOKEN for Terraform
cp apps/web/.dev.vars.example.txt apps/web/.dev.vars
# set PAYLOAD_SECRET in .dev.vars — there is no default:  openssl rand -hex 32

cd apps/web
./cf npm install
./cf npm run migrate                  # apply schema to local D1
./cf npm run seed                     # load the catalog
../../tools/mirror-r2-local.sh        # copy book artifacts into local R2
./cf npx wrangler dev --ip 0.0.0.0    # the site, on :8787
```

- Site: http://localhost:8787
- Admin: http://localhost:8787/admin — the editorial UI: review queue, library,
  collections, readers. Administrators only.
- REST: http://localhost:8787/api — Payload's API. GraphQL is disabled
  (`graphQL.disable`) and its two routes are deleted, so `/api/graphql` and the
  playground answer the REST handler's own "route not found"; REST and the
  site's own routes are the whole programmable surface. There is no
  generated admin panel; it was deleted on 2026-08-24 once `/admin` covered
  everything still needed (see `payload.config.ts`), which is also how the
  Worker bundle stopped growing towards the 10 MB limit. Bootstrap the first
  administrator with `npm run create-admin`.
- API docs: http://localhost:8787/api/docs — Swagger UI over the REST API,
  generated from the collection configs (`src/plugins/apiDocs.ts`); the document
  itself is at `/api/openapi.json`. Both are administrators-only and answer 404
  to anyone else, because the document names every collection and its whole
  field shape. Authorize with a personal access token from `/account/tokens`,
  or just stay signed in — the session cookie works too.
- Health: http://localhost:8787/health — checks D1, not just the process
- Analytics: Google Analytics 4, configured by `GA_MEASUREMENT_ID` in
  `wrangler.jsonc` vars (not a secret — a measurement ID is served inside every
  page). It renders only on the public site and only for requests that actually
  arrived at `NEXT_PUBLIC_SERVER_URL`'s host, so `wrangler dev` and the
  `*.workers.dev` URL never reach the property; `/admin` has its own layout and
  is never measured. The tag is server-rendered — `next/script` inside a client
  component puts nothing executable in the HTML, which is invisible to Google's
  own tag detector. See `src/lib/analytics.ts` and `components/GoogleAnalytics.tsx`.

Migrations are explicit and versioned in `apps/web/src/migrations`; the adapter
is configured with `push: false` so nothing alters the schema at boot.

The seed loads the curatorial collections and two reference books (Tao Te Ching;
The Analects, in three parts, which exercises staged release). It is idempotent
— matched on slug and updated in place — and deliberately manual rather than
automatic, because updating in place would quietly revert an editor's changes.

Its `storageKey` values point at artifacts that really exist in the production
R2 bucket, so delivery has real files behind it. `mirror-r2-local.sh` copies
those objects into the local bucket; without it the catalog renders but the
reader and Send-to-Kindle return 502.

### Deploying

```bash
cd apps/web
./cf npx wrangler secret put PAYLOAD_SECRET   # once, per environment
./cf npm run deploy
```

The bundle is ~5.9 MB gzipped, against a 10 MB limit on Workers Paid. It does
not fit the 3 MB free tier — Payload's admin UI is most of it. The measurements
behind that, and what a free-tier split would cost, are in
`docs/CLOUDFLARE_ARCHITECTURE.md`.

### Creating an administrator

Payload shows its "create first user" screen only while the users table is
empty. The first reader to register closes it permanently — so on a live site
that screen is usually already gone, and there is no way back in through the
browser. Use:

```bash
cd apps/web
./cf npm run create-admin          # local D1
./cf npm run create-admin:remote   # the live production database
```

It prompts for an email and a password (echo off; `ADMIN_EMAIL` and
`ADMIN_PASSWORD` work too for non-interactive use). An address that already
exists is promoted to admin rather than duplicated, and a promotion leaves the
password alone.

Run it from a real terminal rather than piping input, so the password is
prompted for instead of sitting in your shell history.

The remote variant selects `wrangler.remote.jsonc`, which carries
`"remote": true` on the D1 and R2 bindings so the script acts on live data from
your machine. That flag lives in a *separate* config on purpose: putting it in
`wrangler.jsonc` would silently repoint `npm run migrate`, `npm run seed` and
`wrangler dev` at production too. The target is selected by `ADMIN_TARGET`
rather than a `--remote` argument because `payload run` replaces `process.argv`
before the script runs, so a flag would vanish silently and the script would
act on the wrong database while reporting success.

## Development

```bash
cd apps/web
./cf npm run verify   # generate types, domain-boundary check, typecheck, unit tests
```

```bash
./tools/smoke-test.sh                                # HTTP-level checks, localhost:8787
BASE_URL=https://noblesee.com ./tools/smoke-test.sh  # read-only against production
```

The signed-in checks register a reader and record deliveries, so they write to
whatever database `BASE_URL` names. Against a non-local host they are skipped
and reported as such — a read-only pass is a legitimate way to check a
deployment, and leaving test accounts in the live database is not. Add
`ALLOW_WRITES=1` when you do want them.

`npm run verify` covers the domain rules in isolation; the smoke test covers the
wiring between them — that the catalog only lists cleared books, that a
held-back part offers no reader link, that the DOCX master is never offered to
readers, that the page carries no download links at all, and that an anonymous
request for the EPUB stream is refused.

### Generating book artifacts

```bash
pip install python-docx ebooklib weasyprint pillow
python3 tools/generate-seed-content.py
```

Writes DOCX, EPUB and one PDF into `content/seed/`. The seed content is
generated rather than committed so it is reproducible instead of a pile of
binaries nobody can regenerate.

This used to stand in for a conversion pipeline that did not yet generate
EPUB. It no longer stands in for anything — the pipeline runs in the Worker
and builds real editions (docs/PIPELINE.md section 13) — but the seed is still how
the catalog gets books without uploading any.

### Preparing a downloaded scan

```bash
sudo apt install ghostscript && pip install pymupdf   # install both
python3 tools/clean-pdf.py --dry-run *.pdf            # what would happen
python3 tools/clean-pdf.py 619294728-13230487-南怀瑾选集-第9卷-2013-03-P699.pdf
```

A file pulled from an archive mirror arrives with two unrelated problems, and
`tools/clean-pdf.py` answers both in one pass at the point of intake. The
filename is a database id and a byte-range suffix wrapped around the title that
actually matters, so any leading or trailing run of digits and `-` is stripped
and the file renamed in place — `南怀瑾选集-第9卷-2013-03-P.pdf`. The strip is
literal, so a trailing letter stops it: this is a filename cleanup, not a guess
at where the title really ends. The space, `.` or `_` the digits were hanging
off goes with them — `...复旦大学出版社.19.pdf` ends up as
`...复旦大学出版社.pdf`, not with the dot left dangling — and that trim runs
once rather than sending the strip round again. The scan is then measured against the same
100 MB ceiling as below and, if it is over, handed to the ladder — replacing the
file in place, so what is left is one file at one clean name rather than an
original with a smaller copy beside it. `--keep-original` leaves the input alone
and names the copy for its size instead.

Either pass can be skipped (`--skip-rename`, `--skip-shrink`): renaming never
touches page content and shrinking never touches the name.

### Shrinking an oversized scan

```bash
python3 tools/shrink-pdf.py --inspect scan.pdf        # what is in it
python3 tools/shrink-pdf.py scan.pdf                  # -> scan-28MB.pdf
```

This is the size half on its own, for a file whose name is already what you
want.

PyMuPDF is nominally optional and worth installing anyway: it is what trims
the ladder to the scan's own resolution. Without it the tool walks rungs that
cannot do anything, a minute each on a large book, and can only report which
compression filters it found in the raw bytes.

On Windows, `tools/clean-pdf.ps1` and `tools/shrink-pdf.ps1` arrange the three
things that have to be right before any of this works — a portable Ghostscript
on PATH under its Windows name `gswin64c.exe`, a UTF-8 console so a book named
南怀瑾选集-典藏版-第05卷-扫描版.pdf prints instead of raising
`UnicodeEncodeError`, and whichever of `python`/`python3`/`py` actually runs:

```powershell
.\tools\clean-pdf.ps1 $env:USERPROFILE\Downloads\619294728-南怀瑾选集-第9卷-P699.pdf
.\tools\clean-pdf.ps1 C:\scans\*.pdf -DryRun
.\tools\shrink-pdf.ps1 C:\scans\book.pdf -Inspect
.\tools\shrink-pdf.ps1 C:\scans\book.pdf -Quality 40 -Gray
```

`clean-pdf.ps1` is the one to reach for after a download: it does the rename and
the shrink. `shrink-pdf.ps1` is the size half alone, and keeps `-Inspect`,
`-Force`, `-Output` and `-OutDir`, which belong to that tool. Both pass only the
switches you actually gave, so the defaults stay the Python tool's own and the
two cannot drift apart; `-Help` prints them from the tool itself.

Neither changes directory, so relative paths still resolve, and both look for
the portable build in `$env:USERPROFILE\ghostscript-portable\bin` unless
`-GhostscriptDir` says otherwise. Missing Ghostscript stops `shrink-pdf.ps1`,
which can do nothing without it, and only warns `clean-pdf.ps1`, which can still
rename. The plumbing itself is in `tools/pdf-tools.ps1`, dot-sourced by both —
all three are saved with a UTF-8 byte order mark, because Windows PowerShell 5.1
reads a `.ps1` as ANSI without one and turns the Chinese in them into mojibake.

The upload limit is 100 MB, and it is not a number we chose: it is Adobe's
ceiling for the Export PDF call and Cloudflare's request cap on this plan
(docs/ARCHITECTURE.md and docs/STORAGE.md). A 400-page book scanned at 300dpi goes past it
easily, and those are the books this library is for.

`tools/shrink-pdf.py` re-encodes the page images at a lower resolution and
changes nothing else — no pages dropped, no splitting, text and vectors carried
through as text and vectors. It descends a resolution ladder and stops at the
first rung under the limit, so the result is the best quality that fits rather
than the smallest file it could make.

The ladder stops at 200 dpi, because below that Adobe starts losing dense
traditional Chinese glyphs and the book arrives as a master full of noise —
a document transaction and a proofreader's afternoon spent on something worse
than nothing. `--min-dpi` goes lower and says so on the way past.

**Resolution is not always the lever.** A rung above the scan's own resolution
downsamples nothing, and a scan already compressed hard re-encodes to the size
it started at — so a 225 MB book can come back the same size at every rung. The
tool measures that rather than assuming it: each rung is judged against the rung
above it rather than against the input, so the re-encoding every pass does is
never read as a downsample; nothing is extrapolated from a rung that did not
earn it; and a scan already under the whole ladder — a 150 dpi book under the
200 dpi floor — is given one pass instead of four identical ones, with the
reason on the line. When resolution cannot help, the tool says so and names
what can.
`--quality` recompresses the images even when nothing downsamples, and `--gray`
is the bigger win for a black-and-white book photographed in colour, though it
takes the red seals with it.

The result is named for the size it came out at — `scan-28MB.pdf` — which is
the one fact you wanted when the whole point was getting under a number. `-o`
overrides it.

`--quality` is a 0-100 scale over Ghostscript's `QFactor`, defaulting to 60,
which is Ghostscript's own default. It is deliberately not `-dJPEGQ`: that
switch belongs to the jpeg output device and `pdfwrite` ignores it, so every
value of it produced byte-identical output and the flag was a placebo.

It reads the limit out of `domain/publication.ts` rather than keeping its own
copy, which has already moved once (64 MB until 2026-08-24).

Keep the original. NobleSee preserves the file it is given — the upload *is*
the book's PDF artifact and what a reader is sent — so shrinking is how a book
gets in, not an archival step.

## Layout

```
apps/web/                    the application — public site, API and admin
  src/domain/                business rules; imports no framework (enforced)
  src/collections/           Payload collections: Users, Media, Books, Parts, Collections
  src/lib/                   Payload-aware query helpers for the site
  src/app/(frontend)/        public pages
  src/app/(payload)/         admin and API routes
  src/migrations/            versioned schema migrations
  src/seed/                  catalog seed
  cf                         runs the toolchain in a container (see "Running it")
  scripts/create-admin.ts    bootstraps an admin once the first-user screen is gone
  wrangler.jsonc             Worker bindings — mirrors `terraform output`
  wrangler.remote.jsonc      the same bindings, pointed at live D1/R2 (opt-in only)
  worker-entry.ts            OpenNext's handler plus the conversion cron
  src/lib/conversion/        the pipeline: DOCX, EPUB, the LLM client, the runner
content/seed/                generated book artifacts (DOCX/EPUB/PDF)
infra/                       Terraform: R2, D1, DNS, the www redirect
tools/                       smoke test, seed-content generator, R2 mirror, PDF shrinker
docs/                        architecture decisions and roadmap
```

## Send to Kindle

A reader adds their `@kindle.com` address on `/account`, and each part gains a
**Send to Kindle** button. Delivery is authorized by exactly the same code path
as a download — rights, staged release and the per-reader limit — and recorded
in the same ledger, because it *is* a download that happens to arrive by email.
Taking the EPUB and also sending it to a Kindle is still one book against the
limit.

Two things must be true before anything arrives:

1. **The reader has added `kindle@noblesee.com`** to their Approved Personal
   Document E-mail List, under *Manage Your Content and Devices → Preferences →
   Personal Document Settings* in Amazon. The account page walks them through
   it, deliberately prominently: Amazon **silently discards** documents from an
   unapproved sender — no bounce, no error, the book simply never appears — so
   this is the one failure the UI has to prevent rather than report.
2. **The sending domain is verified.** Workers cannot speak SMTP, so delivery
   goes over Resend's HTTP API. Set `RESEND_API_KEY` as a Worker secret, and put
   the SPF/DKIM records Resend issues into `email_dns_records` in
   `infra/terraform.tfvars`. Amazon drops mail failing either check, just as
   silently.

With `RESEND_API_KEY` unset the feature switches itself off rather than
offering a button that cannot work.

```bash
cd apps/web
./cf npx wrangler secret put RESEND_API_KEY
```

The sender address lives in `src/domain/kindle.ts` as one constant, so the
reminder shown to readers and the `From:` header cannot drift apart.

## Domain rules worth knowing

**Rights fail closed.** Every book carries an explicit rights status; only
`public_domain`, `licensed` and `permission_granted` may be distributed
publicly. `unknown` is deliberately not distributable — an unreviewed book is
never published by default. A Part may be *more* restricted than its Book, never
less.

**There are no downloads.** A book is read here, in the reflowable reader, or
sent to the reader's device. It is never handed over as a file to collect. That
is a product decision, not a technical limit: NobleSee exists to make books
pleasant to *read*, and a folder of PDFs is not that.

**Delivery limits count books, not files.** A reader who sends both the EPUB
and the PDF of one book to their Kindle has consumed one slot, because they
read one book. Reading in the browser is never limited at all — the policy
paces bulk delivery, and charging someone for opening a book would penalise
exactly the behaviour the site is for. This is an application-level fairness
policy, not a bandwidth control.

**Staged release is a per-reader clock.** Part N+1 opens a fixed delay after
*that reader* reached part N — so someone who discovers a book a year late gets
the same paced experience as an early reader. It is a reading rhythm, not
scarcity: nothing expires, and starting late costs nothing.

All three are enforced server-side. The frontend renders what the API permits
and is never the only thing between a reader and a restricted file.
