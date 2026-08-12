# NobleSee — Modernization Assessment

Required output per `docs/MODERNIZATION.md` section 45, produced after
the section 41 repository inspection and before any substantial
implementation.

**Headline finding: this is roughly 30% migration and 70% greenfield.**
The spec reads as though it is replacing an existing system. Sections
19–30 of it — OCR, AI architecture, vLLM integration, MCP,
human-in-the-loop review, evaluation, workflows, Temporal, events,
observability, metrics — describe subsystems with **zero existing code**.
What actually exists is a working WordPress reading/download site. That
changes the shape of the plan: most of the effort is building new
things, not migrating old ones, and the "incremental migration" strategy
in section 42 only applies to the minority of the system that exists.

---

## 1. Repository Assessment

### 1.1 Current architecture (as built, not as documented)

```
noblesee.com ──> Cloudflare (DNS+TLS, live) ──> Tunnel ──X BLOCKED (port 7844)
                                                          │
                                          ┌───────────────┴──────────────┐
                                          │  docker compose (one host)   │
   WordPress 6.x (php8.3-apache) :8090 ───┤  server-rendered PHP, no API │
     └─ Kadence theme (presentation)      │                              │
     └─ noblesee-core plugin (2,431 LOC)  │                              │
   MySQL 8 (no host port)                 │                              │
   wp-cli provision (one-shot, idempotent)│                              │
   Adminer :8091 (dev only)               │                              │
   Django 5.1 + PostgreSQL 17 :8092 ──────┤  added today, scaffolding    │
                                          └──────────────────────────────┘
   Cloudflare R2 ← book artifacts mirrored on save
```

### 1.2 Current technologies

| Layer | Technology | State |
|---|---|---|
| CMS/site | WordPress 6.x + Kadence | Working, serves everything |
| Domain logic | `noblesee-core` plugin, 2,431 LOC PHP | Working, 23 smoke assertions green |
| Database | MySQL 8 | Working |
| Object storage | Cloudflare R2 via `aws/aws-sdk-php` | Working, mirrored on save |
| Auth | WP accounts + custom `/sign-up/` + Google OAuth (`league/oauth2-client`) | Working |
| Reader | Custom JS + EPUB.js + JSZip (vendored) | Working |
| Edge | Cloudflare Tunnel, DNS live | **Blocked** — origin cannot egress on 7844 |
| Backend (new) | Django 5.1 + PostgreSQL 17 | Scaffolding only, added today |
| Conversion | — | **Does not exist** |
| Observability | — | **Does not exist** |
| CI/CD, IaC | — | **Does not exist** |

### 1.3 Legacy technologies (to be removed)

WordPress, Kadence, MySQL, PHP, `noblesee-core`, wp-cli provisioning,
Adminer. Also the Django service added today (see 1.6).

### 1.4 Reusable components

| Asset | Reuse |
|---|---|
| **23 smoke-test assertions** (`tools/smoke-test.sh`) | **Highest-value asset.** The only executable specification of current behaviour. Port to Playwright as the parity harness *first*. |
| Business rules (rate limiter, staged release, rights gate, download authorization) | Rules reusable; PHP discarded. ~500 LOC of genuine domain logic. |
| Reader JS + EPUB.js | Carries into the React reader with modest rework |
| R2 bucket layout (`books/{book_id}/parts/{part_id}/...`) | Matches spec §12 almost exactly — keep |
| Seed content + `tools/generate-seed-content.py` | Reuse directly as fixtures |
| **`tmp/南怀瑾著作诗词辑录…pdf` (3.3 MB scanned Chinese book)** | Real OCR corpus. First genuine pipeline test case; already gitignored |
| Rights vocabulary (6 states) | Identical in old and new specs — carry verbatim |
| Cloudflare zone, tunnel, DNS | Reusable as-is |
| Docker Compose topology | Pattern reusable |

### 1.5 Key structural findings

**There is no API.** WordPress serves server-rendered PHP via rewrite
routes (`/noblesee-download/{part}/{format}/`, `/noblesee-read/{part}/`,
`/sign-up/`, `/auth/google/*`). `register_rest_route` appears nowhere.
So the Next.js frontend has no backend contract to migrate onto — the
API must be designed from scratch, and no existing consumer constrains
it. That is freedom, but it also means "migrate the frontend" (§42) is
really "build a frontend against an API that does not yet exist".

**The data model is WordPress-shaped and must be normalised.** Books and
Parts are custom post types with meta rows (`nr_part_book_id`,
`nr_part_order`, `nr_rights_status`, five `*_attachment_id` keys). The
one properly relational object is `wp_nr_downloads` (`user_id`,
`part_id`, `book_id`, `format`, `created_at`, two composite indexes) —
which maps to PostgreSQL unchanged.

**Payload 3 is Next-native.** It runs *inside* the Next.js application
rather than beside it. This directly shapes §3 and §7: the boundary
between "Payload's model" and "NobleSee's domain" is a discipline to
enforce in code layout, not something the deployment topology gives you
for free.

### 1.6 Conflicts with the target architecture (§44)

| Conflict | Recommendation |
|---|---|
| `services/web` — Django 5.1, added today | **Remove, do not migrate.** ~2 hours old, health endpoint + 2 tests, zero domain logic. Nothing to preserve; keeping it would leave two contradictory backends. Documented here rather than silently deleted, per §43. |
| `webdb` runs PostgreSQL **17**; spec requires **18** | Recreate on `postgres:18` (verified available). No data to migrate. |
| `CLAUDE.md` §2.1 mandates **Django + Astro** | Rewrite to Next.js + Payload. It was rewritten earlier today to Django/Astro and is now wrong. |
| `ARCHITECTURE_REVIEW.md` §11 recommends Django + Astro | Add a second reversal note; keep the coupling analysis, which still holds. |
| Spec §14 requires **Next.js**; `CLAUDE.md` FRONTEND section says **Astro** | Next.js wins — Payload 3 requires it regardless. |
| MySQL | Stays until WordPress is decommissioned; no new functionality on it (§43). |

### 1.7 Missing requirements / spec gaps

These need decisions and are not answered by `MODERNIZATION.md`:

1. ~~**Who owns user accounts?**~~ **DECIDED: Payload owns identity**
   (auth, sessions, password reset); the domain keys off `user_id` alone
   and never imports a Payload user object, so identity can move out
   later without touching business logic. Implemented in
   `apps/web/src/collections/Users.ts`.
2. ~~**S3/CloudFront vs the existing R2.**~~ **DECIDED: Cloudflare R2,
   and Cloudflare over AWS generally.** The S3 client abstraction is
   kept, so only endpoint, region (`auto`) and credentials differ and
   AWS remains a swap rather than a rewrite. CloudFront, ECS and RDS
   drop out of the target architecture in favour of Cloudflare's CDN,
   the existing tunnel, and a managed Postgres. Implemented in
   `apps/web/src/payload.config.ts`.
3. **Chinese full-text search.** §35 says "use PostgreSQL search
   capabilities where sufficient". Postgres does not segment Chinese
   text out of the box — this needs `pg_jieba`/`zhparser`, or trigram
   matching. A real constraint on the mission's primary language.
4. **Hosting is unresolved (NR-28).** Port 7844 egress is blocked here,
   so nothing is publicly reachable regardless of stack. §36 suggests
   AWS ECS. Does not block phases 1–6.
5. **Site UI internationalisation** is not mentioned anywhere, for a
   platform whose readers are largely Chinese-speaking.
6. **PDF page-image retention.** §9 makes the structured model canonical
   but does not say whether source scans are retained per page for
   provenance. Recommend yes — cheap now, impossible retroactively.

---

## 2. Target Architecture

```
                              noblesee.com
                                   │
                    Cloudflare (DNS, TLS, CDN, WAF)
                                   │
              ┌────────────────────┴────────────────────┐
              │                                         │
              ▼                                         ▼
  ┌───────────────────────────┐              Signed artifact URLs
  │  Next.js (App Router)     │                          │
  │  React + TypeScript       │                          ▼
  │  ├── public site / SEO    │              ┌────────────────────────┐
  │  ├── catalog, book pages  │              │  Cloudflare R2 (S3 API)│
  │  ├── NobleSee Reader      │              │  books/{id}/parts/...  │
  │  │   (EPUB.js, EPUB 3)    │              │  conversion/{job}/...  │
  │  └── Payload CMS (admin)  │              └────────────────────────┘
  └───────────┬───────────────┘
              │  domain layer (framework-independent TypeScript)
              │  rights · access · limits · staged release · unlocks
              ▼
  ┌───────────────────────────┐
  │  PostgreSQL 18            │  domain tables + Payload collections
  └───────────┬───────────────┘
              │  job submission / status (HTTP)
              ▼
  ┌───────────────────────────────────────────────────────────┐
  │  FastAPI — conversion service (Python)                    │
  │  WorkflowRunner abstraction (simple worker → Temporal)    │
  │   ├── OCRProvider ──── PaddleOCR │ Tesseract │ future     │
  │   ├── AI capabilities ── correct_ocr() detect_structure() │
  │   │                     extract_metadata() …             │
  │   │        └── ModelProvider ── vLLM │ OpenAI-compatible  │
  │   ├── Structured Book Model  ◀── canonical source of truth│
  │   └── Renderers ── DOCX (python-docx) │ EPUB 3 │ PDF      │
  │                                         (Playwright)      │
  └───────────┬───────────────────────────────────────────────┘
              │  OpenTelemetry (traces, metrics, logs)
              ▼
     VictoriaMetrics / VictoriaLogs / VictoriaTraces ──> Grafana
```

Human-in-the-loop review sits between AI processing and the approved
Book Model, with a full audit trail (original, suggestion, confidence,
reason, model, prompt version, reviewer, decision).

---

## 3. Technology Decision Matrix

| Decision | Options | Choice | Rationale grounded in NobleSee |
|---|---|---|---|
| CMS | **Payload** / WordPress / Directus | **Payload** | TypeScript end-to-end with the frontend; code-defined collections are reviewable in git, unlike WP's DB-resident config. WordPress is what we are leaving — its plugin CVE surface and MySQL requirement are the reasons. Directus is DB-first and admin-oriented, weaker for the editorial workflows §23 needs. Cost: Payload 3 couples us to Next.js. |
| Database | **PostgreSQL 18** / MySQL / MariaDB | **PostgreSQL 18** | Mandated (§6) and independently right: JSONB for the structured Book Model, strong FTS foundation, generated columns, mature partitioning for the downloads ledger. MySQL is excluded for new work by §43. |
| Workflow | **Temporal** / Celery / simple worker | **Abstraction now, simple worker first, Temporal when earned** | No Celery exists, so there is nothing to migrate — the abstraction is free to design correctly. Conversion runs are long, resumable, human-gated; that is Temporal's exact shape. But Temporal is a server + workers + UI, heavy for a corpus of two seed books. §26 explicitly permits deferral. |
| Messaging | NATS JetStream / Redis / **none yet** | **None yet; Postgres-backed job table** | §27 warns against event infrastructure for its own sake. One producer, one consumer, and Postgres `LISTEN/NOTIFY` covers it. Adopt NATS JetStream when durable fan-out is genuinely needed. |
| Metrics | **VictoriaMetrics** / Prometheus | **VictoriaMetrics** | Mandated (§28/§29). Independently defensible: far lower memory at equal cardinality, Prometheus-compatible query surface, VictoriaLogs/Traces complete the stack. OpenTelemetry keeps app code backend-agnostic. |
| PDF | **Playwright/Chromium** / WeasyPrint | **Playwright first** | Chinese typography, vertical text and complex layout render far better in Chromium. WeasyPrint is lighter but weaker on CJK and web fonts. §17 already names Playwright first; keep the renderer behind an interface. |
| OCR | **PaddleOCR** / Tesseract / cloud APIs | **PaddleOCR behind `OCRProvider`** | Substantially better on traditional Chinese and historical scans; Tesseract stays a fallback for Latin text. Cloud OCR is rejected on cost, and because private user uploads (§32) must not leave our infrastructure. |
| IaC | OpenTofu / Terraform | **OpenTofu** | Genuinely open-source licence, drop-in compatible. Deferred until NR-28 settles hosting — nothing to codify yet. |
| CI | **GitHub Actions** | **GitHub Actions** | Repo is already on GitHub; no self-hosted runner burden at this scale. |

---

## 4. Migration Plan

Incremental per §42. WordPress keeps serving until Phase 6.

**Phase 0 — Decisions and cleanup**
Resolve §1.7 gaps 1–3. Remove `services/web`; recreate `webdb` on
PostgreSQL 18. Rewrite `CLAUDE.md` §2.1 and the FRONTEND section; add
the reversal note to `ARCHITECTURE_REVIEW.md` §11.

**Phase 1 — Parity harness**
Port the 23 smoke assertions to Playwright, running against WordPress
today. This is the definition of done for the backend and must exist
before the code it judges.

**Phase 2 — Foundations**
Next.js + TypeScript + Payload 3 + PostgreSQL 18 in compose. Domain
layer scaffolded as a framework-independent module (§3, §7).
OpenTelemetry from the first commit — retrofitting instrumentation is
how it never happens.

**Phase 3 — Domain model**
Books, Parts, Editions, Rights, Collections; the Structured Book Model
as JSONB with a versioned schema. Payload collections for editorial
content. Import seed content as fixtures.

**Phase 4 — Accounts and access**
Payload auth, Google OAuth, custom login. Then the domain rules:
rolling-window limiter, staged release, rights gate, signed-URL
downloads. Parity harness must pass here.

**Phase 5 — Storage and downloads**
R2 via the S3 API, signed short-lived URLs, CDN in front. Never expose
unrestricted objects (§13, §31).

**Phase 6 — Frontend and reader**
Catalog, book pages, blog, account pages. The React/EPUB.js reader with
typography, themes, and reading position. Cut the tunnel over. Retire
WordPress, Kadence, MySQL, `noblesee-core`.

**Phase 7 — Conversion pipeline (greenfield)**
FastAPI service, `WorkflowRunner` abstraction, `OCRProvider` with
PaddleOCR, AI capability layer over a `ModelProvider`, human-in-the-loop
review with audit trail, DOCX/EPUB/PDF renderers with validation. First
real target: the 南怀瑾 scan already in `tmp/`.

**Phase 8 — Observability, commerce, search, IaC**
VictoriaMetrics/Logs/Traces + Grafana. Stripe for donations then
unlocks. Postgres FTS with Chinese segmentation. OpenTofu once hosting
is settled.

---

## 5. Risk Register

| # | Risk | Type | Severity | Mitigation |
|---|---|---|---|---|
| 1 | Scope reality: 70% of the target is greenfield, not migration | Technical | **High** | Sequence parity work (1–6) before the pipeline (7). Do not start both. |
| 2 | Payload 3's Next coupling leaks into domain logic | Vendor lock-in | **High** | Domain layer as a separate module with no Payload imports; Payload hooks call into it, never the reverse. Enforce with a lint boundary rule. |
| 3 | Rebuild stalls half-done, two systems in production | Operational | **High** | Parity harness gates each phase; a phase 2× over estimate is the stop signal. |
| 4 | AI silently alters historical text | AI accuracy | **High** | Never auto-apply. Persist original+suggestion+confidence+reason+model+prompt version; human accept/reject/edit/defer (§23). Regression + hallucination tests. |
| 5 | Redistributing material we lack rights to | Copyright | **High** | Rights status required before publication; server-side enforcement; private uploads never enter public catalog/search/API (§32). Default `unknown` denies. |
| 6 | Protected artifacts publicly reachable | Security | **High** | No public buckets. Short-lived signed URLs issued only after authorization. Include an assertion in the parity harness. |
| 7 | Chinese FTS insufficient in stock Postgres | Technical | Medium | Prototype `pg_jieba`/`zhparser` in Phase 8 before committing; OpenSearch remains the escape hatch. |
| 8 | Deployment blocked by port 7844 egress (NR-28) | Operational | Medium | Independent of the rebuild; resolve hosting in parallel. A cheap VPS unblocks it. |
| 9 | No data-migration risk | Data | **Low** | No users, no production data. Seed content regenerates from source. This is why now is the right time. |
| 10 | OCR quality on historical scans below usable threshold | Technical | Medium | Validate against the real 南怀瑾 scan early in Phase 7, before building the review UI around assumptions. |
| 11 | Self-hosted vLLM is a single point of failure | Operational | Medium | `ModelProvider` abstraction; endpoint and model from config, never hard-coded (§21). |
| 12 | Observability retrofitted rather than built in | Operational | Medium | OpenTelemetry from Phase 2's first commit. |
| 13 | Payload owning identity blocks later domain ownership | Vendor lock-in | Medium | Domain tables key on `user_id` only; no Payload user object in business logic. |

---

## Recommendation

Proceed with Phase 0, and treat Phase 1 (parity harness) as the real
start of implementation. Per §45, no substantial code changes should
begin until the six open questions in §1.7 are answered — items 1
(account ownership) and 2 (R2 vs S3/CloudFront) block Phase 2 and Phase
5 respectively.
