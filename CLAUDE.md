# NobleSee — Architecture & Implementation

You are the lead architect and implementation engineer for **NobleSee**.
Inspect the repository before assuming anything. Keep the architecture
production-oriented without unnecessary complexity. Prefer mature
open-source components and hosted APIs over reinventing. Flag
requirements that are technically, legally or operationally problematic
rather than implementing them blindly, and propose an alternative.

**These documents hold what the code cannot say**: why a decision went
the way it did, what was tried and rejected, and which rules must not be
broken. Anything discoverable by reading the code belongs in the code.
When you change a decision, change the file that owns it.

---

# MISSION

Valuable books — traditional Chinese classics, historical works,
cultural and philosophical texts — exist online only as scanned PDFs,
which are painful to read on modern devices.

    find valuable books with poor e-reader accessibility → OCR them →
    reconstruct and proofread → produce high-quality EPUB editions →
    make them genuinely pleasant to READ.

The goal is not to host PDFs. Reading should feel like a good Kindle
book: clean typography, reflowable text, adjustable size, chapter
navigation, low distraction, faithful to the original's meaning.

The project promotes reading, learning, wisdom, healthy living and
constructive use of time. Express this positively. Do **not** design the
platform around explicit content or let it become a catalog for it; the
anti-explicit-content initiative is secondary to the book mission.

# BUSINESS MODEL

Mission first, with revenue to fund digitization, proofreading and
hosting: e-reader affiliate sales, small paid unlocks, donations. No
dark patterns — a reader should never feel the project's purpose is to
sell them something.

# 1. PROJECT

**NobleSee**, at **noblesee.com**: online reading, AI-assisted
digitization, EPUB/PDF editions, paid unlocks, donations,
Send-to-Kindle, a credit economy, user blogs, affiliate sales, a
conversion portal for readers' own material, and reading levels.

**There are no book downloads.** A book is read here, in the reflowable
reader, or sent to the reader's device — never handed over as a file to
collect, because a folder of PDFs is not the reading experience this
project exists to provide. "Download" survives in the code as the name
of the *authorization* concept, the rights-and-credit decision. Kindle
delivery runs through exactly that path, being a download that arrives
by email.

---

# 2. IMPLEMENTATION PRINCIPLES

## 2.1 Next.js + Payload is the platform

**Next.js + React + TypeScript with Payload CMS on Cloudflare D1.**
Payload runs *inside* the Next application, so admin, API and public
site are one deployable: a **Cloudflare Worker** built by OpenNext, on
**D1** and **R2**, both reached as Worker *bindings* — which is why no
connection string and no S3 access key exists in the environment.

Migrations are explicit and versioned, and the adapter runs with `push`
off. **Nothing may alter the schema at boot.**

**Payload's generated admin panel is not used.** `/admin` is NobleSee's
own editorial UI and the only one. The cost is real and worth stating:
the ledger collections have no browsing screen for anyone but their
owner, reachable only through the API. Building those screens is fair to
want; it is not a reason to bring back a second admin.

**The API is REST, and only REST.** GraphQL is disabled and its routes
deleted. Nothing called it — the site is server components and server
actions over Payload's local API — and it cost a second access-control
surface to get right plus a schema built at boot in a Worker measured
against a 10 MB limit. The OpenAPI document is generated from the
collection configs so it cannot drift, and is administrators-only
because it maps every collection and field.

**Business logic belongs in the domain layer**, never in UI components
and never buried in Payload hooks. That layer must not import Payload,
Next or a database client — Payload calls into it, never the reverse.
`npm run verify` enforces this.

These stay server-side, never in the browser: book management, release
scheduling, delivery authorization and credit accounting, payment state,
rights enforcement, conversion orchestration, Kindle delivery, and all
AI and API integrations.

**Do not put long computation in the Worker.** A Worker is billed and
limited by CPU time. Anything wanting an OCR model, a font stack or a
native library belongs behind an HTTP call — as Adobe PDF Services and
xAI already are. I/O-shaped request handling belongs on the Worker;
computation does not.

## 2.2 Open source and third-party integration are welcome

Where a mature library, model or hosted API does the job, use it. The
default answer to "should we build this ourselves?" is no.

Conditions: honour licences and keep attribution; keep the dependency
behind a replaceable interface; credentials from the environment, never
source; and when user-owned content goes to a third party, say so on the
screen where that is chosen. The rule is disclosure and a private
alternative, not prohibition.

## 2.3 Coding standards

House rules, shared with this author's other repositories and imported
rather than restated so the copies cannot drift.

@mds/MSM_Automations/CLAUDE-coding.md

What they mean here:

- **Never bare `console.*`** — the project has a logger.
- **Reuse means the domain layer for rules and the lib layer for I/O.**
  Look there before adding a function.
- **Rules are pure functions.** Test the case, name the test after it.
- **Machine-read directives survive the no-comments rule**: `@ts-*`,
  `eslint-*`, `/// <reference>`, `# shellcheck`, `# noqa`.

Python- or MSM-specific rules belong in the Python house file, not the
imported core.

## 2.4 Working in this repo

- **Branches.** `master` is default, `wen_dev` is the working branch.
  Single maintainer, no review gate: merge `wen_dev` into `master`
  locally, push, then `bash .reset.sh`, which recreates `wen_dev` off
  the fresh `master` — never delete it as part of the merge. Keep real
  merge commits with a message describing the diff.
- **After a push, say what was pushed and stop.** No PR reminders.
- **Nothing enters Cloudflare except through Terraform.** `infra/` is
  the record; a hand-made resource is in no state file and no diff. Use
  the CLI and dashboard to read.
- **Verify the assumption, especially in a hurry.** "It can't do X" and
  "my change can't have caused this" are hypotheses until a command
  proves them.
- **To drive the live site programmatically, use
  `FANCHUANSTER_ACCESS_TOKEN` from the repo-root `config.env`** — the
  maintainer's administrator token. `config.env` is gitignored and the value
  never belongs in source, a commit, a log line or a bug report. It is a
  live credential on the production catalog: read freely, write
  deliberately. `docs/API.md` has the header format.

---

# 3. ARCHITECTURE

One Worker serves the public site, the API, the editorial UI **and the
conversion pipeline**, over D1 and R2 bindings, calling out to Adobe PDF
Services, xAI, Stripe and Resend. A cron trigger advances one book a
minute.

**There is no converter service and no container in production.** The
dividing line is CPU shape, not importance: work that is I/O runs on the
Worker, work that needs a model or a native library goes behind an HTTP
call. Kindle delivery is not a separate service either — Workers cannot
speak SMTP, so it goes over an HTTP email API.

Deployment is Wrangler for the Worker and Terraform for everything
Cloudflare holds. Development uses a container for the toolchain only,
for a glibc reason `README.md` documents. Kubernetes remains a possible
future target — do not introduce Kubernetes-specific complexity into the
MVP.

---

# THE REST OF THE SPECIFICATION

This file holds what applies everywhere. The rest lives beside it in
`docs/`, keeping the original section numbers so a cross-reference like
"(5.2)" still finds its home. **Read the file covering the area you are
about to change** — each states rules that are not derivable from the
code.

| File | Sections | Read it before |
|---|---|---|
| `docs/ARCHITECTURE.md` | 3 | OCR, the phases, sources, queueing |
| `docs/PIPELINE.md` | 4, 7–13 | conversion, correction, formats, the cron |
| `docs/BOOKS.md` | 5, 5.1, 5.3, 5.4 | the book model, covers, levels, shelves |
| `docs/CREDITS.md` | 5.2 | anything that moves a balance or prices a book |
| `docs/RIGHTS.md` | 6, 6.1, 6.2 | publication, moderation, the upload portal |
| `docs/STORAGE.md` | 14 | object keys and naming |
| `docs/FRONTEND.md` | — | the public site and the reader |
| `docs/API.md` | — | driving the site from outside a browser |

Also `docs/CLOUDFLARE_ARCHITECTURE.md` for what runs where and why, and
`docs/ROADMAP.md` for what is actually built.
