# NobleSee — Roadmap

The platform was rebuilt on Next.js + Payload + PostgreSQL in August 2026
(NR-31; see `docs/MODERNIZATION_ASSESSMENT.md`). What exists today is the
site: a catalog, book pages, and the three domain rules — rights, download
limits, staged release — implemented and unit-tested in a
framework-independent layer.

Everything below is deliberately deferred, named here so the current scope
stays legible as a foundation rather than reading as an oversight.

## Built

- **Rights model** — six statuses, failing closed on `unknown`; part-level
  overrides that may restrict but never relax the parent book (NR-9, NR-10).
- **Download limits** — distinct books in a rolling window, not files.
- **Staged release** — a per-reader clock, not a global publication date.
- **Site** — catalog with collection filtering, book pages, reading-first
  typography with Traditional Chinese first in the font stack, light/dark/auto.

## Reader experience

- **Authorized download route** — wires the three domain rules to short-lived
  signed R2 URLs. The book pages already link to it; it is the next thing to
  build, and the smoke test fails on it deliberately until it exists.
- **In-browser reflowable EPUB reading** (epub.js) — existed in the WordPress
  implementation, not yet rebuilt (NR-16).
- **In-reader typography controls** — font size, line spacing, margins; depends
  on the reader existing (NR-18).
- **Reader accounts** — sign-up, log-in and account pages against Payload auth,
  front-of-site rather than through the admin. Google sign-in (NR-30) and Apple
  Sign In (NR-25) hang off this; the Google OAuth client itself carries over
  unchanged.
- **Send-to-Kindle** — SMTP-based delivery service (NR-17).

## Content production

- **OCR + AI conversion pipeline** — standalone `services/converter` (FastAPI,
  async job API per `CLAUDE.md` section 13), PaddleOCR for Chinese/English/mixed
  scans, the self-hosted vLLM/Gemma endpoint for OCR-correction assistance
  (never silent rewriting — original + AI suggestion + human approval, per
  `CLAUDE.md` section 7), Celery/Redis for the job queue, DOCX generation
  (python-docx/LibreOffice/Pandoc, evaluate before committing), EPUB 3
  generation and validation, and the public conversion portal (NR-1 … NR-8).

  Unaffected by the platform rebuild: this was always a standalone service
  talking HTTP, deliberately knowing nothing about the frontend.

  Until it exists, `tools/generate-seed-content.py` stands in for it, writing
  reproducible artifacts into `content/seed/`.

## Monetization

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

## Platform

- **Per-user blogs** (NR-20) — re-scoped by the rebuild. This was nearly free
  on WordPress; on the new stack it is a Payload collection plus author-scoped
  access rules, routes and moderation. Re-estimate before scheduling.
- **Automated X anti-explicit-content worker** (NR-21) — secondary to the core
  mission per `CLAUDE.md`'s Core Mission section. Standalone service.
- **Chinese full-text search** — Postgres needs `pg_jieba` or `zhparser` to
  segment Chinese text; the default configuration will not tokenise it usefully.

## Infrastructure

- **Hosting target** (NR-28) and **public HTTPS** (NR-29) — blocked on the same
  thing: outbound TCP/UDP 7844 is filtered upstream of this host, so the
  Cloudflare Tunnel cannot connect and the site returns error 1033. The 443
  fallback is unusable — the tunnel edge IPs serve an expired non-tunnel
  certificate there. Whichever host is chosen must permit that egress or make
  the tunnel unnecessary.
- **Tunnel ingress** — remotely managed, so the rule must be repointed to
  `http://app:3000` in the Zero Trust dashboard.
- **Redis** (NR-23) — needed once the conversion service's job queue exists.
- **Kubernetes manifests** (NR-24) — Compose is the current deployment target;
  move to k8s/EKS once there is more than one service to orchestrate.
- **Covers and editorial media in R2** — book artifacts already live there;
  Payload media uploads now route there too when credentials are set. Folding in
  a CDN is only worth it alongside a multi-instance web tier.
