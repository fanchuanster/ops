# NobleSee — Architecture Review, Planning & Implementation Prompt

You are the lead software architect and implementation engineer for a new project called **NobleSee**.

Your job is to:

1. Thoroughly inspect the existing repository before making assumptions.
2. Review the requirements below.
3. Produce a practical architecture and implementation plan.
4. Identify ambiguities, risks, missing requirements, security concerns, and better alternatives.
5. Then implement the project incrementally in the repository.
6. Keep the architecture production-oriented but avoid unnecessary complexity.
7. Prefer existing mature open-source components/plugins over reinventing functionality.
8. Make the system Docker-first and Kubernetes-ready.
9. Maintain excellent documentation throughout implementation.
10. Do not blindly implement requirements that are technically, legally, or operationally problematic. Flag them and propose safer alternatives.

---

# NOBLESEE — CORE MISSION AND PRODUCT VISION

NobleSee is fundamentally a digital preservation and e-reader accessibility
project.

Many valuable older and traditional books, especially traditional Chinese
books, historical books, cultural classics, and other worthwhile literature,
are available online only as scanned PDFs or scanned page images.

These formats are often difficult to read comfortably on modern devices,
especially e-readers such as Kindle.

NobleSee's primary mission is therefore:

    Find valuable books that are difficult to access in e-reader-friendly
    form → digitize/OCR them → carefully reconstruct and proofread them →
    produce high-quality EPUB/Kindle/PDF editions → make them available
    through an excellent reading experience.

The goal is not merely to host PDFs.

The goal is to make valuable books genuinely pleasant to READ.

The preferred experience should be similar to reading a physical book or
a high-quality Kindle book:

- clean typography
- reflowable text
- adjustable font size
- comfortable line spacing
- page/chapter navigation
- low visual distraction
- excellent mobile experience
- excellent e-reader compatibility
- preservation of the original meaning and structure

NobleSee should particularly focus on books that currently have poor
e-reader accessibility.

Examples:

- scanned historical books
- traditional Chinese classics
- cultural and philosophical works
- books about wisdom and personal development
- books related to health and moral development
- worthwhile books that are difficult to find in modern e-reader formats

The project also has a positive social mission.

NobleSee aims to encourage reading, wisdom, healthy living, moral
development, and constructive use of time, including providing positive
alternatives to harmful or explicit online content.

This should be expressed positively.

The website should promote:

- reading
- learning
- wisdom
- healthy living
- personal development
- meaningful use of technology
- traditional culture
- constructive content

Do NOT design the platform around explicit/pornographic content itself.
The platform should not become a repository, catalog, or discussion platform
for explicit material.

The anti-explicit-content/X initiative, if implemented, is secondary to
the main book-preservation and reading mission.

---

# BUSINESS MODEL

NobleSee is mission-first, but it needs sustainable revenue.

Revenue should support:

- book digitization
- OCR
- proofreading
- infrastructure
- e-reader accessibility
- hosting
- development
- future book preservation

Primary revenue/support mechanisms:

1. E-reader product sales or affiliate/referral sales
2. Small paid unlocks for restricted/limited downloads
3. Donations

Monetization must remain secondary to the reading mission.

Do not design dark patterns.

Do not make users feel that the project is primarily trying to sell
products or extract money from readers.

The ideal user journey is:

Discover a valuable book
        ↓
Read it comfortably
        ↓
Become interested in reading more
        ↓
Optionally support NobleSee
        ↓
Optionally purchase an e-reader
        ↓
Continue reading

The project should feel like a cultural/literary mission that happens to
have sustainable revenue mechanisms—not like an e-commerce store disguised
as a library.

---

# 1. PROJECT

Project name:

NobleSee

Domain:

noblesee.com

Mission:

NobleSee is a website for hosting and sharing essential and noble books, especially traditional Chinese culture and history, that can bring wisdom, life change, and upliftment to readers.

The platform should eventually provide:

- Online book reading
- AI-assisted book digitization and production
- EPUB/PDF and potentially other e-reader formats
- Paid early unlocks
- Donations
- Send-to-Kindle functionality
- A credit economy: every book has a price, and sending one to a device
  spends credits (section 5.2)

This list said "Book downloads" until 2026-08-13. It is deliberately
gone: a book is read here, in the reflowable reader, or sent to the
reader's device — it is never handed over as a file to collect. That is
a product decision, not a technical limit. NobleSee exists to make books
pleasant to *read*, and a folder of PDFs is not that.

"Download" survives in code and in this document as the name of the
*authorization* concept — the rights and credit decision in
`src/lib/authorizeDownload.ts` and the `Downloads` ledger. Kindle
delivery runs through exactly that path, because it is a download that
happens to arrive by email.
- User blogs (each user has their own blog)
- E-reader product/affiliate sales
- Potential automated X/Twitter anti-explicit-content activity
- A conversion portal: readers upload their own material and get a
  readable edition back (section 6.1)
- Reading levels: essential / normal / extensive (section 5.1)

---

# 2. IMPORTANT IMPLEMENTATION PRINCIPLES

## 2.1 Next.js + Payload is the main website platform

This section previously mandated WordPress, and briefly Django. The
rebuild was specified in `docs/MODERNIZATION.md` and justified in
`docs/MODERNIZATION_ASSESSMENT.md` — with no users and no data to
preserve, the platform was rebuilt greenfield rather than migrated.

Both of those are now historical records with status banners, and the
platform decisions in them have moved on. **This section and
`docs/CLOUDFLARE_ARCHITECTURE.md` are the current direction**;
`docs/ROADMAP.md` says what is built.

Use **Next.js + React + TypeScript with Payload CMS on Cloudflare D1**
for:

- User accounts and authentication
- Book/Format domain model
- Administration and the editorial/proofreading workflow
- Rights status and access control
- Delivery authorization and the credit economy
- Donations/payment integration (Stripe)
- The JSON API consumed by the frontend

Payload runs *inside* the Next.js application rather than beside it, so
the admin, the API and the public site are one deployable.

That deployable is a **Cloudflare Worker**, built by OpenNext, on **D1**
for the database and **R2** for book artifacts. This section specified
PostgreSQL 18 in a container until 2026-08-13; the reasoning for the
move, and what it cost, is in `docs/CLOUDFLARE_ARCHITECTURE.md`. D1 and
R2 arrive as Worker *bindings* rather than credentials, so there is no
connection string and no S3 access key in the environment.

Migrations are explicit and versioned in `apps/web/src/migrations`, and
the adapter runs with `push: false` — nothing may alter the schema at
boot.

Next.js also covers:

- Public website and book catalog UI
- Book browsing and metadata display
- The reading experience (a dedicated React + EPUB.js reader)
- Blog functionality

Business logic belongs in the domain layer (`apps/web/src/domain`),
never in UI components and never buried in Payload hooks. That module
must not import Payload, Next or a database client — Payload calls into
it, never the reverse.

The following must remain server-side application functionality
(Next.js route handlers and Payload, never the browser):

- book management
- release scheduling
- delivery authorization and credit accounting
- payment/unlock state
- rights status enforcement
- conversion job orchestration
- Kindle delivery
- AI functionality and API integrations

Do NOT turn the web application into the conversion pipeline. That stays
a separate FastAPI service (`services/converter`).

## 2.2 Open source and third-party integration are welcome

This project is open to open source, third-party integration, borrowing
and reuse. Where a mature library, plugin, model or hosted API already
does the job well, use it rather than reimplementing it. That applies to
OCR engines, document tooling, LLM providers, payment and email — the
default answer to "should we build this ourselves?" is no.

The conditions on that are the ordinary ones, not obstacles:

- honour the licence of anything borrowed, and keep attribution intact;
- keep the dependency behind an interface where it is plausibly
  replaceable (`app/ocr/base.py` and `app/llm/client.py` are the pattern);
- credentials come from the environment, never from source;
- think before sending user-owned or restricted content to a third-party
  service — public-domain library text is not the same as a reader's
  private upload (section 6).

---

# 3. HIGH-LEVEL ARCHITECTURE

Target architecture:

                    noblesee.com
                           |
                    Cloudflare (TLS, CDN)
                           |
        Next.js + Payload application  [Cloudflare Worker]
        catalog, book pages, reader, blog,
        accounts, rights, credits,
        delivery, admin/editorial
        UI, JSON API
                           |
        +------------------+------------------+
        |                  |                  |
     bindings           bindings           HTTP API
        |                  |                  |
        v                  v                  v
  Cloudflare D1     Cloudflare R2          Stripe
   (SQLite)               |                Resend
        |           Book artifacts        (Kindle)
        |           DOCX/EPUB/PDF
        |                  ^
        |                  |
        v                  |
 Cloudflare Queues         |
        |                  |
        v                  |
   Converter  [container] -+
        |
        +---------+---------+
        |         |         |
       OCR       LLM     Rendering
                  |
                xAI API
                  |
              Grok 4.6

The dividing line is CPU shape, not importance: a Worker is billed and
limited by CPU time, so I/O-shaped request handling belongs on it and
long *computation* — OCR, LLM correction, DOCX/EPUB/PDF rendering — does
not. `docs/CLOUDFLARE_ARCHITECTURE.md` has the full table.

The Worker never waits for a conversion. It enqueues a job and returns
an id; the converter consumes the queue and writes results back to R2.
The converter therefore needs no inbound port, which is what makes it
deployable behind this host's filtered egress.

Separate services:

- NobleSee Web (Next.js + Payload on D1/R2) — one Worker serving the
  public site, the API and the admin
- NobleSee Converter — container; OCR, LLM correction, format generation
- NobleSee X Worker
- Kindle delivery — built, and *not* a separate service: Workers cannot
  speak SMTP, so it goes over Resend's HTTP API from the Worker itself

Deployment:

`wrangler deploy` for the Worker; Terraform in `infra/` for R2, D1, DNS
and the redirect. There is no Docker Compose stack — it was retired on
2026-08-13 when the last container left production. Development still
uses a container for the toolchain, for an unrelated glibc reason
documented in `README.md`.

Where the converter container runs is deliberately still open. The queue
boundary means it can be answered later without touching application
code.

Kubernetes / AWS EKS remains a possible future target. Do not
prematurely introduce Kubernetes-specific complexity into the MVP.

OCR runs on **Google Document AI**, over its REST API, provisioned by
`infra/documentai.tf`. PaddleOCR was the engine until 2026-08-14 and the
implementation behind `app/ocr/base.py` remains; what changed is where
the compute happens. OCR cannot run on a Worker — 128 MB of memory and
five minutes of CPU against a model needing more of both — and calling a
hosted service turns that compute into an HTTP request, which a Worker is
billed almost nothing for. Batch processing, not online: online caps a
request at 15 pages, batch takes 500.

Because of that, **the pipeline is split at the OCR boundary**. The web
application calls Document AI and writes the resulting text to R2; the
converter reads that text and does the rendering. This is the one place
the rule above ("do not turn the web application into the conversion
pipeline") is deliberately bent, and only because OCR stopped being
computation and became a fetch. Everything that is still computation is
still the converter's.

Nothing schedules the OCR stages. The converter already polls
`GET /api/conversion` for work, and that poll is used as the clock —
each one advances at most one book through OCR before answering
(`apps/web/src/lib/ocrPipeline.ts`). No cron, no queue consumer, and
nothing fires when no converter is running. The cost is that OCR does
not progress while nothing is polling, which is harmless: nothing
downstream could act on it if it did.

## Two phases, joined at the master

Production is two pipelines, not one:

    Phase 1   original → DOCX master        expensive, run once
    Phase 2   DOCX master → EPUB, PDF…      cheap, run whenever

The split is what makes section 5's "the DOCX master is the source of
truth" mean something. An editor corrects OCR damage in the master, or
an uploader re-uploads a corrected one (section 6.2), and the book
returns to `master_ready` — phase 2 runs again and phase 1 does not.
Re-running phase 1 would pay Google a second time to re-read pages
already read, and would discard the correction that prompted it.

The states are in `apps/web/src/domain/pipeline.ts`, and every rule that
follows from the split is a function there rather than a condition in a
route: what a converter may claim, where a phase lands when it finishes,
where a failure restarts from. That last one is keyed on whether a DOCX
artifact exists rather than on the state, because the state is what a
failure loses and the artifact is the evidence that survived.

PDF rendering is deferred. EPUB is the primary format and the DOCX master
is the source of truth; the three PDF variants are a future addition, not
a gap in the current pipeline. The conversion service is
deliberately standalone and platform-agnostic — it talks to the web
application over HTTP and knows nothing about the frontend.

---

# FRONTEND

The NobleSee frontend is a Next.js (App Router) application in React
and TypeScript, with Payload embedded in the same application, deployed
as a Cloudflare Worker. It was previously specified as WordPress +
Kadence, then briefly Django + Astro; see section 2.1 and
`docs/MODERNIZATION.md` section 14.

Next.js is required by Payload 3, which is Next-native, and gives
server-side and static rendering where each page needs it — the catalog
and book pages are read-mostly and should not ship a client-side app to
render text.

The frontend must provide:

- responsive/mobile-first design
- clean typography, including Chinese typography
- book/library layouts
- blog layouts
- archive/category layouts
- accessibility
- performance optimization
- an excellent reflowable reading experience

Do NOT put business logic in the frontend. Rights checks, delivery
authorization and credit accounting are enforced
server-side; the frontend renders what the API permits and must never be
the only thing standing between a reader and a restricted file.

Prefer server components and static rendering, with client components
only where interaction genuinely requires them, rather than building the
whole site as a client-side SPA.

The in-browser EPUB reader is the one place where meaningful client-side
JavaScript is justified.

---

# 4. AI INFRASTRUCTURE

The LLM provider is **xAI**, over its OpenAI-compatible HTTP API.

    XAI_BASE_URL=https://api.x.ai/v1     (default; need not be set)
    XAI_MODEL=grok-4.6                   (default; need not be set)
    XAI_API_KEY=...                      (required, from .env)

This section specified a self-hosted vLLM endpoint at
`http://10.211.51.231:8000/v1` running `google/gemma-4-31B-it-qat-w4a16-ct`
until 2026-08-13. Both are interchangeable as far as the code is
concerned — the client in `services/converter/app/llm/client.py` speaks
the OpenAI chat-completions shape and takes base URL, model and key from
the environment, so pointing it back at vLLM is a matter of setting
`XAI_BASE_URL` and `XAI_MODEL`. Nothing in the pipeline knows which is
answering.

IMPORTANT:

- Do not expose the endpoint or the key directly to public browsers.
- The web application should not directly depend on the LLM endpoint.
  Only the conversion service talks to it.
- Make endpoint, model and key configurable through environment
  variables; never hard-code any of them in application source.
- The key is read from the environment, falling back to the repo-root
  `.env` for local CLI runs. `.env` is gitignored and stays that way.
- The provider is now a third party, which the self-hosted endpoint was
  not. Public-domain library text is fine to send. A reader's private
  upload (section 6) is not — that distinction is now load-bearing.

---

# 5. BOOK DOMAIN MODEL

Design a proper book model.

A Book should include concepts such as:

- id
- title
- subtitle
- author
- translator
- language
- description
- cover
- copyright/licensing status
- publication metadata
- status
- created_at
- updated_at

A book is whole. It was split into Parts until 2026-08-14, each
separately released and separately downloadable; that is gone, and the
`parts` table with it. A book is one record, one DOCX master, one set of
generated formats — as it was written.

Example:

Book
|
+-- pageCount, priceCredits
|
+-- DOCX (master, never a reader download)
+-- EPUB
+-- PDF Standard
+-- PDF Large
+-- PDF Extra Large

What the split bought was staged release — a per-reader clock that paced
someone through a book. That is also gone. The credit price in section
5.2 is what governs access now.

The DOCX master is the source of truth.

Reader-facing formats must be generated from the approved DOCX master.

Do NOT use PDF as the canonical source.

## 5.1 Reading levels

Every book carries a level: **essential**, **normal** or **extensive**.
They nest rather than exclude — a reader browsing at one level sees that
level and everything shallower:

    essential  →  essential
    normal     →  essential + normal
    extensive  →  essential + normal + extensive

The levels are stored and compared as ordered **ids**, never as names:
`essential = 10, normal = 20, extensive = 30`, in
`apps/web/src/domain/levels.ts`. A reader at id N sees every book whose
id is ≤ N, which is one indexed comparison in the catalog query. The gaps
are deliberate — a level added later between two existing ones takes id
25 and needs no stored row rewritten.

This is **curation, not access control**. A reader chooses their own
level and can raise it at any time, so `extensive` is always one click
away. Rights clearance, private-workspace ownership and the credit
price are the access rules (sections 5.2 and 6), they are enforced
independently, and
nothing about levels may ever be relied on to keep a reader away from
anything. The purpose is the mission's "low visual distraction": let a
reader start with the core and open up the tail when they want it.

Level is an administrator field, like rights status and visibility
(section 6.1).

---

## 5.2 Credits

Every book has a price in credits, derived from the length of its DOCX
master: one credit per 70 pages, at least 1 and never more than 7. The
rule is `priceInCredits` in `apps/web/src/domain/credits.ts`; the price
is stored on the book by a collection hook so what a reader was charged
is a recorded fact rather than a re-derivation that could change under
them.

Credits pay for **taking a book away** — sending it to a device. They
never pay for reading. The online reader is free, unlimited, and needs
no account at all, which is not a generosity setting but the product
thesis: a reader who cannot afford a credit must still get every word.
`canReadOnline` and `canAccessArtifact` in `domain/rights.ts` are two
rules for exactly this reason — the first deliberately stops before the
account requirement the second enforces.

  - New accounts start with 10 credits.
  - A month in which the reader signs in is worth 5; a month they are
    away is worth 2. Being away is not punished.
  - The first delivery of a book buys it, at the book's price. Every
    later delivery costs 1 credit, with a confirmation before it is
    spent. That charge is what replaced the rolling 24-hour delivery cap
    as the thing bounding how fast an account can drain the library.
  - A reader's own upload is free to send. It is their book.

Accrual is lazy and has no scheduled job behind it. A sign-in always
grants for its own month, so any month with no grant recorded is by
construction a month with no sign-in and can be paid the away rate on
sight — `accrualFor` in `domain/credits.ts`. Backlog is capped at 24
months so a reader returning after years does not arrive to a windfall.

The balance lives on the user and the `credit-ledger` collection is the
account of how it got there. That duplication is deliberate: summing a
ledger on D1 for every delivery decision would be a table scan per
request. `apps/web/src/lib/credits.ts` is the only module permitted to
move a balance, and it writes both together.

---

# 6. COPYRIGHT / RIGHTS MANAGEMENT

The system must include metadata describing the legal status of a book.

Possible states:

- public_domain
- licensed
- permission_granted
- user_owned
- restricted
- unknown

Do not build a system that assumes every uploaded or scanned book can legally be redistributed.

For books distributed publicly, require an appropriate rights status.

For the conversion portal, distinguish:

1. Public NobleSee library content
2. User-owned/private conversion content

Private user uploads should not automatically become publicly accessible.

## 6.1 The conversion portal

A reader may upload a scanned PDF, an ordinary text-layer PDF, a DOCX or
a plain text file. All four converge on the same DOCX master (section 5)
— there is no second-class path — and from that master they get the same
things the library offers: EPUB and the PDF variants, delivery to an
e-reader, and the online reader.

Such a book is **private by default**, visible only to its owner, and
may stay that way forever. Publishing it to the public library is a
separate act and takes two independent approvals:

1. an administrator approves the submission, and
2. the rights status permits public distribution.

The second is not a formality the first can wave through. An admin
approving a submission is saying "this belongs in the library"; it is not
a finding that the material is legally distributable. `user_owned` is the
status for "the uploader owns a copy", and it never clears public
distribution — a reader owning a book confers no right to publish it to
everyone else. `canPublishToLibrary` in `apps/web/src/domain/moderation.ts`
enforces both gates, and `unknown` rights block submission entirely: the
uploader is the only person who knows where their material came from, and
that is the one moment in the flow when the question is easy to answer.

Rights status, visibility and reading level are administrator fields. An
uploader who could set their own would walk their upload straight into
the front of the library.

**Do not send private uploads to a third-party LLM.** The AI correction
stage now talks to xAI by default (section 4), which the self-hosted
endpoint was not. Public-domain library text is fine to send; a reader's
private material is a different question and needs either the
self-hosted provider, or explicit consent, before it goes anywhere. This
is unresolved and must be decided before the portal accepts uploads.

---

## 6.2 What the portal actually does

Upload asks for **the file and nothing else**. Title, author, language
and length are read out of it — `domain/metadata.ts` for the rules,
`lib/extractMetadata.ts` for the I/O — and shown on an editable summary
page. Asking someone to retype what their file already says is friction
that stops uploads happening.

Extraction is harder than it sounds and the difficulty is all encoding.
A PDF's metadata carries no declared encoding, so the bytes may be
UTF-16 (with a byte-order mark, in either the `<hex>` or the `(literal)`
form), UTF-8, GBK or Big5. UTF-8 and a BOM are self-describing; GBK and
Big5 are not and are told apart by whether the result reads as real
Chinese, which needs a common-character check rather than a CJK-range
check — "München" contains a legal GBK pair for a real but unused
character. Two ordering rules are load-bearing: decode **before**
tidying whitespace (复 is U+590D, whose low byte is a carriage return),
and decode self-describing fields **individually** (joining UTF-16
fields misaligns everything after the join).

A book then sits as a **draft**: private, owned, not converted, and not
submitted. The draft is a workspace, not a form — it can be read, its
DOCX master downloaded, corrected and re-uploaded, and it can be
deleted. Deleting is refused only when other readers have spent credits
on it, because an entitlement never expires.

Submitting for review is a separate, optional act on a finished book,
because asking someone to decide about publication before they have
seen a converted page is asking them to guess. A book may stay private
forever.

### Conversion quota

Three books and 1200 pages a month, administrators unlimited
(`domain/uploadQuota.ts`). Counted at conversion, not upload: a draft
costs nothing, so a refused conversion leaves the draft to convert next
month rather than being thrown away. The page rule is "would this take
the total past the limit", not "is there any room left".

The quota needs a page count before anything is rendered, which is
circular — so it runs on an estimate read from the file (the PDF page
tree, Word's statistics, or characters of text), and the exact count
replaces it once conversion finishes.

### The uploader's share

When a reader spends credits sending someone else's upload, the
uploader earns a share: 33% for a public-domain text, 66% for one they
wrote or hold a licence to (`domain/uploaderShare.ts`). Nothing else
earns — `user_owned` never clears public distribution, and a staff-
entered library book has no uploader.

Shares accumulate in **hundredths of a credit**. This is not fussiness:
a third of a 1-credit book is 0.33, so paying whole credits per delivery
pays nothing at all for every book under four credits, which is most of
them. A credit is paid each time the total crosses a hundred and the
remainder carries.

---

# 7. AI BOOK PRODUCTION PIPELINE

The production pipeline is:

Source
  |
  +--> DOCX
  |
  +--> scanned PDF/images
           |
          OCR
           |
           v
      raw document
           |
           v
      normalization
           |
           v
      AI-assisted correction
           |
           v
      editable DOCX
           |
      human review
           |
           v
      approved DOCX
           |
      +----+---------+
      |              |
      v              v
    EPUB            PDF
      |
      v
optional other formats

The AI must NOT blindly rewrite literary/historical source material.

AI should primarily assist with:

- OCR correction
- punctuation
- obvious OCR errors
- paragraph reconstruction
- heading detection
- structural normalization
- metadata extraction
- formatting suggestions

Preserve original wording.

The system should make AI modifications auditable.

Prefer:

original text
+
AI suggested correction
+
confidence/reason
+
human approval

rather than silently replacing source content.

---

# 8. OCR

Investigate suitable OCR technology, especially for Chinese books.

Potential technology:

- PaddleOCR
- Tesseract where appropriate
- other open-source OCR tools if better

The system should support:

- Chinese
- English
- mixed Chinese/English
- scanned historical books
- page layout
- headings
- paragraphs
- footnotes where feasible

Design OCR as an abstraction so it can be replaced later.

---

# 9. DOCX GENERATION

The conversion service should be able to generate a high-quality editable DOCX.

Potential Python libraries/tools may include:

- python-docx
- LibreOffice
- Pandoc

Evaluate which combination provides the best output.

Do not assume a library is suitable without testing.

The generated DOCX should preserve:

- headings
- paragraphs
- page breaks
- footnotes if possible
- emphasis
- tables if present
- Chinese typography
- metadata

---

# 10. EPUB

EPUB should be the PRIMARY reflowable reader format.

Important:

EPUB allows the reader/device to dynamically control:

- font size
- margins
- line spacing
- theme
- reading layout

Therefore do NOT attempt to make a single PDF behave like a fully reflowable EPUB.

Generate valid EPUB 3 where practical.

Validate generated EPUB files.

---

# 11. PDF

PDF should have several variants.

For example:

- Standard
- Large
- Extra Large

The exact typography should be configurable.

The user can choose:

Download PDF — Standard
Download PDF — Large
Download PDF — Extra Large

PDF generation should use a reliable HTML/CSS-to-PDF or equivalent rendering system.

Investigate:

- WeasyPrint
- Playwright/Chromium
- LibreOffice
- Pandoc

Choose the most reliable solution after evaluation.

---

# 12. MOBI / OTHER FORMATS

Do not prioritize legacy formats unnecessarily.

EPUB should be primary.

Support MOBI/AZW3 only if there is a concrete compatibility reason.

Design the conversion layer so additional formats can be added later.

For example:

FormatGenerator interface:

generate_epub()
generate_pdf()
generate_mobi()

---

# 13. CONVERSION SERVICE

Create a standalone service.

Suggested stack:

Python
FastAPI
Cloudflare Queues for the handoff from the Worker
S3-compatible object storage (R2, over the S3 API — the converter is not
a Worker and so has no binding; it is the one component that legitimately
holds R2 credentials)

Celery + Redis were specified here until 2026-08-13. Cloudflare Queues
replaced them for the *web → converter* handoff, because the enqueuing
side is a Worker and a native queue keeps that to one bounded write with
no Redis to run. An in-process queue inside the converter is still fine
for its own pipeline stages.

Built so far: PyMuPDF rendering, a PaddleOCR backend behind an
interface, normalization/structure, python-docx master generation, and
the AI correction stage — driven by a CLI (`app/cli.py`) rather than an
API. The CLI came first deliberately: a book takes hours to OCR, and an
editor needs to re-run the structure and DOCX stages against a cached
read without paying for the OCR again.

The correction stage is two commands, `correct` and `apply`, with a
human review file between them, because section 7's requirement is not
satisfiable by a prompt. `correct` writes suggestions and changes
nothing; deterministic guardrails in `app/llm/correct.py` refuse
anything that reads as a rewrite rather than an OCR repair, and record
why. `services/converter/README.md` has the detail.

Also built since: EPUB 3 and the three PDF variants (`app/epub`,
`app/pdf`, from one shared HTML rendering in `app/render` so the two
cannot drift), R2 over the S3 API (`app/storage`), the asynchronous job
API (`app/api`), and the handoff (`app/handoff`).

The handoff is a **pull**, not Cloudflare Queues. The converter has no
inbound port — the thing that makes it deployable behind a filtered
egress — so it polls `GET /api/conversion` on the Worker, which hands
out one queued book at a time with a compare-and-swap, and reports back
to `POST /api/conversion`. A pull consumer against Queues would be the
same shape with a queue to provision, a second place for the job list to
disagree with the Book row, and no atomic claim. The Book row is already
the durable record. Swapping in Queues later replaces one route and one
poller; nothing else knows.

The endpoint authenticates with `CONVERTER_SECRET` and **fails closed**:
with no secret configured it 404s as though it does not exist, so
deploying ahead of the secret exposes nothing.

A job now carries a `kind`, because there are two of them:

    kind: "master"    ocr_key (or source_key) → DOCX master
    kind: "formats"   master_key              → EPUB, PDF…

`ocr_key` is a JSON document in R2 — `books/{id}/ocr/pages.json`, shape
and version in `apps/web/src/domain/ocr.ts` — holding the pages the
engine read, in order, as paragraphs. It is absent for a DOCX or plain
text upload, which needed no OCR; the converter reads `source_key`
instead. The completion `POST` carries the same `kind`, and phase 1
finishing does **not** publish a book: a DOCX master is not a readable
edition.

Phase 2 is claimable on its own, which is what makes a corrected master
cheap to act on.

Not yet built: the converter side of both job kinds — it still expects
the single-phase job it was written against. And where the converter
container runs, which is still deliberately open.

Example:

services/
  converter/
    app/
      api/
      pipeline/
      ocr/
      llm/
      docx/
      epub/
      pdf/
      storage/
      jobs/
      models/
    Dockerfile
    requirements.txt

The API should be asynchronous.

Example:

POST /api/v1/jobs

returns:

{
  "job_id": "...",
  "status": "queued"
}

Then:

GET /api/v1/jobs/{job_id}

Possible states:

queued
ocr
normalizing
ai_processing
docx_generation
human_review
format_generation
completed
failed
cancelled

Do not make the HTTP request wait for a long-running OCR/LLM conversion.

---

# 14. STORAGE

Target: S3-compatible object storage.

Production:

Cloudflare R2. Chosen over AWS S3 because the domain and DNS already
live on Cloudflare and R2 has no egress fees.

The web application reaches it through a Worker **binding**, not the S3
API — so there is no access key in its environment. The converter, which
is not a Worker, uses the S3 API with credentials. R2 being
S3-compatible keeps a later move to S3 a configuration change on that
side rather than a rewrite.

Development:

`wrangler dev` provides a local R2 simulation through the same binding,
so the stack runs with no cloud account; `tools/mirror-r2-local.sh`
copies real artifacts into it. A local-disk path also remains in
`src/lib/storage.ts` for running without Cloudflare at all.

The download path must **stream artifacts through the application**,
never redirect to a public object URL: protected artifacts must not be
reachable without passing the server-side rights and credit
checks.

Short-lived signed URLs were the original design and are no longer
available — presigning is an S3-API feature and the R2 binding has no
equivalent. This is a better shape regardless: no credential exists to
be lifted, and no URL outlives the authorization decision that produced
it. Streaming is I/O, so it stays cheap on a Worker.

Suggested structure:

books/
  {book_id}/
    book/
      master.docx
      book.epub
      standard.pdf
      large.pdf
      xl.pdf

conversion/
  {job_id}/
    input/
    intermediate/
    output/

covers/
