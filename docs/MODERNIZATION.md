# NobleSee — Modernization Plan

The staged plan for moving NobleSee off WordPress onto a purpose-built
stack, kept as an actionable checklist rather than prose.

**Status: planned, not started.** `docs/ARCHITECTURE_REVIEW.md` section
11 (NR-31) recommends staying on WordPress for the current phase,
because a migration is a parity exercise that delivers no new reader
value while the real bottleneck is the content production pipeline. This
document exists so that when a trigger in section 11.5 fires, the work
is already sequenced and nobody re-derives it under pressure.

Nothing here should be started before the decision gate in Phase 0
passes.

---

## Target architecture

```
                      noblesee.com
                           │
                  Cloudflare (TLS, CDN)
                           │
                   Cloudflare Tunnel
                           │
        ┌──────────────────┴──────────────────┐
        │                                     │
   Astro frontend                      Django + PostgreSQL
   (catalog, book pages,               (accounts, rights, limits,
    static, cached)                     staged release, downloads,
        │                               admin/editorial UI)
        └──────────────┬──────────────────────┘
                       │
              services/converter (FastAPI)
                       │
        PaddleOCR → vLLM/Gemma → DOCX → EPUB/PDF
                       │
              Calibre (format conversion only)
```

Two things stay exactly as they are: `services/converter` is already a
standalone platform-agnostic service by design, and the EPUB reader is
already custom JavaScript.

## Principles

- **Strangler, not big bang.** WordPress keeps serving until each slice
  is proven; no flag day.
- **The DOCX masters are the source of truth.** Any data migration is
  recoverable by re-importing them, which makes cutover low-risk.
- **No new features during migration.** Parity only — feature work and
  platform work at the same time is how migrations stall.
- **Calibre is a format-conversion step, never the library engine.** It
  does not do OCR (see `ARCHITECTURE_REVIEW.md` 11.3), and it is GPL v3:
  shell out to the binaries as separate processes, never import its
  Python modules.

---

## Phase 0 — Decision gate and baseline

Nothing below starts until this phase completes.

- [ ] Confirm a section 11.5 trigger has actually fired, and record
      which one, with a date, in this file.
- [ ] Measure the current WordPress frontend: mobile Lighthouse, TTFB,
      catalog and book-page load on a cold cache. This has never been
      measured, and without it "modernization" has no success criterion.
- [ ] Write down the target numbers the new stack must beat.
- [ ] Resolve NR-28 (production hosting target). Everything downstream
      assumes a host that can egress on port 7844 for the tunnel — the
      current kiosk host cannot.
- [ ] Confirm the 3–6 week estimate still holds against the plugin's
      size at that time (`noblesee-core` was 2,431 lines at NR-31).

## Phase 1 — Foundations

- [ ] Stand up `services/web` (Django + PostgreSQL) in `docker-compose`
      alongside WordPress, not replacing it.
- [ ] Reuse the existing `pg` pattern but with its **own** database
      instance — do not share the container serving open-webui/chromadb.
- [ ] CI: linting, tests, and a migration check on every push.
- [ ] Decide the URL split for the strangler period (subdomain vs path
      prefix vs tunnel-level ingress routing).

## Phase 2 — Domain model and editorial UI

Replaces `post-types.php` (185 lines) + `meta-boxes.php` (255 lines).

- [ ] Models: `Book`, `Part`, `Format`, `Collection`, `RightsStatus`.
- [ ] Django admin for book/part editing, including the rights-status
      workflow.
- [ ] Port the rights-status vocabulary verbatim from `CLAUDE.md`
      section 6 — `public_domain`, `licensed`, `permission_granted`,
      `user_owned`, `restricted`, `unknown`.
- [ ] Part-level rights overrides (currently a `ROADMAP.md` gap — worth
      fixing here rather than porting the limitation forward).

## Phase 3 — Accounts

Replaces `auth.php` (178 lines) + `social-login.php` (214 lines).

- [ ] `django-allauth` for sign-up, login, password reset, sessions.
- [ ] Google provider, matching the current `/sign-up/` behaviour.
- [ ] Custom login screen — WordPress's `wp-login.php` is still in use
      today and does not carry over.
- [ ] Apple Sign In slot left open (still blocked on Apple Developer
      Program membership).
- [ ] User migration: export accounts, force a password reset cycle
      rather than attempting to carry WordPress password hashes.

## Phase 4 — Business rules

The cheap phase — these files are already nearly WordPress-free and port
close to 1:1.

- [ ] `rate-limit.php` → rolling-window limiter (plain indexed SQL,
      moves essentially unchanged).
- [ ] `staged-release.php` → per-reader release clock.
- [ ] `access.php` → rights + signed-URL gate (nonces become signed
      tokens).
- [ ] `downloads.php` → streamed delivery, preserving the contract that
      downloads stream rather than redirect to a public media URL.
- [ ] Port `tools/smoke-test.sh` to run against the new stack **before**
      the logic lands, so parity is provable rather than asserted.

## Phase 5 — Storage

- [ ] `storage.php` is already an S3/R2 abstraction — swap
      `aws/aws-sdk-php` for `boto3`; the bucket layout is unchanged.
- [ ] Fold generic media (covers, theme images) into R2 at the same
      time, which the MVP deliberately deferred.

## Phase 6 — Frontend

The largest unknown, and the bulk of the estimate. Kadence disappears.

- [ ] Astro for catalog, book pages, and static content.
- [ ] Reader page — the EPUB reader JS carries over as-is.
- [ ] Sign-up/login/account pages.
- [ ] Typography and reading comfort pass: font sizing, line spacing,
      dark/light modes, Chinese typography (the mission's actual point).
- [ ] Meet or beat the Phase 0 baseline numbers before cutover.

## Phase 7 — Payments

- [ ] Stripe directly, replacing the WooCommerce path that was never
      built. Simpler than the deferred WooCommerce plan, not harder.
- [ ] Donations, then paid early unlocks.
- [ ] Keep the seriousness-gate framing from `CLAUDE.md` — no dark
      patterns, monetization stays secondary.

## Phase 8 — Cutover

- [ ] One-off export/import script; the corpus is small.
- [ ] Re-import from DOCX masters as the verification step.
- [ ] Preserve public URLs, or add redirects — `/books/`, book slugs,
      and the download/reader routes.
- [ ] Point the Cloudflare Tunnel ingress at the new stack.
- [ ] Run the ported smoke test against production.
- [ ] Keep WordPress readable but offline for one release cycle.

## Phase 9 — Decommission

- [ ] Remove the WordPress service, Kadence, and MySQL from compose.
- [ ] Archive `noblesee-core` with a pointer to its replacement.
- [ ] Update `CLAUDE.md` section 2.1, which currently mandates
      WordPress, plus `ARCHITECTURE_REVIEW.md` sections 2–9.

---

## Effort

| Phase | Estimate |
|---|---|
| 0 — Gate and baseline | 2–3 days |
| 1 — Foundations | 3–4 days |
| 2 — Model and admin | 3–4 days |
| 3 — Accounts | 3–5 days |
| 4 — Business rules | 3–4 days |
| 5 — Storage | 1–2 days |
| 6 — Frontend | 2–3 weeks |
| 7 — Payments | 1 week |
| 8 — Cutover | 2–3 days |
| 9 — Decommission | 1–2 days |
| **Total** | **3–6 focused weeks** |

Phases 1–5 are roughly one week combined. Phase 6 dominates, which is
why "the business logic is already isolated" is a misleading reason to
feel safe about this migration.

## Risks

- **Migration stalls half-done**, leaving two systems to operate. The
  strangler approach mitigates this only if each phase ships; a phase
  that drags past two weeks is the warning sign.
- **Frontend rebuild expands into a redesign.** Parity first; the
  typography work in Phase 6 is the one intentional exception.
- **Account migration friction.** A forced password reset is honest but
  costs some readers; plan the messaging.
- **Losing WordPress's editorial affordances** — media library, revision
  history, preview. Django admin covers less than people expect.

## Open questions

- Astro vs Next.js — Astro is the current lean (content-first, less
  JavaScript shipped), but this is not yet decided.
- Whether the conversion portal for user-owned uploads (`CLAUDE.md`
  section 6) lands before or after this migration.
- Whether per-user blogs (`ROADMAP.md`) survive the move at all, or are
  dropped in favour of a simpler author-pages model.
