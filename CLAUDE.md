# NobleRead — Architecture Review, Planning & Implementation Prompt

You are the lead software architect and implementation engineer for a new project called **NobleRead**.

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

# NOBLEREAD — CORE MISSION AND PRODUCT VISION

NobleRead is fundamentally a digital preservation and e-reader accessibility
project.

Many valuable older and traditional books, especially traditional Chinese
books, historical books, cultural classics, and other worthwhile literature,
are available online only as scanned PDFs or scanned page images.

These formats are often difficult to read comfortably on modern devices,
especially e-readers such as Kindle.

NobleRead's primary mission is therefore:

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

NobleRead should particularly focus on books that currently have poor
e-reader accessibility.

Examples:

- scanned historical books
- traditional Chinese classics
- cultural and philosophical works
- books about wisdom and personal development
- books related to health and moral development
- worthwhile books that are difficult to find in modern e-reader formats

The project also has a positive social mission.

NobleRead aims to encourage reading, wisdom, healthy living, moral
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

NobleRead is mission-first, but it needs sustainable revenue.

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
Optionally support NobleRead
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

NobleRead

Domain:

noblesee.com

Mission:

NobleRead is a website for hosting and sharing essential and noble books, especially traditional Chinese culture and history, that can bring wisdom, life change, and upliftment to readers.

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

## 2.1 WordPress is the main website platform

Use WordPress for:

- Public website
- User accounts
- Book catalog UI
- Blog functionality
- User profiles
- Administration
- Donations/payment integration
- Book browsing
- Book metadata
- Release/access UI

Do NOT turn WordPress into the entire backend system.

Create a custom WordPress plugin for NobleRead-specific business logic.

Suggested plugin:

nobleread-core

The theme should primarily handle presentation.

---

# 3. HIGH-LEVEL ARCHITECTURE

Target architecture:

                    noblesee.com
                           |
                    WordPress
                           |
                NobleRead Custom Plugin
                           |
        +------------------+------------------+
        |                  |                  |
        v                  v                  v
      MySQL              Redis                S3
        |                  |                  |
        |                  |            Book artifacts
        |                  |            DOCX/EPUB/PDF
        |                  |
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
        +------------ WooCommerce
                         |
                    Stripe/etc.

Separate services:

- NobleRead Converter
- NobleRead Conversion Worker
- NobleRead X Worker
- Future Kindle Delivery Service

Initial deployment:

Docker Compose

Future deployment:

Kubernetes / AWS EKS

Do not prematurely introduce Kubernetes-specific complexity into the MVP.

Simplified reference view of the same architecture:

┌─────────────────────────────────────────┐
│              NobleRead UI               │
│                                         │
│  Kadence + Gutenberg + Custom Blocks    │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│         NobleRead WordPress Plugin      │
│                                         │
│ Books / Parts / Access / Downloads      │
│ Unlocks / Kindle / Conversion API       │
└───────────────┬───────────────┬─────────┘
                │               │
             WooCommerce       S3
                │
              Stripe

                    ↓

          Python Conversion Services
                    ↓
             PaddleOCR + Gemma
                    ↓
                  vLLM

This view calls out PaddleOCR explicitly as the OCR engine feeding the
conversion services (see section 8, OCR, for the fuller evaluation) and
ties the WordPress theme choice (section WORDPRESS THEME) into the same
picture as the plugin and conversion backend.

---

# WORDPRESS THEME

The NobleRead website should use an established, lightweight WordPress
theme rather than creating a WordPress theme completely from scratch.

Evaluate these themes first:

1. Kadence
2. Blocksy
3. Astra

The initial recommendation is Kadence, but this must be validated against
the actual project requirements before implementation.

The theme must support:

- WordPress Gutenberg/block editor
- responsive/mobile-first design
- WooCommerce
- custom header/footer
- custom typography
- book/library layouts
- blog layouts
- archive/category layouts
- custom page templates
- accessibility
- performance optimization
- custom CSS
- child-theme or equivalent customization
- compatibility with the NobleRead custom plugin

IMPORTANT:

Do not use Elementor or another heavy page builder unless there is a
specific requirement that cannot reasonably be implemented with Gutenberg
and the selected theme.

Prefer:

WordPress Gutenberg
+
Kadence/Blocksy/Astra
+
custom NobleRead blocks/components
+
custom CSS

rather than:

WordPress
+
Elementor
+
many visual-builder plugins
+
large amounts of generated frontend markup.

The theme should provide the visual foundation, while NobleRead-specific
functionality should remain inside the NobleRead custom plugin.

Do not put business logic into the theme.

The following must remain plugin functionality:

- book management
- book parts
- release scheduling
- download authorization
- download rate limiting
- payment/unlock state
- conversion jobs
- Kindle delivery
- AI functionality
- API integrations
- X automation

The theme should only be responsible for presentation and UI.

Before implementation, compare Kadence, Blocksy and Astra and document
the decision in:

docs/ARCHITECTURE_REVIEW.md

Include:

- performance
- Gutenberg compatibility
- WooCommerce compatibility
- mobile support
- accessibility
- typography
- header/footer customization
- custom templates
- developer experience
- child theme/customization strategy
- long-term maintainability
- plugin compatibility

If Kadence is selected, use it as the foundation unless repository
constraints provide a compelling reason otherwise.

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
- WordPress should not directly depend on the vLLM endpoint.
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

1. Public NobleRead library content
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

AWS S3

Development:

MinIO is acceptable.

Staged rollout: for now, local on-disk storage (WordPress's native
uploads directory) is acceptable — this is what the MVP actually runs on
(see docs/ARCHITECTURE_REVIEW.md section 4). Migrate to S3-compatible
storage later, once a real consumer needs it (the conversion service, a
CDN, multi-instance web servers). The download path should stream files
rather than redirect to a public media URL, so this migration doesn't
change the public download contract (see
wordpress/plugins/nobleread-core/includes/downloads.php). Tracked in
docs/ROADMAP.md.

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
