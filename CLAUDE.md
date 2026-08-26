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

**Payload's generated admin panel is not part of that**, since
2026-08-24. `/admin` is NobleSee's own editorial UI and the only one;
`app/(payload)/cms` is deleted, which is how Payload says to disable a
panel now that `admin.disable` is deprecated. It survived as the tool
for whatever the editorial UI had no screen for, and what that came
down to in the end was two acts — granting the admin role and
correcting an email — which are now the readers panel. Deleting it
takes `@payloadcms/next/views` out of a Worker bundle that had reached
7.7 MB gzipped against a 10 MB limit.

What it took with it is worth stating: a browser view of the
`Downloads`, `Entitlements`, `credit-ledger` and `reading-progress`
collections for anyone other than yourself, and the Media list. Each is
still reachable through `app/(payload)/api`, which stays. A screen for
them is a real piece of work and a fair thing to want; it is not a
reason to keep an entire second admin.

Since 2026-08-25 that API is at least *legible*: `/api/docs` serves
Swagger UI over an OpenAPI 3 document generated from the collection
configs themselves (`apps/web/src/plugins/apiDocs.ts`), so the docs
cannot drift from the API the way a hand-written spec would. It is
administrators-only and answers Payload's own "route not found" to
everyone else — the document names every collection and its whole field
shape, which is a map worth not publishing. This is not a replacement
for the missing screens. Reading `credit-ledger` through Swagger is
still reading a table, not looking at an account.

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
  replaceable (`domain/adobe.ts` and `app/llm/client.py` are the
  pattern);
- credentials come from the environment, never from source;
- when user-owned content goes to a third-party service, say so on the
  screen where that is chosen (section 6.1). The rule is disclosure and
  a private alternative, not a prohibition.

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

A scanned PDF becomes a DOCX master through **Adobe PDF Services**,
over its REST API — the Export PDF operation, with an `ocrLang` of
`zh-Hant`, `zh-CN` or `en-US`. This was Google Document AI until
2026-08-19 and PaddleOCR until 2026-08-14; `infra/documentai.tf` still
provisions the Google resources and carries a banner saying nothing
calls them.

The reason for each move is the same one and it is not OCR quality. OCR
cannot run on a Worker — 128 MB of memory and five minutes of CPU
against a model needing more of both — so calling a hosted service turns
that compute into an HTTP request, which a Worker is billed almost
nothing for. Document AI did that for the *reading*. Adobe does it for
the reading **and the mastering**, in one call, which is the whole of
phase 1 rather than the first half of it.

That collapse is what the change bought, and it deleted more than it
added:

- **No OCR handoff document.** Document AI returned one string for a
  whole document plus byte ranges into it, sharded across files, with
  int64 offsets encoded as strings and indexed in code points. Slicing
  that back into pages was `domain/ocr.ts`, and it is gone.
- **No running-head removal.** Adobe puts running heads and folios in
  Word's header and footer parts, which the converter's `docx.paragraphs`
  walk does not read. They are excluded by *where they are* rather than
  by inferring position from normalized vertices across the book.
- **No heading classification, and no paying for style information.**
  Adobe returns `Heading 1` / `Heading 2`, which `sources/docx_in.py`
  already maps — because a corrected master had to be readable back
  anyway. Document AI only offered type sizes to reason from, and only
  as a premium per-page extra.

What it costs is worth stating plainly. Adobe's structure detection is
now unauditable in a way ours was not: when it decides wrongly, there is
no ratio to tune, only a master to correct. Section 5 already says the
master is the source of truth and open to correction, so that is the
intended repair — but it is a human's time rather than a threshold.

Limits that constrain the material: **100 MB per file**, which a
400-page 300dpi scan can exceed, and which is refused before upload with
something an uploader can act on; and one document transaction per 50
pages, so a 400-page book costs 8.

Since 2026-08-24 the portal's own limit is **also 100 MB**, and the
agreement is not a coincidence — it is the point. It was 64 MB, set by
Worker memory rather than by anything about books: uploads arrived
through a Next server action, which parses the whole request into
memory before any of our code runs. The upload is now a raw request
body streamed straight into R2 (`api/upload/route.ts`), so memory no
longer decides it and the two ceilings that remain — Adobe's, and
Cloudflare's 100 MB request cap on Free and Pro — are the same number.

A file the portal accepts is therefore a file Adobe will read. Raising
it further means a Business plan *and* an answer for scans Adobe
refuses, which is a product decision rather than a constant.

Because of all that, **the pipeline is split at the master**, not at
OCR. The web application produces the DOCX master for a PDF and the
converter renders everything downstream of it. This is the one place the
rule above ("do not turn the web application into the conversion
pipeline") is deliberately bent, and only because mastering a scan
stopped being computation and became a fetch. Everything that is still
computation is still the converter's — including phase 1 for a DOCX or
plain text upload, which needs no export and reaches the converter as
itself.

Nothing schedules the export stages. The converter already polls
`GET /api/conversion` for work, and that poll is used as the clock —
each one advances at most one book before answering
(`apps/web/src/lib/masterPipeline.ts`). No cron, no queue consumer, and
nothing fires when no converter is running. The cost is that a scan does
not progress while nothing is polling, which is harmless: nothing
downstream could act on it if it did.

Credentials are `ADOBE_CLIENT_ID` and `ADOBE_CLIENT_SECRET`, from a
project in the Adobe Developer Console. **An Acrobat Pro subscription is
not these credentials** — it licenses the desktop and web applications
and carries no API access. PDF Services is a separate product with its
own free tier (500 document transactions a month) and its own paid
plans. With the secrets unset the export stages do not run at all, so
the Worker deploys fine ahead of them.

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

## Phase 2 does not wait for review

Phase 2 runs as soon as a master exists. Every book that reaches
`master_ready` is offered to the next converter that polls, whoever owns
it and whatever its review state — `claimFor` in
`apps/web/src/domain/pipeline.ts` consults neither.

Between 2026-08-15 and 2026-08-17 it did wait: a reader's upload sat at
`master_ready` until an administrator approved it. That gate was
backwards, in two ways that only show up from the outside.

**What a reviewer reads is the finished edition.** Publication publishes
the deliverables — the EPUB is what a reader will actually open, so it is
what the decision is about. Holding the EPUB until the review left the
reviewer with a DOCX master and an act of imagination.

**A private book is never submitted at all.** Section 6.2 says an upload
may stay private forever and that submitting is optional. Under the gate,
"optional" meant the book was never converted past its master, so the one
reader entitled to it could not read it either — while section 5.2
promises exactly that reader every word.

Review still decides publication, and `enforcePublicationReview` in the
Books collection is where it is enforced: an owned book cannot become
`visibility: public` without an approved review *and* a rights status
that permits distribution. That is the gate that was always doing the
work. Building an EPUB is not publishing it — a converted private upload
is `status: published` but still `visibility: private`, readable by its
owner and by nobody else (`readBooks` in `collections/Books.ts`).

Reviewing therefore means reading the book: an administrator opens
`/read/<slug>` like anyone else, which is what the Books access rule
grants them.

## Four sources, and what each one needs

The uploaded file can be a **PDF, a DOCX, an EPUB** or plain text, and
what happens next is almost entirely decided by which it is
(`apps/web/src/domain/publication.ts`):

    PDF    the owner chooses: read it into a master and build the EPUB,
           or publish the file exactly as it stands
    text   the owner chooses: build a master and an EPUB from it,
           or publish the text exactly as it stands
    DOCX   already the master — no conversion to one; build EPUB + PDF
    EPUB   already the edition — nothing is converted at all

**Two of the four get a choice**, and they are the two where converting
buys something an uploader might reasonably decline.

For a PDF the trade is the sharp one: a scan has to be read before it
can reflow, which costs money and time and can go wrong, while a
born-digital PDF may already be perfectly good. Nobody but the uploader
can weigh that.

Text joined it on 2026-08-26. Until then it was always converted, on the
reasoning that a .txt has no layout of its own so publishing it as it
stands is publishing a text file. True, and not a reason to refuse: a
text file **reflows**, which is the whole property the pipeline exists
to give a scan. What converting adds is *structure* — chapters, a
contents list, a navigable EPUB — and that is worth offering rather than
imposing, especially while it means waiting for a converter that may not
be running.

So a text upload can be read, reviewed, published and sent to a Kindle
as itself. `txt` is an artifact format
(`domain/conversion.ts`), never generated and only ever the upload kept
as itself; `readingFormat` puts it last, behind the editions a
conversion would produce, and `/read` sets it as prose in the site's own
typography (`components/TextReader.tsx`) rather than handing it to a
viewer. Amazon has accepted `.txt` for as long as it has accepted
anything, so delivery needed nothing new.

That change closed a quieter hole. `originalArtifact('text')` returned
null, which meant a converted text book's original was never filed under
the book at all — it stayed at the `conversion/` key, which the R2
lifecycle rule sweeps after 30 days. "Always keep the original" now
holds for every source.

DOCX and EPUB have exactly one sensible path each, so their owners are
*told* what will happen rather than asked to pick from a list of one.

Publishing a *PDF* as it stands means the reader gets a fixed-layout
book and no EPUB. That is a real cost against the mission — "not merely
to host PDFs" — and it was the reason converting was the default rather
than the choice being neutral. (For text the cost is much smaller, as
above: the words already reflow.)

**Since 2026-08-25 the default is the other one**: publish it as it
stands, convert nothing, ready immediately. The reasoning above is still
right about the finished book and was wrong about this moment.
Converting is the expensive path — an Adobe export, a converter that may
not be polling, minutes to hours before the uploader sees anything — and
it was being taken on behalf of someone who had done nothing yet but
choose a file.

What makes the fast default safe is that it is the one that cannot be
regretted. The original is kept whatever is chosen, so nothing is lost
by starting there, and a reader who wanted their book today cannot
un-wait for a conversion they did not ask for. The mission is served by
the option being offered plainly on the same screen, with what it costs
to skip it said out loud, rather than by taking the decision for them.

The decision stays reversible, and *that* is now load-bearing rather
than a footnote: switching a settled book from as-it-stands to converted
puts it back in the queue, re-stamps its `startedAt` so the conversion
is charged to the month it actually happens in, and builds the EPUB on
top of the PDF already filed (`saveBookDetails`). Only in that
direction — a converted book set back to as-it-stands is a metadata
change, not a request to delete an EPUB somebody may already have been
sent.

## Everything slow is queued, and a worker moves the book

There is no synchronous conversion anywhere. The expensive stages — the
PDF→DOCX export, and EPUB/PDF generation — are queues, and the book's
own `conversion.state` *is* the queue and the status. A worker claims a
book by a compare-and-swap on that state, does the work, and reports
back; the owner watches the state change on their book page
(`ConversionProgress`). Nothing blocks a request on any of it.

That is why a book with nothing to convert — an EPUB upload, or a PDF
published as it stands — still passes through `queued`. It is filed by
the same poll, just without a job at the end of it.

Phase 2 builds everything the source can give it, on the first run.
`requestFormat`, `conversion.pendingFormats` and the on-demand button
existed to ration WeasyPrint across three PDF sizes; no PDF is rendered
at all any more (section 11), so there is nothing left to ration and all
three are gone.

`formatsToBuild` still has one subtle case: when the book already has
formats, every one of them is rebuilt. That is a master edit, and
regenerating only what is missing would leave the existing EPUB behind,
still carrying the errors the edit removed.

The conversion service is
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
- The provider is a third party, which the self-hosted endpoint was not.
  **Whether a reader's upload goes to it is the reader's decision**, made
  on the upload screen and stored as `conversion.aiCorrection`
  (migration `20260826_090000_ai_correction`). The web application passes
  that answer through as `allow_third_party_ai`; it was a hard-coded
  `false` until 2026-08-26, under a rule that forbade the send outright.
  Unanswered means no — an absent or null column reads as `false`, so
  every book uploaded before the question existed stays where it was.
- Correction is **advisory whatever the answer**. The stage writes
  suggestions and a human approves them (section 7); consenting to the
  send is not consenting to an edit.
- **The person who approves them is the book's owner**, on their own
  book page, since 2026-08-26. Until then `allow_third_party_ai` reached
  the converter and nothing read it but a progress label: the correction
  stage existed only in `app/cli.py`, so the checkbox proposed nothing,
  sent no text anywhere, and there was no screen on which anyone could
  have adopted a suggestion. `domain/correction.ts` is the state it now
  drives.

---

# 5. BOOK DOMAIN MODEL

Design a proper book model.

A Book should include concepts such as:

- id
- title
- subtitle
- author
- language
- description
- cover
- copyright/licensing status
- publication metadata
- status
- created_at
- updated_at
- collection, and `collectionOrder` — its place among that collection's
  own books (section 5.4)

`translator` was on that list and on the book until 2026-08-25. It is
gone, column included (`20260825_120000_drop_translator`). Nothing ever
filled it in: extraction reads a title, an author, a language and a
length out of a file (`domain/metadata.ts`) and no source carries a
translator, so on the upload form it was the one box that was always
empty and always prose — asking an uploader confirming their own scan to
compose something, which is the argument that had kept it off that form
until 2026-08-21. The credit reads better in the description, which is
where both seed books already carried it, so the byline on a book page
lost nothing a reader was relying on.

A book is whole. It was split into Parts until 2026-08-14, each
separately released and separately downloadable; that is gone, and the
`parts` table with it. A book is one record, one DOCX master, one set of
generated formats — as it was written.

Example:

Book
|
+-- pageCount, priceCredits
|
+-- the original          preserved, whatever was uploaded
+-- DOCX (master)         owner only, never a reader download
+-- EPUB                  the reading edition
+-- PDF                   mirrors the original's own layout
+-- TXT                   a plain text upload, kept as itself

The original is **always** one of those slots, which is what makes
"always keep the original" cost nothing extra rather than doubling every
book (`apps/web/src/domain/publication.ts`). A PDF upload *is* the
book's PDF; a DOCX upload *is* its master; an EPUB upload *is* its
EPUB; a text upload *is* its TXT. That last one only since 2026-08-26 —
before it, text had no slot, so its original was left at the
`conversion/` key and swept after 30 days.

The cover is a further file and is not one of those five. Since
2026-08-23 a book with no uploaded cover gets **page one of itself**,
rendered as a JPEG beside its artifacts (`apps/web/src/domain/cover.ts`).
For a scan that page *is* the cover the publisher printed, which is why
the PDF is preferred over the EPUB's declared cover.

Two covers, and the order between them is the whole rule: an uploaded
`cover` is a deliberate choice and always wins; `generatedCover` is
only ever the default. When there is neither, the tile still draws the
book's own first character, which was the only answer before this and
remains the right one for a book nothing can be rendered from.

Rendering happens **once**. The same opening pages of the same file
rasterize to the same pictures, so the "render again" that sat beside
the picker was a download and a wait in exchange for the images already
in the bucket; it is gone from both screens, and making a cover is
offered only while nothing has been rendered — which still covers the
case that matters, a render that failed and never reached `ready`.

Page one is the default rather than the definition, since 2026-08-25.
The **first three pages** are rendered and the book records which of
them it wears, because the page a publisher printed the cover
on is frequently not the first leaf a scanner fed — a blank verso, a
library stamp, a half-title. Three is the number for the same reason
the choice exists at all: past a leaf or two it stops being "which of
these is the cover" and becomes browsing the book, which the reader
already does. An EPUB has one declared cover image and no pages, so it
has one candidate and no choice.

Uploading that image is **the owner's or an administrator's**, since
2026-08-25 — it was administrators only, through
`app/(admin)/actions/cover.ts`, which is now deleted and its two actions
moved beside the page choice in `app/(frontend)/actions/cover.ts`. One
rule, one file. Both covers are now served by the same
door: `/covers/<id>` asks the Books access rule and then streams either
the uploaded image or a rendered page, and `Media` refuses everyone but
an administrator. It was `read: () => true`, which was survivable while
only administrators uploaded — they upload for books already in the
library — and became a hole the moment an owner could upload for a
private draft, because the file sat at `/api/media/file/<filename>`
under whatever the uploader called it. `cover.jpg` is not a secret.

The choice of *which rendered page* belongs to **the owner or an
administrator** too, which is the one place a book's uploader and its
editors have equal power over it.
Everything else on that boundary is asymmetric — rights, visibility and
level are the administrator's (section 6.1), the bibliographic fields
are the uploader's. A cover is neither: it is not a claim about the
book, only which photograph of it looks right, and the person holding
the physical copy is at least as well placed to say. The control is one
component (`components/CoverPagePicker.tsx`) on both screens, over one
action (`app/(frontend)/actions/cover.ts`).

That also fixed something quieter: until then the one person who never
saw a book's cover was the person who uploaded it. It is rendered after
conversion, onto pages a private upload appears on none of — so the
owner's own book page now shows it.

Books whose cover was rendered before this keep it, at the unsuffixed
key page one has always had, and are simply offered no alternatives —
nothing was rendered to offer. "Make a cover from the book" on either
screen renders a fresh set.

**The rendering happens in the browser**, and that is the important
part. It was job kind three on the converter until 2026-08-25, claimed
off the same poll as OCR and format generation — an accident of where
the renderer happened to be written, and it cost the library every
cover it had: a converter claimed each of the fourteen books, never
reported back, and `claimCover` only ever offered `pending`, so nothing
retried and nothing said so. Rasterizing page one has nothing to do
with converting a book.

So it happens on the machine that already has the file open
(`apps/web/src/lib/client/coverImages.ts`). The uploader's browser
renders the candidates between the upload finishing and the draft page
loading, so a book has a cover *before* its conversion is queued; an
editor's browser does it for a book already in the library, reading the
source back through `/covers/<id>/source` (owner or administrator
only). pdf.js rasterizes a PDF, epub.js pulls the declared image out of
an EPUB, and both are dynamically imported so a reader who never
uploads downloads neither.

Two things this cannot do, and they are the price. **There is no DOCX
renderer in a browser**, so a book whose only artifact is a master
waits for the PDF phase 2 builds anyway — what the converter produced
there was the first page of typeset text, the unhappy case even when it
worked. And making a cover for an existing book means **downloading the
book to photograph its first page**, which for a 60 MB scan is a real
wait on a slow connection; the button says so rather than pretending
otherwise.

The Worker was never a candidate for this. pdf.js is a megabyte of
JavaScript against a bundle already at 7.7 MB of a 10 MB limit, and
rasterizing is exactly the CPU-shaped work section 3 says does not
belong there.

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
(section 6.1). An upload arrives at **normal** — the library's own
default (`DEFAULT_BOOK_LEVEL`), not the tail. It arrived at `extensive`
until 2026-08-24, on the reasoning that an unreviewed upload should not
surface in the default browse view; but what keeps it out of that view
is `visibility: 'private'`, and levels are curation rather than access
control. All the old default achieved was that an approved book landed
in the tail unless somebody remembered to move it.

An editor sets a level three ways, and they are the same field:
one book at a time from the pill in the Books list (comparative — the
question is about the books either side of it), one book at a time in
that screen's edit panel, and **a whole shelf at once** from
`/admin/collections`. The shelf form hands a level down the collection's
entire subtree, in one of two modes that `shelfLevelFor` in
`domain/levels.ts` owns: as a **cap**, which can only ever move a book
shallower and leaves a curated one alone, or **exactly**, which
overwrites whatever was there. Cap is what the form offers first. A
shelf stores no level of its own — this is an act performed on books,
not an attribute that a book filed there later would inherit.

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

## 5.3 Collections nest

A collection is a shelf, and a shelf can stand on another shelf:
"Confucian" under "Chinese Classics", "Nan Huaijin" under "Authors".
The rule that makes it worth having is that **a parent carries
everything beneath it** — a reader who opens "Chinese Classics" gets the
books filed directly on it and the books on every shelf standing on it.
Anything less and nesting is only filing.

The tree, the subtree filter behind `?collection=`, and the rules about
what may be filed under what are `apps/web/src/domain/collectionTree.ts`.
Three of those rules earn their place:

- A collection may not be its own ancestor. Enforced in a collection
  hook rather than only in the admin screen, because the admin screen is
  not the only door into the table — the REST API is another — and a
  ring of collections would strand every shelf in it.
- The tree is three levels deep at most, counting a *moved subtree's*
  own height rather than just the node being moved. The limit is
  editorial: past a grandchild a reader is navigating a filesystem
  rather than browsing a library.
- A parent that no longer exists reads as a root. Deleting a shelf
  therefore never makes its children vanish, which matters because the
  foreign key clears the reference rather than refusing the delete.

Ordering is per-parent: the arrows in `/admin/collections` move a shelf
among its own siblings and can never lift it out of the one it stands
on. Where it is filed is a separate decision, made with the parent
picker on the same card.

The browse page shows **the whole tree at once, folded**. Every shelf
and every shelf standing on it is on the page, and each heading is a
control that collapses its own subtree
(`components/CollectionShelves.tsx`).

It showed one level at a time until 2026-08-24 — root shelves in the
library, a collection's own children once you were inside it — because
a nested library rendered flat is a wall of every shelf at once. The
wall is real; drilling down was the wrong answer to it. It hid the
library behind a click and made a reader guess which shelf was worth
opening, which is the opposite of browsing. Folding answers the same
objection directly: a reader who wants a shelf out of the way puts it
out of the way, and nothing else moves.

Two things survive that change and are worth stating, because they are
what keeps the page from becoming an application:

- **A shelf is still a URL.** `?collection=` narrows the page to one
  subtree and puts a breadcrumb above it. It is no longer reachable
  from the library's own headings — those are folds now — but the
  homepage's teaser shelves link to it, and it is what a reader shares.
- **Only the fold is client-side.** The reading level stays a plain
  link with a query string, because a level is a *view* someone would
  send to someone else, where a fold is a per-reader convenience. The
  page still renders on the server; the JavaScript only folds it.

Each shelf renders the books filed **directly** on it. A parent carries
its descendants by containing them on the page rather than by absorbing
their books, so nothing is printed twice — which is a different rule
from `?collection=`, where a parent genuinely does answer with its whole
subtree because its children are not on screen to answer for
themselves.

---

## 5.4 Two orders, on every shelf

The **books** filed on a collection are ordered two ways:

    alphabetical  by title                        the default
    sequence      by the order id each book carries

**The shelf decides, not the reader.** Every collection carries
`childOrder`, and it defaults to alphabetical: a library nobody has
curated reads A–Z, which is the order a reader can predict and scan. A
curator switches one shelf to `sequence` when its contents have an
order of their own — a ten-volume set, a reading path, a "start here" —
and only that shelf changes.

It was one global answer until 2026-08-25, chosen by the reader with
`?sort=` and defaulting to `sequence`. One answer is wrong for a
library where most shelves have no order of their own and a few have a
strong one: the alphabet was something a reader had to ask for, and the
volume set only read correctly by luck of the numbers it had been
handed.

**The shelves themselves are a separate question, and the answer is the
admin's.** Where a shelf stands among its siblings — at every depth,
the root included — is `sortOrder`, set by the reorder arrows in
`/admin/collections`, and nothing re-sorts it afterwards. The public
library renders the tree in exactly the order the editorial tree shows
it. It did not until 2026-08-25: root shelves were alphabetized on the
public page because they had no parent to carry a `childOrder`, so the
arrows arranged a root order only an editor ever saw. `childOrder`
governs a shelf's books; the arrows govern the shelves.

The reader's toggle is **gone**, on 2026-08-25 — "As arranged / A–Z /
Curated", and the `?sort=` override behind it that forced one rule
across every shelf on the page. The argument for keeping it was that
alphabetical is what you want when you are *looking for* a book rather
than being shown one. That is true, and it is what search is for. How
the library reads is an editorial judgement about where a reader should
start, and handing a visitor a pill that overrules every shelf at once
is handing back the curation the library exists to provide.

The sequence is **a number the item carries**, not a position in a list.
It is handed out one past the highest on the shelf when the item is
filed, and an editor can change it — so `sequence` means "the order they
arrived in" until somebody renumbers. Every filed item carries one
whether or not any shelf consults it; `childOrder` decides that.

**It need not be unique.** Two books on a shelf may both be 3 and then
read alphabetically between themselves, so setting a number writes one
row and moves nothing else. It used to *shift* the run of occupants
along to keep the numbers unique, so one edit rewrote half a shelf and
books nobody touched moved. Collections carry the same number among their own
siblings; `sortOrder` has been exactly this idea for shelves since
2026-08-21, and this makes it a number an editor types rather than only
something the reorder arrows move.

The numbers need not be contiguous either. Nothing renumbers a shelf
because a book left it, so 1, 2, 5 is a normal state and the gap is not
a bug to tidy: an order id an editor typed is a fact they stated, and
closing a gap under them would move books nobody touched.

Ordering a shelf's books happens **per shelf, in the page**, not in the
catalog query. One SQL `ORDER BY` cannot be alphabetical for one shelf
and by order id for the next, so the query returns a stable order and
`books/page.tsx` sorts each shelf's own books with `shelfSortFor`. The
admin tree does the same, from the same function, so an editor
arranging a shelf is looking at what the shelf actually does. The
shelves are not sorted in either page — they arrive from
`getCollections()` in `sortOrder` order and stay in it.

**Choosing a number is an administrator's.** Filing is not: an uploader
picks their book's collection on their own book page, and the arrival
hook gives it the next free number — a book joining the back of a
queue. Typing a number shifts the books already there, so it moves
other people's books and states what a reader should meet first. Since
2026-08-25 that is enforced as field-level write access on
`collectionOrder` (and on a collection's own `sortOrder`), not merely by
which screen offers the control: Payload's REST and GraphQL APIs are
another door, `overrideAccess` is off there, and an unspecified access
rule defaults to *any logged-in user* — so a signed-in reader could
PATCH the field and walk their own upload to the front of a shelf.
`ADMIN_ONLY_BOOK_FIELDS` in `domain/moderation.ts` is the list, and it
is now wired into the collection rather than only asserted in tests.

`lib/shelfPlacement.ts` is gone with the shifting. A place is one field
on one row now, written with the rest of the edit rather than in a
second pass against the shelf the book ended up on, so the admin screen
and the admin JSON API both just set the field. An editor sets a
shelf's `childOrder` on the same card, beside the number.

The hooks (`assignCollectionOrder`, `assignSiblingOrder`) therefore do
one thing: give a number to something that has just arrived, or has just
moved to another shelf — one past the highest already on it. There is a trap in them worth knowing about,
because it bit once already — Payload hands a `beforeChange` hook the
whole document with the update merged into it, so the order field is
*always* present on an update. "The caller stated a number" has to mean
"a number different from the stored one"; reading its mere presence as
an instruction made every move to another shelf keep the number it had
on the shelf it left.

An unfiled book has no order id at all. The number is a position among a
collection's own books, so off the shelf there is nothing for it to be a
position in — and a book nobody has numbered sorts last, under the
alphabetical fallback, which is the rule `sortOrder` has always had.

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

A reader may upload a scanned PDF, an ordinary text-layer PDF, a DOCX,
an **EPUB** or a plain text file. What each one needs is in section 3
("Four sources"); what they share is the destination. A converted book
gets everything the library offers — the EPUB, the PDF, delivery to an
e-reader and the online reader — with no second-class path.

A book published as it stands is the deliberate exception: its owner
chose a faithful copy over a reflowable one, so it has a PDF and no
EPUB. It is still delivered, still read from the book page, and still
theirs.

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

**The two gates are two questions, not two buttons.** Since 2026-08-24
approving a submission publishes it, in the same act: the review queue
has one Approve control and no Publish control, and no visibility
setting anywhere in the admin. Publishing was separate until then, on
the argument that the questions differ — and they do — but the second
one has exactly one person who can answer it and one moment at which
they do. Approving without publishing produced a state nobody could
explain to an uploader: an "Approved" chip on a book still invisible to
every reader.

So the rights gate moved in *front* of the approval rather than behind
it. A submission whose rights do not permit distribution cannot be
approved at all, and the queue says so with the control disabled rather
than offering a button that would be refused. That is what the design
draws, and `approveSubmission` in `app/(admin)/actions/review.ts`
enforces it before the write — reading the review state **as stored**,
not the `approved` it is about to write, because otherwise the
`not_offered` gate would find every book offered.

Nothing about the second gate itself changed and nothing about it can.
`isPubliclyDistributable` is consulted by the action, by
`canPublishToLibrary`, and a third time by `enforcePublicationReview` on
the write, which is the rule for every writer, the REST API included.
The
invariant is still that a public owned book has an approved review;
approval and publication being one act is what now makes it true by
construction.

Nothing about the second gate changed, and nothing about it can. An
administrator publishing their own upload is refused exactly as a reader
would be if its rights are not cleared.

There is a third thing here, easy to mistake for the first: **the
uploader offering the book**. The approval is an administrator's to give
early; the offer is not theirs at all. A private upload that was never
submitted stays private whoever is asking — section 6.2 promises it may
stay private forever — unless the administrator is its uploader, in
which case they are both parties and their own submission publishes
itself rather than queueing for them to find.

**Who uploaded a book is not public.** The `owner` field is readable by
its own owner and by an administrator, and by nobody else — enforced as
field-level read access in `collections/Books.ts`, so it is absent from
the UI, from a populated relationship, and from `/api/books` and
GraphQL alike. The uploader's *identity* was always protected by the
Users collection's read rule; what this closes is the correlation, that
a given set of books shares an uploader. Field access is skipped under
`overrideAccess: true`, which is how every ownership check in the
application still reads it.

Rights status, visibility and reading level are administrator fields. An
uploader who could set their own would walk their upload straight into
the front of the library.

**Tell the uploader who else will see their file, and let them decide.**

This section forbade sending a private upload to a third party at all,
until 2026-08-26. That rule could not survive the pipeline it was
written for: reading a scan *is* a third-party call now (Adobe, section
3), so the prohibition banned the portal's main path. Worse, it was a
protection the person being protected never saw, could not weigh and
could not consent to.

The disclosure is on the upload screen, in the option that does the
sending — `PLAN_COPY` in `components/BookDetailsForm.tsx` carries a
`sends` line per source and plan, and it says plainly which services get
the file. It sits inside the plan card rather than under the group, so
it is read while the choice is being made and cannot drift onto the
wrong option.

**The two sends are two decisions, because they are two services.**

- **Adobe** reads a scan's pages, and there is no version of converting
  a scan that does not involve it. So it is disclosed on the plan card
  and chosen by choosing to convert.
- **The AI correction stage** is separate and optional, and since
  2026-08-26 it is its own checkbox — off unless the uploader ticks it
  (`conversion.aiCorrection`, section 4). Converting does not imply it,
  and a book converted without it never reaches a third-party model at
  all.

Which means a DOCX or plain text upload can be converted with **nothing
leaving NobleSee**, and the card says exactly that.

Three things make disclosure sufficient here rather than a shrug:

- **There is always a private alternative, and it is the default.**
  Publishing as it stands sends the file nowhere (`defaultPlanFor`), and
  the card says so in the same words.
- **The choice is the owner's.** Rights, visibility and level are the
  administrator's (above) precisely because they are claims about the
  library. Who may hold a copy of your own book is not.
- **Converting stays reversible in one direction only.** A book already
  sent cannot be un-sent, which is why the sending option is the one
  that has to be chosen deliberately rather than arrived at.

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

An administrator may delete **any** book, from the panel on
`/admin/library` — the library's own withdrawal, and the one act on that
screen that needs no ownership. It goes through the same
`canDeleteUpload` as the uploader's own delete: the ownership gate is
what the admin role opens, and the entitlement gate is not, because that
one protects a reader who paid rather than the person who uploaded.
Authority over the library is not authority over what somebody already
bought.

That panel also names the uploader and the day the book arrived, as does
every row of the tree beside it. `owner` is field-level restricted so a
reader cannot correlate one uploader's books (section 6.1); an
administrator is one of the two parties it is readable to, and this is
where they read it.

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

**Settled: Adobe PDF Services' Export PDF operation**, which reads a
scan and returns a DOCX in one call. Section 3 has the reasoning and the
limits; what matters here is the requirements list above.

It meets them. `ocrLang` accepts `zh-Hant` and `zh-CN`, so traditional
Chinese — this library's centre of gravity — is read as traditional
Chinese rather than through a simplified model. Mixed Chinese/English is
sent under the CJK locale deliberately: Latin script reads well under a
CJK locale and the reverse does not, so the asymmetric failure decides
it. Layout, headings and paragraphs come back as Word structure.
Footnotes do not survive reliably and are not claimed to.

The abstraction survived the replacement twice, which is the point of
having it, and then it moved and there is only one of it. It is
`apps/web/src/domain/adobe.ts`, which holds every rule about the engine
that is not an HTTP call, and `apps/web/src/lib/adobe/client.ts`, which
is the HTTP call. Replacing Adobe means writing a new pair; nothing
downstream of the master would know.

**PaddleOCR and `app/ocr/` are gone**, on 2026-08-26 — the engine, the
`OcrEngine` protocol, the per-page OCR cache and the rasterizer that fed
it. It had been kept as a self-hosted alternative to Adobe, and the
question that retired it is the one worth recording: *what was it for?*
Nothing called it. Every scan in production goes to Adobe, because a
Worker cannot run a model and a container running one is a container to
deploy. Its remaining arguments were Adobe's 500-transaction monthly free
tier and keeping private uploads off a third party — the first is a
billing decision rather than an architecture, and the second is now
answered by disclosure and a private alternative (section 6.1) rather
than by a second engine nobody ran.

What it cost to keep was a gigabyte of models, a native toolchain, and a
second answer to "how is a scan read" that could silently disagree with
the first.

So the converter reads a PDF only when the PDF can read itself — a text
layer, extracted exactly by PyMuPDF, page by page. A book with any page
that has no text layer is **refused**, by name and by count, and told
where scans go (`app/sources/pdf_in.py`). Refusing is the honest answer:
the alternative is the failure that classification was written to
prevent, where a scan with one born-digital title page was read through
the text path and converted "successfully" into a one-page book.

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

**Nothing renders a PDF. A book has one only when the uploader
uploaded one.**

    uploaded as a PDF     the upload itself — filed, never rendered
    uploaded as a DOCX    no PDF
    uploaded as text      no PDF
    uploaded as an EPUB   no PDF

This section has now shed the same idea twice, and the second time it
took the whole renderer with it.

It specified three variants first — Standard, Large and Extra Large,
rendered from the master at different type sizes so a reader could pick
their typography — until 2026-08-20. Three answers to a question section
10 answers better: a reflowable EPUB lets the *device* set the type size.
Two of the three were never opened.

What survived was one PDF, rendered from the master when the book had
none: WeasyPrint for a scan-built master, LibreOffice for a DOCX so the
Word layout survived. That went on 2026-08-26, and the argument is the
one this section already makes. A PDF's job here is **fidelity to the
original**. A book whose original is a DOCX or a text file has no
original page to be faithful to, so what the renderer produced was our
own typography frozen flat — strictly worse than the EPUB beside it, on
every device, for every reader. It was competing with the reading edition
rather than preserving anything.

The line that always mattered is the first one, because this library's
material is scans: perfect fidelity, zero rendering time, and nothing
that can drift from the original — by not trying to improve on it. That
line needs no renderer.

What deleting it bought is out of proportion to what it cost, and is the
real point:

- `services/converter/app/pdf/` is gone, both renderers with it.
- The converter image has **no apt layer at all** any more. WeasyPrint
  needed Pango, Cairo, libffi and a CJK font set — a PDF rendered
  without a CJK face is a document of empty boxes — and the DOCX path
  needed `libreoffice-writer`. Both are gone; the image is plain
  `python:slim`.
- Nothing in the pipeline links against a native library, which is what
  makes the remaining work (parse a DOCX, write an EPUB) a plausible
  candidate for the Worker itself.

A page count went with it. `page_count` was WeasyPrint laying the book
out and counting the pages that came out, which priced the book — and a
page was always a fact about our typesetting rather than about the book.
The web application prices from its own estimate instead: the PDF page
tree for a scan, characters over a printed-page constant for everything
else (`domain/uploadQuota.ts`, and the fallback in `collections/Books.ts`).

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

Built so far: PyMuPDF text extraction and page classification,
normalization/structure, python-docx master generation, and the AI
correction stage — driven by a CLI (`app/cli.py`) as well as the API.
The CLI's `convert` command went with PaddleOCR on 2026-08-26; `import`
covers every file that can be read without an OCR engine, which is now
every file this service accepts at all.

The correction stage is two commands, `correct` and `apply`, with a
human review file between them, because section 7's requirement is not
satisfiable by a prompt. `correct` writes suggestions and changes
nothing; deterministic guardrails in `app/llm/correct.py` refuse
anything that reads as a rewrite rather than an OCR repair, and record
why. `services/converter/README.md` has the detail.

Also built since: EPUB 3 (`app/epub`, from the HTML rendering in
`app/render`), R2 over the S3 API (`app/storage`), the asynchronous job
API (`app/api`), and the handoff (`app/handoff`). `app/pdf` is gone with
the generated PDF (section 11), and `app/render` now has one consumer
rather than two — kept as its own module because an EPUB's chapter split
and a document's HTML are still two different questions.

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

A job carries a `kind`, and there are four of them:

    kind: "master"    source_key   → DOCX master
    kind: "formats"   master_key   → EPUB, PDF…
    kind: "correct"   master_key   → suggestions, for a person to read
    kind: "apply"     decisions_key → a master rewritten from what they adopted

The last two are correction, and they are **not a third phase**. They
queue off `conversion.correction.state`, a field of their own, and never
touch `conversion.state` — because a book waiting on somebody's
judgement is not converting, and putting it in the pipeline's state
machine would both mislabel it and block phase 2 behind a decision that
may never be made. `apply` finishing is an ordinary master edit: the
book returns to `master_ready` and the reading edition is rebuilt from
the corrected text by the path any corrected master takes.

Correction is two jobs rather than one because section 7 says it must
be. A single job that read a master and wrote a better one is precisely
the silent rewrite that is forbidden; the human decision is what goes
between them, and `correct` deliberately finishes in `human_review`
rather than `completed` to say so.

There was a third, `cover`, from 2026-08-23 until 2026-08-25. It is
gone and the endpoint now refuses one: covers are rendered in the
browser (section 5), and a `cover` completion read as `formats` would
publish or fail a whole book over a picture.

A `formats` job also carries a **`formats` list** saying which editions
to build. Absent means "all of them", which is what the CLI and the job
API want; the web application always says explicitly, because what a
book needs depends on what it already has and what a reader asked for,
and only that side knows either. An empty list is a real instruction and
is not read as "all".

A `master` job now carries only `source_key`, and only for a source that
needed no export — a DOCX or a plain text upload. A PDF never reaches
one: Adobe returns the master already built, so the web application
attaches it and the book goes straight to `master_ready`.

`ocr_key` was a JSON document in R2 (`books/{id}/ocr/pages.json`) that
crossed this boundary until 2026-08-19, carrying pages as paragraphs
with a `role` decided from the type size and position Document AI
reported. Nothing writes it now. The converter still reads one if given
it — `app/sources/ocr_json.py`, reachable from the CLI — because the
files already in R2 were paid for once and deleting the reader would
make them unusable.

The completion `POST` carries the same `kind`, and phase 1 finishing
does **not** publish a book: a DOCX master is not a readable edition.

Phase 2 is claimable on its own, which is what makes a corrected master
cheap to act on.

Both job kinds are built on the converter side (`app/jobs/runner.py`,
claimed by `app/handoff/poller.py`), and heading levels survive the
master round trip — `Heading 1` and `Heading 2` map to CHAPTER and
SECTION in `app/sources/docx_in.py`, whichever wrote them. That is what
makes a corrected master come back as the same book, and it is also why
Adobe's output needed no new reader: it speaks Word's own heading styles,
which the round trip already had to understand. The EPUB's table of
contents nests sections under their chapter accordingly.

Not yet built: where the converter container runs, which is still
deliberately open.

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
    cover.jpg          page one, when nobody uploaded a cover
    cover-2.jpg        the other candidates, when it is not the cover
    cover-3.jpg        (all three written by the browser that rendered
                        them, through POST /covers/{id})
    book/
      master.docx
      book.epub
      book.pdf
      original.pdf     a PDF upload, kept as uploaded
      source.txt       a text upload, kept as uploaded

conversion/
  {job_id}/
    input/
    intermediate/
    output/

covers/
