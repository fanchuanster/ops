# NobleSee — Architecture Modernization & Payload Migration Prompt

> **Status: historical prompt, partly superseded. Read this banner first.**
>
> This is the *specification* that drove the WordPress → Next.js + Payload
> rebuild in August 2026. The rebuild happened; the platform half of this
> document is done. It is kept, rather than deleted, for two reasons: the
> domain layer cites its section numbers in source comments
> (`src/domain/rights.ts`, `downloadLimit.ts`, `stagedRelease.ts`,
> `scripts/check-domain-boundary.sh`), and sections 19–35 are still the
> fullest statement of requirements for subsystems that are not built yet.
>
> **Superseded — do not implement as written:**
>
> | Section | Says | Actually |
> | --- | --- | --- |
> | 6 — Database | PostgreSQL 18 | **Cloudflare D1** (SQLite), via a Worker binding |
> | 12 — Object storage | Amazon S3, MinIO in dev | **Cloudflare R2**; a binding for the Worker, the S3 API only for the converter |
> | 13 — Downloads | short-lived signed URLs | **streamed through the Worker** — the R2 binding cannot presign |
> | 36 — Deployment | Docker Compose, then ECS | **`wrangler deploy`** to Workers; Terraform for infrastructure. Compose retired 2026-08-13 |
> | 26 — Temporal, 27 — events | Temporal workflows, an event bus | not built, and not planned at this scale. **Cloudflare Queues** is the web → converter handoff |
>
> The reasoning for each is in `docs/CLOUDFLARE_ARCHITECTURE.md`.
>
> **Still authoritative:** sections 3 and 7 (the framework-independent
> domain layer — enforced by a check in `npm run verify`, not merely
> documented), 8–11 (book model and rights), 15–18 (reader, EPUB, PDF,
> DOCX), 19–24 (OCR, AI architecture, vLLM, human-in-the-loop, evaluation)
> and 31–35.
>
> For what is built versus deferred, `docs/ROADMAP.md` is the current
> answer and this document is not.

You are the lead software architect and implementation engineer for **NobleSee**.

Your task is to thoroughly inspect the existing repository and then **modernize the architecture toward a state-of-the-art 2026 technology stack**, replacing the previous WordPress-centered architecture with a modern TypeScript/Next.js/Payload architecture.

Do not blindly rewrite the repository.

First understand what already exists, identify what can be preserved, identify obsolete or undesirable architectural decisions, and then implement the migration incrementally.

---

# 1. PRIMARY OBJECTIVE

NobleSee is a digital preservation and e-reader accessibility platform.

Its core mission is:

> Find valuable books that are difficult to access in e-reader-friendly form → digitize/OCR them → reconstruct and proofread them → produce high-quality EPUB/PDF/DOCX editions → provide an excellent reading experience.

The platform should especially support:

* traditional Chinese books
* historical books
* Chinese cultural classics
* philosophical/literary works
* books promoting wisdom and personal development
* books that are difficult to access in modern e-reader formats

The goal is **not merely to host PDFs**.

The goal is to make valuable books pleasant to read on:

* desktop
* mobile
* tablets
* EPUB-compatible e-readers

The platform should provide:

* online reading
* EPUB downloads
* PDF downloads
* DOCX where appropriate
* book metadata
* book/part management
* staged releases
* paid early unlocks
* donations
* e-reader product/referral support
* user accounts
* user blogs
* download protection
* AI-assisted digitization
* human review
* future Send-to-Kindle support

The anti-explicit-content/social-media initiative is secondary and must not define the primary architecture.

---

# 2. MAJOR ARCHITECTURE CHANGE

The previous architecture was:

```
WordPress
    |
Custom WordPress Plugin
    |
MySQL / Redis / S3
    |
Python Conversion Services
    |
PaddleOCR + Gemma/vLLM
```

This architecture is now being replaced.

## New architectural direction

Use:

```
Next.js
  +
React
  +
TypeScript
  +
Payload CMS
  +
PostgreSQL 18
  +
S3
  +
FastAPI
  +
Temporal-ready workflows
  +
vLLM / model abstraction
  +
MCP
  +
OpenTelemetry
  +
VictoriaMetrics ecosystem
```

The goal is to build a **modern AI-native digital publishing platform**, rather than a traditional CMS with a collection of plugins.

---

# 3. IMPORTANT ARCHITECTURAL PRINCIPLE

Do not treat NobleSee as a generic CMS.

NobleSee is fundamentally:

```
Digital Library
      +
Digital Publishing Platform
      +
Book Conversion Pipeline
      +
AI-assisted Editorial System
      +
E-reader Platform
```

Payload should provide CMS/admin/content-management capabilities.

The NobleSee application/domain model must remain independent from Payload-specific implementation details wherever practical.

Do not bury core business logic inside Payload hooks if it should belong to the domain/application layer.

---

# 4. TARGET TECHNOLOGY STACK

## Frontend

Use:

* Next.js
* React
* TypeScript
* modern CSS/Tailwind where appropriate
* EPUB.js or an equivalent mature EPUB rendering library for the reader

Do not introduce unnecessary frontend frameworks.

The public website and application UI should be modern, responsive, accessible, SEO-friendly, and mobile-first.

---

# 5. PAYLOAD CMS

Replace WordPress with **Payload CMS**.

Payload should provide:

* content management
* administrative UI
* user management where appropriate
* book metadata management
* blog/content management
* media management
* roles/permissions
* editorial administration
* API integration
* configurable collections
* admin workflows

Use PostgreSQL as the database.

Do not introduce WordPress.

Do not introduce Elementor.

Do not create a custom CMS.

Prefer Payload's native capabilities over reinventing CMS functionality.

However, do not force all NobleSee domain logic into Payload.

---

# 6. DATABASE

Use:

**PostgreSQL 18**

as the primary application database.

PostgreSQL should be the source of truth for NobleSee's structured application/domain data.

Potential domain entities include:

* users
* books
* authors
* translators
* publishers
* parts
* editions
* releases
* rights
* book metadata
* access policies
* downloads
* unlocks
* payments
* donations
* conversion jobs
* workflow state
* AI corrections
* review decisions
* publishing state

Use relational modeling appropriately.

Avoid introducing MongoDB or another NoSQL database without a concrete requirement.

Do not use MySQL for new NobleSee application functionality.

---

# 7. DATA OWNERSHIP

Do not make Payload's internal representation the conceptual source of truth for every domain.

Design the system so that the NobleSee domain model can eventually exist independently from Payload.

Payload is a CMS/application administration layer.

NobleSee owns the domain concepts.

Prefer clear domain/application boundaries.

---

# 8. BOOK DOMAIN MODEL

Create a proper book domain model.

A Book should support concepts such as:

* id
* title
* subtitle
* author
* translator
* language
* description
* cover
* copyright/licensing status
* publication metadata
* status
* created_at
* updated_at

A book can contain multiple Parts.

Example:

```
Book
  |
  +-- Part 1
  |     +-- source
  |     +-- DOCX
  |     +-- EPUB
  |     +-- PDF
  |
  +-- Part 2
  |     +-- source
  |     +-- DOCX
  |     +-- EPUB
  |     +-- PDF
  |
  +-- Part 3
        ...
```

Support future editions and versions.

---

# 9. IMPORTANT CHANGE: STRUCTURED BOOK MODEL

Do NOT make DOCX the fundamental internal source of truth.

Instead use:

```
Source Scan
    |
    v
OCR representation
    |
    v
Structured NobleSee Book Model
    |
    +------> DOCX
    |
    +------> EPUB
    |
    +------> PDF
```

The **approved structured Book Model** is the logical source of truth.

DOCX is the primary human-editable publishing artifact.

EPUB and PDF are generated publishing artifacts.

This prevents the entire system from becoming dependent on DOCX internals.

---

# 10. STRUCTURED BOOK MODEL

Design an internal representation capable of expressing:

* chapters
* sections
* paragraphs
* headings
* emphasis
* page references
* footnotes
* tables
* images
* captions
* metadata
* source page
* OCR confidence
* AI corrections
* editorial decisions
* language
* typography-related information

Example conceptual structure:

```
Book
  |
  +-- Parts
        |
        +-- Chapters
              |
              +-- Sections
                    |
                    +-- Blocks
                          |
                          +-- Paragraph
                          +-- Heading
                          +-- Image
                          +-- Table
                          +-- Footnote
```

The implementation does not have to exactly match this structure.

Choose a clean model appropriate for long-term publishing.

---

# 11. COPYRIGHT / RIGHTS MANAGEMENT

The system must explicitly represent rights status.

Possible states:

* public_domain
* licensed
* permission_granted
* user_owned
* restricted
* unknown

Do not assume uploaded books can legally be redistributed.

Distinguish clearly between:

1. Public NobleSee library content
2. User-owned/private conversion content

Private user uploads must never automatically become public.

Access and publication rules must be enforced server-side.

---

# 12. OBJECT STORAGE

Use:

**Amazon S3**

for book artifacts and large binary objects.

Do not make local filesystem storage the long-term architecture.

Development may use MinIO or another S3-compatible implementation if useful.

Suggested conceptual layout:

```
books/
  {book_id}/
    source/
    parts/
      {part_id}/
        master/
        epub/
        pdf/
        metadata/

conversion/
  {job_id}/
    input/
    intermediate/
    output/

covers/
```

Store metadata/state in PostgreSQL.

Store large artifacts in S3.

---

# 13. DOWNLOAD ARCHITECTURE

Do not route large book downloads through the application server unnecessarily.

Use:

```
User
  |
  v
Authorization
  |
  v
Short-lived signed URL
  |
  v
CloudFront
  |
  v
S3
```

The application must authorize the download before issuing access to the artifact.

Download limits should be **per-user/application policy limits**, not a replacement for CDN bandwidth controls.

Never expose unrestricted public S3 objects for protected content.

---

# 14. FRONTEND ARCHITECTURE

Use:

* Next.js
* React
* TypeScript

Use Next.js for:

* public website
* SEO
* book catalog
* book detail pages
* blog
* account pages
* application UI

Use React-based application components where rich interaction is needed.

Do not build the entire system as a client-side SPA unnecessarily.

Prefer server-side rendering/static rendering where appropriate.

---

# 15. NOBLESEE READER

The reading experience is a core product feature.

Do not simply render books as ordinary CMS pages.

Build a dedicated reader.

Preferred direction:

```
React
  +
TypeScript
  +
EPUB.js
  +
EPUB 3
```

The reader should eventually support:

* chapter navigation
* table of contents
* font-size adjustment
* margins
* line spacing
* light/dark themes
* typography preferences
* reading position
* bookmarks
* mobile reading
* responsive layout

Design the reader so additional e-reader capabilities can be added later.

---

# 16. EPUB

EPUB 3 should be the primary reflowable publishing format.

EPUB should support:

* reflowable text
* font-size adjustment
* margins
* line spacing
* themes
* navigation
* table of contents
* metadata

Validate generated EPUB files automatically.

Do not prioritize MOBI/AZW3 unless there is a concrete compatibility requirement.

---

# 17. PDF

PDF is the page-oriented publishing format.

Support configurable variants such as:

* Standard
* Large
* Extra Large

Prefer:

```
Structured Book Model
      |
      v
   HTML/CSS
      |
      v
   Chromium
      |
      v
     PDF
```

Use Playwright/Chromium as the first rendering candidate.

Evaluate WeasyPrint where it provides useful advantages.

Do not make PDF the source of truth.

---

# 18. DOCX

DOCX remains an important editable publishing artifact.

Evaluate and use mature tools where appropriate:

* python-docx
* LibreOffice
* Pandoc

Do not assume one tool should perform every document-processing operation.

DOCX generation should preserve where practical:

* headings
* paragraphs
* page breaks
* footnotes
* emphasis
* tables
* Chinese typography
* metadata

---

# 19. OCR

Use a provider abstraction.

Conceptually:

```
OCRProvider
    |
    +-- PaddleOCR
    +-- Tesseract
    +-- future provider
```

PaddleOCR should be the initial/default OCR implementation.

The OCR pipeline must support:

* Chinese
* English
* mixed Chinese/English
* scanned books
* layout
* headings
* paragraphs
* footnotes where feasible

Preserve OCR confidence and source-page information.

Do not make OCR implementation details leak throughout the application.

---

# 20. AI ARCHITECTURE

Do not tightly couple NobleSee to a single model.

Do not write application logic such as:

```
call_gemma()
```

Instead define semantic AI capabilities:

```
correct_ocr()
detect_structure()
extract_metadata()
identify_anomalies()
suggest_punctuation()
classify_content()
assist_editorial_review()
```

The underlying model must be configurable.

Potential providers include:

* self-hosted vLLM
* Gemma
* Qwen
* DeepSeek
* OpenAI-compatible providers
* Anthropic
* Gemini
* other future providers

The model should be replaceable without redesigning the application.

---

# 21. VLLM

An existing self-hosted vLLM endpoint exists.

Do not expose it directly to browsers.

The backend/AI service communicates with vLLM.

Use OpenAI-compatible APIs where practical.

Configuration must come from environment/configuration.

Never hard-code:

* model names
* IP addresses
* API keys
* endpoints

Example configuration concept:

```
VLLM_BASE_URL=
VLLM_MODEL=
```

---

# 22. MCP

Design the AI subsystem to support **Model Context Protocol (MCP)** where useful.

Potential tools may include:

* book lookup
* book metadata
* OCR retrieval
* page inspection
* correction proposal
* structured document manipulation
* validation
* publishing
* review status

Do not make MCP mandatory for deterministic internal operations.

Use normal application APIs where they are more appropriate.

MCP should provide a standardized interface for AI/tool interaction.

---

# 23. AI HUMAN-IN-THE-LOOP

AI must not silently rewrite historical/literary material.

The preferred model is:

```
Original
    +
AI suggestion
    +
Confidence
    +
Reason
    +
Model/version
    |
    v
Human approval
    |
    v
Approved change
```

Store an audit trail.

For example:

```
original_text
suggested_text
operation
confidence
reason
model
prompt/version
created_at
reviewer
decision
```

The system must allow:

* accept
* reject
* edit
* defer

AI should primarily assist with:

* OCR correction
* punctuation
* paragraph reconstruction
* heading detection
* structural normalization
* metadata extraction
* formatting suggestions

Do not use AI for uncontrolled literary rewriting.

---

# 24. AI EVALUATION

Create an architecture that allows systematic evaluation of models.

Track metrics such as:

* OCR correction accuracy
* structure detection accuracy
* metadata extraction accuracy
* hallucination/error rate
* human acceptance rate
* latency
* cost
* tokens
* failure rate

Models should be benchmarkable against the same NobleSee evaluation corpus.

Do not hard-code one model as permanently optimal.

---

# 25. WORKFLOW ARCHITECTURE

Book conversion is a long-running workflow, not merely a synchronous HTTP request.

Conceptual workflow:

```
BookSubmitted
    |
    v
OCR
    |
    v
Normalization
    |
    v
AI Processing
    |
    v
Human Review
    |
    v
Approved Book Model
    |
    +----> DOCX
    |
    +----> EPUB
    |
    +----> PDF
    |
    v
Validation
    |
    v
Publish
```

The workflow must support:

* retries
* failures
* cancellation
* resumption
* timeouts
* human approval
* long-running processing
* auditability

---

# 26. TEMPORAL

Evaluate **Temporal** as the long-term workflow engine.

Do not necessarily introduce Temporal immediately if it creates unnecessary MVP complexity.

Design a workflow abstraction so that the initial implementation can use a simpler worker system while remaining replaceable by Temporal.

If the existing repository already contains Celery:

* understand the current implementation
* preserve working behavior where appropriate
* document the migration path
* do not perform a blind rewrite

Potential long-term architecture:

```
FastAPI
   |
   v
Temporal
   |
   +-- OCR Worker
   +-- AI Worker
   +-- DOCX Worker
   +-- EPUB Worker
   +-- PDF Worker
   +-- Validation Worker
```

---

# 27. EVENT-DRIVEN ARCHITECTURE

Use domain events where they provide real architectural value.

Examples:

```
BookCreated
SourceUploaded
OCRCompleted
BookNormalized
AIReviewRequested
AIReviewCompleted
HumanReviewStarted
HumanReviewCompleted
MasterApproved
EPUBGenerated
PDFGenerated
BookPublished
BookDownloaded
```

Do not introduce Kafka merely for the sake of event-driven architecture.

Evaluate **NATS JetStream** if durable messaging/event streaming becomes necessary.

Prefer simplicity until scale requires more infrastructure.

---

# 28. OBSERVABILITY

Use:

**OpenTelemetry**

as the instrumentation standard.

Use the VictoriaMetrics ecosystem rather than making Prometheus the primary metrics backend.

Preferred direction:

```
Applications
    |
OpenTelemetry
    |
    +-- Metrics --> VictoriaMetrics
    |
    +-- Logs -----> VictoriaLogs
    |
    +-- Traces ---> VictoriaTraces
                          |
                          v
                       Grafana
```

Evaluate the current VictoriaMetrics ecosystem and use the appropriate components rather than introducing redundant observability systems.

Prometheus-compatible interfaces are acceptable where required.

Do not tightly couple application code to one telemetry backend.

---

# 29. METRICS

Use VictoriaMetrics as the primary metrics platform.

Potential metrics:

* HTTP latency
* request rate
* error rate
* conversion jobs
* OCR duration
* LLM latency
* tokens
* GPU utilization
* CPU utilization
* memory
* queue/workflow state
* EPUB validation failures
* PDF generation failures
* downloads
* reader usage

Use OpenTelemetry instrumentation where appropriate.

---

# 30. LOGGING

Use structured JSON logging.

Include:

* timestamp
* service
* environment
* request_id
* trace_id
* user/job identifiers where appropriate
* severity
* event
* error information

Do not log:

* passwords
* API keys
* access tokens
* sensitive private book content unnecessarily
* private user data unnecessarily

---

# 31. SECURITY

Security must be designed into the architecture.

Requirements include:

* secure authentication
* role-based authorization
* server-side access control
* signed artifact URLs
* protected S3 objects
* rate limiting
* download abuse protection
* CSRF protection where relevant
* secure cookies
* secrets management
* input validation
* upload validation
* malware scanning where appropriate
* audit logs
* least privilege

Never trust client-side access decisions.

---

# 32. PRIVATE USER CONVERSION

Private user uploads must remain private.

Architecture must distinguish:

```
Public Library
```

from:

```
Private Conversion Workspace
```

A user-uploaded private book must not become visible in:

* public search
* public catalog
* public downloads
* public APIs

unless explicitly published and legally permitted.

---

# 33. COMMERCE

Do not reproduce WooCommerce simply because WordPress is being removed.

Evaluate a modern architecture using:

* Stripe
* Stripe Checkout
* Stripe Billing where required
* custom NobleSee payment/access domain logic

Commerce should remain secondary to the reading mission.

Avoid building unnecessary payment infrastructure.

The system should support:

* donations
* paid unlocks
* optional purchases
* e-reader affiliate/referral links

Avoid dark patterns.

---

# 34. USER BLOGS

Payload should manage blog/content functionality.

Users may eventually have their own blogs.

Design permissions carefully.

Do not allow arbitrary users to gain administrative capabilities.

Support moderation and abuse controls.

---

# 35. SEARCH

Do not introduce OpenSearch prematurely.

Initially use PostgreSQL search capabilities where sufficient.

When the catalog/search requirements justify a dedicated search engine, evaluate:

**OpenSearch**

rather than introducing Elasticsearch merely by default.

Potential future capabilities:

* Chinese full-text search
* fuzzy search
* relevance ranking
* faceting
* author/title search
* metadata filtering

Search indexing should be event-driven and replaceable.

---

# 36. DEPLOYMENT

The application must remain:

* Docker-first
* OCI-compatible
* Kubernetes-ready

But do not make Kubernetes mandatory for the MVP.

Initial deployment may use:

* Docker Compose for local development
* AWS ECS or equivalent managed container platform for early production

Potential AWS production architecture:

```
CloudFront
   |
Next.js / application
   |
Payload
   |
RDS PostgreSQL
   |
S3
   |
workflow/conversion workers
   |
vLLM GPU infrastructure
```

EKS should be introduced only when the workload justifies Kubernetes.

Do not introduce Kubernetes-specific complexity into application code.

---

# 37. INFRASTRUCTURE AS CODE

Use Infrastructure as Code.

Evaluate:

* OpenTofu
* Terraform

Choose one and document the decision.

Infrastructure must be reproducible.

Avoid manually configured production infrastructure.

---

# 38. CI/CD

Use modern CI/CD.

Evaluate GitHub Actions if appropriate.

Pipeline should include:

```
lint
  |
type check
  |
unit tests
  |
integration tests
  |
security scanning
  |
container build
  |
artifact scan
  |
deployment
```

For book-generation components, include automated validation.

---

# 39. TESTING

Implement appropriate testing at multiple levels.

## Application

* unit tests
* integration tests
* API tests
* authorization tests

## Book processing

* OCR test corpus
* structured document tests
* DOCX validation
* EPUB validation
* PDF rendering tests

## AI

* deterministic fixtures
* evaluation datasets
* regression tests
* hallucination tests
* model comparison

## Frontend

* component tests
* reader tests
* accessibility tests
* end-to-end tests

Do not rely solely on manual testing.

---

# 40. DOCUMENTATION

Maintain excellent documentation.

At minimum:

```
docs/
  ARCHITECTURE.md
  ARCHITECTURE_DECISIONS.md
  DOMAIN_MODEL.md
  AI_ARCHITECTURE.md
  BOOK_PIPELINE.md
  SECURITY.md
  DEPLOYMENT.md
  OBSERVABILITY.md
  ROADMAP.md
```

Create Architecture Decision Records for major decisions.

Document:

* why Payload was selected
* why PostgreSQL was selected
* why WordPress was removed
* why VictoriaMetrics was selected
* why FastAPI was selected
* why Temporal is being considered
* why S3 is used
* why the structured Book Model is canonical
* why EPUB is primary
* why Kubernetes is deferred

---

# 41. REPOSITORY INSPECTION REQUIREMENT

Before changing anything:

1. Inspect the complete repository structure.
2. Identify the current applications/services.
3. Identify current WordPress usage.
4. Identify current plugins.
5. Identify current database schema.
6. Identify current APIs.
7. Identify current conversion pipeline.
8. Identify current Docker configuration.
9. Identify current infrastructure configuration.
10. Identify tests.
11. Identify documentation.
12. Identify functionality that must be preserved.

Do not assume the repository matches the architecture document.

The repository is the implementation reality.

---

# 42. MIGRATION STRATEGY

Do not perform a destructive rewrite.

Create a migration plan.

Prefer incremental migration:

```
Existing system
      |
      v
Introduce new architecture
      |
      v
Migrate domain/data
      |
      v
Migrate frontend
      |
      v
Migrate book pipeline
      |
      v
Remove legacy components
```

Preserve existing working functionality whenever possible.

If an existing feature cannot be migrated cleanly, document:

* current behavior
* dependency
* migration risk
* recommended replacement
* migration steps

---

# 43. WHAT NOT TO DO

Do not:

* blindly rewrite the repository
* introduce Kubernetes just because it is available
* introduce Kafka without a concrete requirement
* introduce multiple databases without justification
* introduce microservices everywhere
* hard-code model endpoints
* hard-code model names
* expose vLLM publicly
* put business logic into UI components
* make Payload the entire domain architecture
* make DOCX the internal data model
* use PDF as the source of truth
* use AI to silently rewrite historical content
* expose private user uploads
* make protected S3 objects public
* introduce Elementor
* introduce WordPress
* introduce MySQL for new NobleSee functionality
* introduce legacy MOBI/AZW3 support without a concrete need

---

# 44. REQUIRED ARCHITECTURE DECISION

After inspecting the repository, determine whether the current implementation can be migrated incrementally to:

```
Next.js
React
TypeScript
Payload
PostgreSQL 18
S3
FastAPI
vLLM
OpenTelemetry
VictoriaMetrics
```

with a Temporal-ready workflow abstraction.

If the repository contains an existing implementation that conflicts with this architecture, do not blindly delete it.

Explain the conflict and propose a migration path.

---

# 45. REQUIRED OUTPUT BEFORE IMPLEMENTATION

Before making major code changes, produce:

## 1. Repository Assessment

Document:

* current architecture
* current technologies
* legacy technologies
* reusable components
* migration risks
* missing requirements

## 2. Target Architecture

Create a clear architecture diagram.

## 3. Technology Decision Matrix

Compare relevant alternatives:

* Payload vs WordPress vs Directus
* PostgreSQL vs MySQL/MariaDB
* Temporal vs Celery
* NATS vs Redis-based messaging
* VictoriaMetrics vs Prometheus
* Playwright vs WeasyPrint
* PaddleOCR vs alternatives

The decision must be based on NobleSee's actual requirements.

## 4. Migration Plan

Provide incremental implementation phases.

## 5. Risk Register

Identify:

* technical risks
* security risks
* data migration risks
* copyright risks
* AI accuracy risks
* operational risks
* vendor lock-in risks

Only after this review should substantial implementation begin.

---

# 46. IMPLEMENTATION PRINCIPLE

The final architecture should be:

```
Modern
AI-native
Open-source friendly
Cloud-native
Observable
Secure
Maintainable
Replaceable
Production-oriented
Simple enough for the current scale
```

Do not optimize for architectural complexity.

Optimize for:

**long-term technical longevity + rapid product development + excellent reading experience.**

The final system should allow NobleSee to evolve from a small project into a large digital preservation and publishing platform without requiring a complete architectural rewrite.
