# NobleRead — Roadmap

The MVP (see `docs/ARCHITECTURE_REVIEW.md`) delivers one working vertical
slice: browse a book catalog, open a book, download a part in a chosen
format, under rights and per-user rate-limit gates. Everything below is
deliberately deferred — named here so the MVP's scope stays legible as a
foundation rather than reading as an oversight.

## Content production

- **OCR + AI conversion pipeline** — standalone `services/converter`
  (FastAPI, async job API per `CLAUDE.md` section 13), PaddleOCR for
  Chinese/English/mixed scans, the self-hosted vLLM/Gemma endpoint for
  OCR-correction assistance (never silent rewriting — original + AI
  suggestion + human approval, per `CLAUDE.md` section 7), Celery/Redis
  for the job queue, DOCX generation (python-docx/LibreOffice/Pandoc,
  evaluate before committing), EPUB 3 generation and validation, and the
  standalone public conversion portal.
- **Part-level rights overrides** — currently rights status lives only on
  the Book; a Part inheriting a different status isn't supported yet.
- **Staged release: paid early unlock** — the time-delay half is built
  (see `ARCHITECTURE_REVIEW.md` section 7); the "pay a small amount to
  open the next part early" half still needs WooCommerce, and should stay
  a seriousness gate rather than a revenue mechanism per `CLAUDE.md`.

## Monetization (secondary to the reading mission — see CLAUDE.md's
## Business Model section; no dark patterns)

- **WooCommerce + Stripe** — paid early unlocks and donations.
- **E-reader affiliate/resale link** — discounted, dedicated product link.

## Reader experience

- **In-browser reflowable EPUB reading** (e.g. epub.js) — MVP ships PDF
  inline-view + EPUB download only; a real in-app reader is a distinct
  future feature.
- **Send-to-Kindle** — SMTP-based delivery service.
- **Dark/light reading modes, adjustable in-page settings** beyond the
  three fixed PDF variants.

## Platform

- **Per-user blogs** — each user's own blog (WP Multisite or BuddyPress).
- **Automated X anti-explicit-content worker** — secondary to the core
  mission per `CLAUDE.md`'s Core Mission section; posts an anti-yellow
  reply to X threads containing explicit content. Standalone service, not
  a WordPress plugin.

## Infrastructure

- **S3/MinIO storage swap** — replace local WP uploads once a real
  consumer exists (the conversion service, a CDN, multi-instance web
  tier). `includes/downloads.php` already streams files rather than
  redirecting to a public URL, so this swap shouldn't change the public
  download contract.
- **Redis** — needed once the conversion service's job queue exists; not
  useful to the MVP's simple indexed-SQL rate limiter.
- **Kubernetes manifests** — Docker Compose is the MVP deployment target;
  move to k8s/EKS once there's more than one service to orchestrate.
- **Admin/UX polish** — custom login/registration screens, hardened
  default WP settings, revisit ACF if native meta-box UX outgrows what's
  reasonable to hand-roll.
