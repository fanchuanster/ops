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
- dark/light reading modes where appropriate
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
- Book downloads
- AI-assisted book digitization and production
- EPUB/PDF and potentially other e-reader formats
- Staged/part-based book releases
- Paid early unlocks
- Donations
- Send-to-Kindle functionality
- Download abuse protection (per-user limit on number of books downloaded
  per period — not a network/bandwidth control)
- User blogs (each user has their own blog)
- E-reader product/affiliate sales
- Potential automated X/Twitter anti-explicit-content activity

---

# 2. IMPORTANT IMPLEMENTATION PRINCIPLES

## 2.1 Next.js + Payload is the main website platform

This section previously mandated WordPress, and briefly Django. The
current direction is set by `docs/MODERNIZATION.md` and assessed in
`docs/MODERNIZATION_ASSESSMENT.md`: with no users and no data to
preserve, the platform is being rebuilt greenfield.

Use **Next.js + React + TypeScript with Payload CMS on PostgreSQL 18**
for:

- User accounts and authentication
- Book/Part/Format domain model
- Administration and the editorial/proofreading workflow
- Rights status and access control
- Download authorization, rate limiting, staged release
- Donations/payment integration (Stripe)
- The JSON API consumed by the frontend

Payload runs *inside* the Next.js application rather than beside it, so
the admin, the API and the public site are one deployable.

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

- book management and book parts
- release scheduling
- download authorization and rate limiting
- payment/unlock state
- rights status enforcement
- conversion job orchestration
- Kindle delivery
- AI functionality and API integrations

Do NOT turn the web application into the conversion pipeline. That stays
a separate FastAPI service (`services/converter`).

---

# 3. HIGH-LEVEL ARCHITECTURE

Target architecture:

                    noblesee.com
                           |
                    Cloudflare (TLS, CDN)
                           |
                   Cloudflare Tunnel
                           |
        +------------------+------------------+
        |                                     |
        v                                     v
        Next.js + Payload application
        catalog, book pages, reader, blog,
        accounts, rights, limits, staged
        release, downloads, admin/editorial
        UI, JSON API
                           |
        +------------------+------------------+
                           |
        +------------------+------------------+
        |                  |                  |
        v                  v                  v
   PostgreSQL            Redis          Cloudflare R2
        |                  |                  |
        |                  |            Book artifacts
        |                  |            DOCX/EPUB/PDF
        |              Job queues
        |                  |
        |                  v
        |            Converter API
        |                  |
        |        +---------+---------+
        |        |         |         |
        |       OCR       LLM     Rendering
        |                  |
        |                 vLLM
        |                  |
        |           Gemma 4 31B
        |
        +------------ Stripe

Separate services:

- NobleSee Web (Next.js + Payload + PostgreSQL) — one deployable
  serving the public site, the API and the admin
- NobleSee Converter
- NobleSee Conversion Worker
- NobleSee X Worker
- Future Kindle Delivery Service

Initial deployment:

Docker Compose

Future deployment:

Kubernetes / AWS EKS

Do not prematurely introduce Kubernetes-specific complexity into the MVP.

PaddleOCR is the OCR engine feeding the conversion services (see section
8, OCR, for the fuller evaluation). The conversion service is
deliberately standalone and platform-agnostic — it talks to the web
application over HTTP and knows nothing about the frontend.

---

# FRONTEND

The NobleSee frontend is a Next.js (App Router) application in React
and TypeScript, with Payload embedded in the same application. It was
previously specified as WordPress + Kadence, then briefly Django +
Astro; see section 2.1 and `docs/MODERNIZATION.md` section 14.

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
- dark/light reading modes
- an excellent reflowable reading experience

Do NOT put business logic in the frontend. Rights checks, download
authorization, rate limiting and staged release are enforced server-side
server-side; the frontend renders what the API permits and must never be
the only thing standing between a reader and a restricted file.

Prefer server components and static rendering, with client components
only where interaction genuinely requires them, rather than building the
whole site as a client-side SPA.

The in-browser EPUB reader is the one place where meaningful client-side
JavaScript is justified.

---

# 4. EXISTING AI INFRASTRUCTURE

A self-hosted vLLM endpoint already exists.

Completion endpoint:

http://10.211.51.231:8000/v1/chat/completions

Model:

google/gemma-4-31B-it-qat-w4a16-ct

Use OpenAI-compatible HTTP APIs when possible.

IMPORTANT:

- Do not expose this endpoint directly to public browsers.
- The web application should not directly depend on the vLLM endpoint.
- The conversion/AI service should communicate with vLLM.
- Make the LLM endpoint configurable through environment variables.
- Never hard-code the endpoint in application source code.

Example:

VLLM_BASE_URL=http://10.211.51.231:8000/v1
VLLM_MODEL=google/gemma-4-31B-it-qat-w4a16-ct

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

A book contains multiple Parts.

Example:

Book
|
+-- Part 1
|    +-- DOCX
|    +-- EPUB
|    +-- PDF Standard
|    +-- PDF Large
|    +-- PDF Extra Large
|
+-- Part 2
|    +-- DOCX
|    +-- EPUB
|    +-- PDF Standard
|    +-- PDF Large
|    +-- PDF Extra Large
|
+-- Part 3
     ...

The DOCX master is the source of truth.

Reader-facing formats must be generated from the approved DOCX master.

Do NOT use PDF as the canonical source.

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
Celery or equivalent queue
Redis
S3-compatible object storage

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

Cloudflare R2, over the S3 API. Chosen over AWS S3 because the domain,
DNS and tunnel already live on Cloudflare and R2 has no egress fees.
Because it is S3-compatible, moving to S3 later is a configuration
change rather than a rewrite.

Development:

Leaving the R2 credentials unset is acceptable — Payload falls back to
local disk, so the stack runs with no cloud account. MinIO is also
fine.

The download path must stream files or issue short-lived signed URLs,
never redirect to a public object URL: protected artifacts must not be
reachable without passing the server-side rights, limit and staged
release checks.

Suggested structure:

books/
  {book_id}/
    source/
      master.docx
    parts/
      {part_id}/
        master.docx
        epub/
        pdf/
        metadata/

conversion/
  {job_id}/
    input/
    intermediate/
    output/

covers/
