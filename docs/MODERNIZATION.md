# NobleSee — Modernization Plan

The plan for rebuilding NobleSee on Django + PostgreSQL + Astro,
replacing the WordPress MVP.

**Status: in progress.** The NR-31 evaluation
(`docs/ARCHITECTURE_REVIEW.md` section 11) originally recommended
staying on WordPress. That was reversed once it was established that
there are no users and no data to preserve: the caution in the original
plan was almost entirely about *preserving* things — accounts, URLs,
a cutover, a performance baseline to hold — and none of it applies.

The argument that decided it: the expensive part of this migration is
the frontend rebuild, and that costs the same whenever it happens, while
every additional week of WordPress-specific work adds to what must be
thrown away. This is the cheapest the move will ever be.

**This is a greenfield rebuild, not a port.** The WordPress
implementation is a working reference for behaviour, not a shape to
reproduce. Only the ~500 lines of genuinely NobleSee-specific rules
carry over as logic.

## What carries over

| From the MVP | Fate |
|---|---|
| `services/converter` | Untouched — standalone and platform-agnostic by design |
| EPUB reader JS | Carries over nearly as-is |
| Rate limiter, staged release, rights gate, download delivery | Port the *rules*, rewrite the code |
| `storage.php` R2 abstraction | Reimplement on `boto3`; bucket layout unchanged |
| Seed content + DOCX masters | Reused directly — the source of truth |
| `tools/smoke-test.sh` | Reworked into the parity harness (23 assertions) |
| Post types, meta boxes, templates, auth, social login | Deleted; Django/allauth/Astro replace them |
| Kadence, WooCommerce plans | Dropped |

## Principles

- **Parity is proven, not asserted.** The smoke test's 23 assertions are
  the definition of done for the backend.
- **No new features until parity.** Feature work and platform work at
  the same time is how rebuilds stall. The one exception is fixing the
  two known gaps below, which are cheaper to do now than to reproduce.
- **Business logic is server-side, always.** The frontend must never be
  the only thing between a reader and a restricted file.
- **Calibre is a format-conversion step, never the library engine.** It
  does not do OCR (`ARCHITECTURE_REVIEW.md` 11.3), and it is GPL v3:
  shell out to the binaries, never import its Python modules.

Two known gaps to fix rather than carry forward: part-level rights
overrides, and a custom login screen (only sign-up was ever replaced).

---

## Phase 1 — Foundations *(done)*

- [x] `services/web`: Django project, its own PostgreSQL, in compose.
- [x] Do **not** share the existing `pg` container (it serves
      open-webui/chromadb — unrelated lifecycle).
- [x] Settings via environment variables, matching the existing `.env`
      conventions. No secrets in source.
- [x] Health endpoint, structured logging, `pytest` wired up.
- [x] Keep the WordPress stack in compose until Phase 6 lands, as a
      running behavioural reference. It stops being the site immediately.

## Phase 2 — Domain model and editorial UI

- [ ] Models: `Book`, `Part`, `Format`, `Collection`, `RightsStatus`.
- [ ] Rights vocabulary exactly as `CLAUDE.md` section 6:
      `public_domain`, `licensed`, `permission_granted`, `user_owned`,
      `restricted`, `unknown`.
- [ ] **Part-level rights overrides** (gap fix — a Part may be more
      restricted than its Book, never less).
- [ ] Django admin for the book/part/proofreading workflow.
- [ ] Import the existing seed content as a management command.

## Phase 3 — Accounts

- [ ] `django-allauth`: sign-up, login, password reset, sessions.
- [ ] Google provider, matching current `/sign-up/` behaviour.
- [ ] **Custom login screen** (gap fix).
- [ ] Apple Sign In slot left open (blocked on Apple Developer
      Program membership).
- [ ] No user migration — there are no users.

## Phase 4 — Business rules

The cheap phase. Rules port closely; code is rewritten.

- [ ] Rolling-window download limiter, counting distinct books not
      files (plain indexed SQL).
- [ ] Staged release: per-reader clock, opt-in per book.
- [ ] Rights + access gate; nonces become signed, expiring tokens.
- [ ] Download delivery **streams** — never redirects to a public media
      URL. This contract predates the rebuild and survives it.
- [ ] Port the smoke test first, so parity is measurable as it lands.

## Phase 5 — Storage

- [ ] R2/S3 via `boto3`; keep the `books/{book_id}/parts/{part_id}/...`
      layout from `CLAUDE.md` section 14.
- [ ] Fold covers and generic media into R2 too (the MVP deferred this).
- [ ] Local-filesystem fallback for development without R2 credentials,
      matching the existing behaviour.

## Phase 6 — Frontend

The bulk of the work.

- [ ] Astro app: catalog, book pages, static content.
- [ ] Reader page; EPUB reader JS carried over.
- [ ] Sign-up/login/account pages.
- [ ] Typography and reading comfort: font sizing, line spacing,
      dark/light modes, Chinese typography. This is the mission's
      actual point and the one place to exceed MVP parity.
- [ ] Lighthouse mobile pass before the tunnel points at it.

## Phase 7 — Payments

- [ ] Stripe directly (simpler than the never-built WooCommerce plan).
- [ ] Donations, then paid early unlocks.
- [ ] Seriousness gate, not a revenue mechanism — `CLAUDE.md` Business
      Model. No dark patterns.

## Phase 8 — Cutover and decommission

- [ ] Point the Cloudflare Tunnel ingress at Astro + Django.
- [ ] Run the ported smoke test against the deployed stack.
- [ ] Remove WordPress, Kadence, MySQL, `noblesee-core` from the repo
      and compose.
- [ ] Update `ARCHITECTURE_REVIEW.md` sections 2–9, which describe
      WordPress-specific decisions.

---

## Effort

| Phase | Estimate |
|---|---|
| 1 — Foundations | 2–3 days |
| 2 — Model and admin | 3–4 days |
| 3 — Accounts | 3–4 days |
| 4 — Business rules | 3–4 days |
| 5 — Storage | 1–2 days |
| 6 — Frontend | 1.5–2 weeks |
| 7 — Payments | 1 week |
| 8 — Cutover | 1–2 days |
| **Total** | **1.5–3 weeks** (excluding payments, which can follow) |

Phases 1–5 are roughly one to one-and-a-half weeks combined. Phase 6
dominates — which is why "the business logic is already isolated" was
never a good reason to feel relaxed about this rebuild.

## Risks

- **The rebuild stalls half-done**, leaving two systems. A phase
  dragging past its estimate by 2× is the warning sign.
- **The frontend rebuild expands into an open-ended redesign.** Parity
  first; typography is the one intentional exception.
- **Django admin covers less than WordPress's editorial affordances** —
  no media library, no revision history, no preview. Worth checking
  against the real proofreading workflow in Phase 2 rather than
  discovering it in Phase 6.
- **Hosting is unresolved (NR-28).** The current kiosk host cannot
  egress on port 7844, so nothing here is publicly reachable until that
  is settled. It does not block Phases 1–6.

## Open questions

- Whether the user-owned conversion portal (`CLAUDE.md` section 6) lands
  before or after this rebuild.
- Whether per-user blogs survive the move, or become a simpler
  author-pages model.
- Astro islands vs a small amount of vanilla JS for the reader chrome.
