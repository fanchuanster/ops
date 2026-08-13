# NobleSee — Roadmap

The platform was rebuilt on Next.js + Payload in August 2026 (NR-31; see
`docs/MODERNIZATION_ASSESSMENT.md`), and moved from PostgreSQL in a container
to Cloudflare D1 + Workers on 2026-08-13 (see
`docs/CLOUDFLARE_ARCHITECTURE.md`).

What exists today is a working reading site: a catalog, book pages, an
in-browser reflowable reader, reader accounts, Send-to-Kindle, and the three
domain rules — rights, delivery limits, staged release — implemented and
unit-tested in a framework-independent layer.

Everything under "Not built" is deliberately deferred, named here so the
current scope stays legible as a foundation rather than reading as an
oversight.

## Built

- **Rights model** — six statuses, failing closed on `unknown`; part-level
  overrides that may restrict but never relax the parent book (NR-9, NR-10).
- **Delivery limits** — distinct books in a rolling window, not files. Reading
  in the browser is never limited.
- **Staged release** — a per-reader clock, not a global publication date.
- **Site** — catalog with collection filtering, book pages, reading-first
  typography with Traditional Chinese first in the font stack, light/dark/auto.
- **Authorized delivery** — the three domain rules wired to artifact streaming
  through the Worker (`src/lib/authorizeDownload.ts`). Not signed URLs: the R2
  binding has no presigning, and streaming turned out to be the better shape.
- **In-browser reflowable EPUB reading** (epub.js) — rebuilt after the
  WordPress removal (NR-16).
- **Reader accounts** — sign-up, log-in and account pages against Payload auth,
  front-of-site rather than through the admin.
- **Send-to-Kindle** (NR-17) — over Resend's HTTP API, because Workers cannot
  speak SMTP. Authorized by the same path as any delivery and recorded in the
  same ledger.
- **Admin bootstrap** — `npm run create-admin`, for after the first-user screen
  is gone.
- **Infrastructure as code** — Terraform for R2, D1, DNS and the www redirect.
- **Converter, partially** — PyMuPDF rendering, PaddleOCR behind a replaceable
  interface, normalization/structure, and python-docx master generation, driven
  by a CLI.

## Not built

### Reader experience

- **In-reader typography controls** — font size, line spacing, margins (NR-18).
- **Google sign-in** (NR-30) and **Apple Sign In** (NR-25) — hang off the
  accounts that now exist; the Google OAuth client carries over unchanged.

### Content production

- **The rest of `services/converter`** — the FastAPI async job API and job-state
  machine (`CLAUDE.md` section 13), the Cloudflare Queues consumer, the
  vLLM/Gemma correction stage (never silent rewriting — original + AI suggestion
  + human approval, per `CLAUDE.md` section 7), EPUB 3 generation and
  validation, PDF rendering in three sizes, and the public conversion portal
  (NR-1 … NR-8).

  Until the pipeline is complete, `tools/generate-seed-content.py` stands in for
  it, writing reproducible artifacts into `content/seed/`.

- **Cover image processing** — Payload uses `sharp`, a native binary that cannot
  run on a Worker. Covers are currently stored at the size they are uploaded.
  Either move the resizing into the converter or use Cloudflare Images.

### Monetization

Secondary to the reading mission — see `CLAUDE.md`'s Business Model section.
No dark patterns.

- **Stripe** — donations and paid unlocks, integrated directly from the
  application (NR-12). WooCommerce is gone with WordPress and is not being
  replaced.
- **Paid early unlock** — the time-delay half of staged release is built; the
  "pay a small amount to open the next part early" half should stay a
  seriousness gate rather than a revenue mechanism.
- **E-reader affiliate/resale link** — discounted, dedicated product link
  (NR-14).

### Platform

- **Per-user blogs** (NR-20) — re-scoped by the rebuild. This was nearly free
  on WordPress; on the new stack it is a Payload collection plus author-scoped
  access rules, routes and moderation. Re-estimate before scheduling.
- **Automated X anti-explicit-content worker** (NR-21) — secondary to the core
  mission per `CLAUDE.md`'s Core Mission section. Standalone service.
- **Chinese full-text search** — on D1 (SQLite) this means FTS5. Its built-in
  tokenizers will not segment Chinese usefully: `unicode61` treats a run of Han
  characters as one token, so only whole-field matches work. The practical
  options are the `trigram` tokenizer, which works without segmentation at some
  index cost, or segmenting at index time in the converter and storing a
  space-delimited field. Custom tokenizers such as `pg_jieba`/`zhparser` are not
  available — those were the Postgres answer, and this needs a different one.

### Infrastructure

- **Cloudflare Queues** — the web → converter handoff. Needed before the
  conversion service can be driven from the site rather than the CLI.
- **Where the converter container runs** — this host, Cloudflare Containers, or
  elsewhere. Deliberately open; the queue boundary means it can be answered
  without touching application code.
- **Kubernetes manifests** (NR-24) — no longer urgent. The web tier is a Worker
  and Compose is retired; revisit only if the converter grows into several
  services that need orchestrating.

## Closed by the Workers port

- **Hosting target** (NR-28) and **public HTTPS** (NR-29) — these were blocked
  on outbound TCP/UDP 7844 being filtered upstream of this host, so the
  Cloudflare Tunnel could not connect and the site returned error 1033. Running
  the application as a Worker removes the tunnel from the architecture
  entirely, so the blocker no longer applies to the web tier. The converter
  sidesteps it too, by pulling from a queue rather than accepting inbound
  connections.
- **Redis** (NR-23) — was to back the conversion job queue. Cloudflare Queues
  takes that role, so there is no Redis to run.
