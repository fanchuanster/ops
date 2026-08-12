# NobleSee — Architecture Review (MVP)

This document records the architecture decisions made for the first
runnable slice of NobleSee, as required by `CLAUDE.md` ("Before
implementation, compare Kadence, Blocksy and Astra and document the
decision"). It covers the theme comparison plus the other load-bearing
decisions made while building the MVP.

## 1. Scope of this review

The MVP implements the core reader value loop end-to-end — browse a book
catalog, open a book, download a part in a chosen format, under a
per-user rights and rate-limit gate — as a genuinely runnable
`docker compose up` system. Everything else in `CLAUDE.md`'s full
architecture (OCR/AI pipeline, WooCommerce, Send-to-Kindle, blogs,
e-reader resale, X worker, S3/Kubernetes) is deferred; see
`docs/ROADMAP.md`.

## 2. Theme: Kadence vs Blocksy vs Astra

| Criterion | Kadence | Blocksy | Astra |
|---|---|---|---|
| Performance | Lightweight, no jQuery dependency in the free theme | Lightweight, comparable footprint | Lightweight core, but reaching feature parity below pulls in Astra Pro add-ons |
| Gutenberg compatibility | Built block-first; free Kadence Blocks plugin extends Gutenberg directly | Good, but leans on its own Customizer-driven "Blocksy Companion" more than raw Gutenberg | Good baseline Gutenberg support |
| WooCommerce compatibility | Deep free-tier WooCommerce styling (cart/checkout/product layouts) | Solid, comparable to Kadence | Core styling is free; deeper WooCommerce customization needs Astra Pro |
| Mobile support | Responsive by default, per-breakpoint controls in free tier | Responsive by default | Responsive by default |
| Accessibility | Actively maintained, WCAG-conscious markup | Actively maintained | Actively maintained |
| Typography | Full Google/system font control free | Full font control free | Font control free; finer spacing controls gated in Pro |
| Header/footer customization | Free-tier drag-and-drop header/footer builder, Gutenberg-based | Free-tier header/footer builder, Customizer-based | Header/footer builder is an Astra Pro feature |
| Custom page templates | Native template support, works cleanly with `template_include` overrides | Native template support | Native template support |
| Developer experience | Clean hooks/filters, well-documented, block-based extension model | Clean, Customizer-API-based extension model | Clean, widely documented (largest install base) |
| Child theme / customization strategy | Standard child-theme support; most customization achievable via Gutenberg + plugin CSS without a child theme at all | Standard child-theme support | Standard child-theme support |
| Long-term maintainability | Active development, frequent releases, large free feature set | Active development | Active development, but MVP-relevant features (header/footer, deep WooCommerce) sit behind Pro, meaning a future upgrade dependency |
| Plugin compatibility | No conflicts observed with WooCommerce, standard CPT/meta-box patterns | Same | Same |

**Decision: Kadence.** It is the only one of the three that gives free-tier,
Gutenberg-native header/footer building and full WooCommerce styling
depth — directly matching `CLAUDE.md`'s explicit mandate ("WordPress
Gutenberg + Kadence/Blocksy/Astra + custom NobleSee blocks... rather than
WordPress + Elementor + many visual-builder plugins"). Astra gates the
equivalent depth behind Astra Pro, which would either cost money or leave
gaps; Blocksy is comparable to Kadence but more Customizer-centric than
block-first, a slightly worse fit for a Gutenberg-first build. This
confirms `CLAUDE.md`'s own initial recommendation.

Kadence is installed at provision time from wordpress.org (`wp theme
install kadence`), not vendored in the repo — see `docs/ROADMAP.md` for
when a child theme becomes necessary (not yet, in the MVP).

## 3. Book/Part content model: two CPTs, not a repeater field

`nr_book` (public, archive at `/books/`) and `nr_part` (non-public, no
independent permalink yet) are related via the native `post_parent`
column, not a meta-only foreign key. Each Part needs five distinct file
slots (DOCX, EPUB, PDF×3) plus independent lifecycle — a first-class
custom post type gives that for free (own edit screen, own revisions,
`WP_Query`/`post_parent__in` support) without building a custom repeater
UI just to avoid a second post type.

One consequence worth noting: WordPress's built-in "Page Attributes"
meta box only offers same-post-type parents in its dropdown, which
doesn't work for a Part-to-Book relationship. `noblesee-core` renders
its own "Parent book" + "Order" fields in the Part Details meta box
instead (see `includes/meta-boxes.php`) and sets `post_parent`/
`menu_order` directly — this keeps the *storage* native (real
`post_parent`, fully queryable) while working around that one UI
limitation.

No ACF or third-party meta-box plugin is used — native
`register_post_type` + `register_post_meta` + `add_meta_box` cover every
field needed, keeping all of this logic inside the mandated custom
plugin rather than delegated to a third-party data-entry plugin.

## 4. Storage: R2 for book artifacts, local WordPress uploads for everything else

`CLAUDE.md`'s target architecture calls for S3-compatible storage
(MinIO in dev). The MVP originally deferred this — deliberately staying
on WordPress's native local uploads until something in the system
actually needed S3 semantics, on the grounds that adding an S3 offload
path (e.g. WP Offload Media) for zero present benefit would be exactly
the "premature complexity" `CLAUDE.md` warns against. That consumer
showed up (storage that survives a container/instance being replaced,
ahead of the conversion service and a multi-instance web tier), so this
pass migrates.

Rather than adopt a generic S3-offload plugin for all of WordPress's
media library, the migration stays scoped to what `CLAUDE.md` section 14
actually describes: the DOCX/EPUB/PDF part-format files tracked by
`nr_part_format_fields()` (`includes/meta-boxes.php`). Generic WP media
(theme images, the book cover/featured image) stays on local disk —
those aren't part of the conversion-pipeline domain this plugin owns,
and pulling in a full offload plugin to rewrite every attachment URL
site-wide would be a much larger, less reversible change for no benefit
this pass actually needs.

Client: the official `aws/aws-sdk-php` (`Aws\S3\S3Client`, configured
for R2's S3-compatible endpoint with `region => 'auto'`), not a
hand-rolled SigV4 signer — mature, battle-tested request signing over
custom crypto code, per `CLAUDE.md`'s "prefer existing mature
open-source components." It's built in via Composer at image build time
(`wordpress/Dockerfile`) so container start stays fast; the plugin
directory's bind mount for live-editing PHP is layered under a named
volume at exactly `vendor/`, so the baked-in deps aren't shadowed by it
(see `docker-compose.yml`).

`includes/storage.php` is the single seam: `nr_storage_sync_to_r2()`
mirrors a part-format attachment to R2 whenever it's saved
(`includes/meta-boxes.php`), and `nr_storage_resolve()` decides per
part+format whether to read from R2 or fall back to the local file —
the download and online-reader paths (`includes/access.php`) don't know
or care which. Falling back to local automatically whenever R2 isn't
configured means local dev keeps working without an R2 account, and a
part not yet mirrored (or an R2 outage) degrades to local rather than
failing outright. `nr_stream_file()`'s existing contract — stream the
bytes via `readfile()`, never redirect to a public media URL, so the
real storage location is never exposed or bookmarkable — is exactly
what let this land without changing the public download contract:
`readfile()` works identically against a local path or an R2
`s3://bucket/key` stream-wrapper URI once the SDK's stream wrapper is
registered. Content already attached before R2 was configured is caught
up with `wp nr backfill-storage` (`includes/cli.php`), a one-time
command rather than automatic provisioning since it needs real R2
credentials.

## 5. Download rate limiting: custom table, rolling window

`wp_nr_downloads` (`id, user_id, part_id, book_id, format, created_at`,
indexed on `(user_id, created_at)` and `(user_id, book_id, created_at)`)
is created via `dbDelta()` on plugin activation. A plain `usermeta`
counter can't cleanly express "how many in the last rolling 24 hours" or
retain an audit trail; a small append-only log table answers both with a
single indexed query, and gives future admin tooling (abuse
investigation, most-downloaded books) real data to query.

The limit is on **distinct books**, not files: the check is
`COUNT(DISTINCT book_id)` over the window, and a book already drawn from
during that window never re-charges. So taking one title as EPUB and
again as PDF — or reading several of its parts — costs one slot, not one
per file. That matches the stated requirement ("volume of books
downloaded per user in a period", explicitly *not* network
bandwidth/throughput) and avoids the perverse incentive of making a
reader ration formats of something they're already reading. Every
individual download is still logged, so the audit trail is unaffected by
how the counting works.

## 6. Download delivery: authenticated, nonce-protected, rights-gated

The route `/noblesee-download/{part_id}/{format}/` requires: a logged-in
user (rate limiting needs a real per-user identity, not an IP/cookie
guess — this also means the catalog only shows live download buttons to
logged-in visitors, with a login/register prompt otherwise), a valid
nonce (protects the flow against a forged link silently draining a
victim's daily quota), the parent Book's `rights_status` in
`{public_domain, licensed, permission_granted}` (making the rights
metadata from `CLAUDE.md` section 6 actually operative, not inert data),
and being under the rate limit. `docx` is hard-excluded from the public
format allowlist in code — the DOCX master stays private regardless of
what an admin attaches, per `CLAUDE.md`'s "DOCX master is the source of
truth... do NOT use [anything else] as the canonical source." An
over-limit request returns a positively-worded 429 rather than a raw
WordPress error, in keeping with `CLAUDE.md`'s "no dark patterns"
guidance on the business model.

## 7. Staged release: per-reader clock, opt-in per book

`CLAUDE.md` core feature 4 says later parts are "locked for a delay
period after the prior part's release/download — the delay is roughly
the estimated time needed to finish reading the prior part."

That last clause decides the design: the clock starts when **this
reader** first downloads the previous part, not on a global publication
date. A global schedule would lock out someone who finds a book late
while giving nothing to anyone, whereas the stated intent is pacing one
person's reading. `wp_nr_downloads` already records who took what and
when, so the clock needs no extra storage — `first_download_at()` reads
it directly, deliberately across all history rather than the rate-limit
window, since the two have nothing to do with each other.

Staged release is opt-in per book (`nr_staged_release`), so single-part
titles and anything that should simply be available are unaffected. The
delay is a site-wide default (72h) with a per-part override, since
"time needed to read it" genuinely varies by part.

Gating is enforced at the download endpoint, not just hidden in the UI,
and is checked **before** the rate limit so a part the reader may not
open yet can never consume one of their daily book slots. Users who can
edit the book bypass the gate, so editors can verify a late part's files
without waiting out the delay.

The paid early-unlock half of the feature is not implemented — it needs
WooCommerce and is tracked in `docs/ROADMAP.md`.

## 8. Collections taxonomy

Books are grouped by a hierarchical `nr_collection` taxonomy
(`/collections/{slug}/`) rather than tags or a meta field. Hierarchical
because the intended groupings are a curated shelf structure — "Chinese
Wisdom", "Authors" as a parent of individual author shelves, with room
for more sub-shelves as the library grows — not freeform labelling; and
a real taxonomy (rather than meta) gets archives, queryability, term
hierarchy, and admin UI (the standard WP category checkbox metabox) from
core for free. A book can carry more than one collection —
`wp_set_object_terms()` on a non-exclusive taxonomy handles that with no
extra code. The actual shelf structure is content, not code: set up
idempotently in `provisioning/setup-catalogs.php`, editable afterward
like any other terms.

Every book gets a collection. Rather than a custom `save_post` hook,
`nr_register_taxonomies()` (`includes/post-types.php`) registers
`nr_collection`'s `default_term` as "Others" — a WP 5.5+ core feature
that auto-creates the term and assigns it to any book published with
none checked. One line of config instead of hand-rolled fallback logic.

Collection archives reuse the catalog template with a filtered query
instead of a near-duplicate template. Both the archive and the front
page wrap their content in the same left-hand catalog sidebar
(`nr_catalog_sidebar()`, built on core's `wp_list_categories()` so
nesting and current-item highlighting come for free rather than being
hand-rolled) — clicking a collection there is a normal link to its
archive, no client-side filtering involved. The front page keeps its own
hero copy and `[noblesee_books]` grid as ordinary WP-admin-editable page
content (`templates/front-page.php` just wraps it, doesn't replace it);
the sidebar is the only thing that page and the book archive share.

## 9. Sign-up: custom page + Google, replacing wp-login.php?action=register

WordPress's default registration screen is bare, off-brand, and (with
`users_can_register` on) sits at a predictable, unstyled URL. It's
replaced outright: `wp-login.php?action=register` redirects to `/sign-up/`
(`nr_redirect_default_registration()`), and every core entry point that
builds a registration link (`wp_registration_url()`, used by the "create
a free account" prompt on `templates/single-nr_book.php`) already goes
through the right URL for free via the `register_url` filter — no
template had to change.

`includes/auth.php` owns the traditional name/email/password path
(`wp_insert_user()`, immediate login — no separate email-verification
step; see the file's docblock for why that's an acceptable trust level,
same as core's own registration and the Google path below).
`includes/social-login.php` owns "Continue with Google", built on
`league/oauth2-client` + `league/oauth2-google` (mature libraries, not a
hand-rolled OAuth/JWT implementation — same reasoning as `storage.php`'s
choice of `aws-sdk-php`). Both funnel into the same
`nr_log_in_new_user()`/subscriber-role account creation, so there's one
answer to "how does someone end up with an account," not two parallel
systems.

Google sign-up needs real OAuth credentials (`GOOGLE_OAUTH_CLIENT_ID`/
`_SECRET`, see `.env.example`) that only the site operator can obtain
from Google Cloud Console — the "Continue with Google" button simply
doesn't render until they're set (`nr_google_oauth_configured()`), same
fallback pattern as R2. Apple Sign In is deliberately out of scope for
this pass: it requires an active paid Apple Developer Program membership
plus Apple-side setup (Services ID, a Sign In with Apple private key,
Team ID) before there's anything to configure, not just code — tracked
in `docs/ROADMAP.md`. `includes/social-login.php` is written so a second
provider can be added beside `nr_google_oauth_provider()` without
touching the account-linking logic, which isn't Google-specific.

Security notes worth recording since this is auth surface:

- **CSRF (OAuth `state`)**: round-tripped through a short-lived,
  httponly cookie, not a WP nonce. A nonce for a logged-out visitor is
  the same value for every anonymous visitor in a given time window
  (there's no session to key it to), so it wouldn't actually bind the
  callback to *this browser's* request — the exact thing `state` exists
  to guarantee, to prevent a login-CSRF where an attacker completes
  their own consent flow and hands the victim's browser a callback URL
  carrying the attacker's code.
- **Account takeover via email match**: an existing WordPress account is
  only auto-linked to a Google login by email when Google itself reports
  that email as verified (`GoogleUser::getEmailVerified()`). Without
  that check, anyone could type someone else's address into an
  unverified OAuth identity and take over their NobleSee account.
- **Open redirect**: the post-login destination (`redirect_to`, used so
  "log in from a book page" returns you to that book) always passes
  through `wp_validate_redirect()` before being used.

## 10. What's deferred

See `docs/ROADMAP.md` for the full list. In short: the OCR/AI conversion
pipeline, WooCommerce-based paid unlocks and donations, Send-to-Kindle,
per-user blogs, the e-reader affiliate/resale link, the X
anti-explicit-content worker, and Kubernetes manifests are all out of
scope for this pass. (R2 storage for book artifacts and custom sign-up +
Google login are no longer on this list — see sections 4 and 9. The
*login* screen — as opposed to sign-up — is still WordPress's default,
and Apple Sign In is still deferred, pending an Apple Developer Program
membership.)

## 11. Platform: stay on WordPress for now (NR-31)

`CLAUDE.md` section 2.1 mandates WordPress, but it was chosen up front
rather than after comparing options, and nothing in the MVP validated
that choice. NR-31 asks the question properly. This section records the
answer and, more usefully, the conditions under which it should change.

**Recommendation: stay on WordPress for this phase.** Not because it is
the best platform for NobleSee in the abstract — it probably isn't — but
because migrating now would spend the project's scarcest resource on the
part of the system that is not blocking readers, and because the cost of
migrating *later* is already low and stays low.

### 11.1 What is actually coupled to WordPress

The intuition "the business logic is isolated in a plugin, so a port is
cheap" is half right, and the wrong half is the expensive one. Counting
WordPress API calls per file in `noblesee-core` (2,431 lines of PHP):

| File | LOC | WP API calls | What it is |
|---|---|---|---|
| `meta-boxes.php` | 255 | 37 | Book/Part editing UI |
| `auth.php` | 178 | 30 | Sign-up, sessions |
| `social-login.php` | 214 | 17 | Google OAuth |
| `templates.php` | 145 | 11 | Template routing |
| `post-types.php` | 185 | 10 | Domain model |
| `rate-limit.php` | 156 | 1 | Rolling-window limiter |
| `staged-release.php` | 139 | 3 | Per-reader release clock |
| `access.php` | 109 | 5 | Rights/nonce gate |
| `downloads.php` | 93 | 3 | Streamed delivery |

The NobleSee-specific rules — rate limiting, staged release, rights
gating, download delivery, roughly 500 lines — are nearly
WordPress-free already and would port almost verbatim to any stack. What
is densely coupled is the *generic* half: an editing UI, sessions,
OAuth, template routing. That is precisely the half a platform is
supposed to give you for free, and precisely what a migration makes you
rebuild. A port is not "move the isolated logic"; it is "rewrite the
commodity infrastructure and carry the logic across unchanged".

The corollary is the reason to defer with a clear conscience: because
the custom rules are already decoupled, they will still be decoupled in
six months. Waiting costs almost nothing in future migration effort,
while migrating now costs weeks that the reading mission needs
elsewhere.

### 11.2 The candidates

**Stay on WordPress (baseline).** Zero switching cost. Gives auth,
password reset, media handling, an editorial UI for proofreaders, i18n,
and a WooCommerce path for the deferred donations/unlocks. Costs: a
large plugin/theme CVE surface, MySQL as a hard requirement, and a
frontend whose performance depends on discipline rather than on the
architecture.

**Static site generator (Astro/Hugo) + small API.** Genuinely excellent
for the catalog and book pages, which are read-mostly and would benefit
from being static. But every gated behaviour NobleSee has — per-user
download limits, staged release, rights checks, Send-to-Kindle — is
per-user and dynamic, so it lands in the API regardless. This is really
"custom app with a static front end", and should be evaluated as such,
not as a lighter option.

**Django (or Rails).** The strongest technical fit. The book → part →
format → rights model maps onto an ORM far more naturally than onto
posts and meta rows, the admin is generated rather than hand-rolled
(replacing all 255 lines of `meta-boxes.php`), auth and social login are
mature libraries, and PostgreSQL becomes available. This is the
recommended target *if* a migration happens.

**Headless CMS (Payload/Strapi/Directus).** Solves the editorial UI, but
reintroduces a second system to operate and still leaves the gated
download logic to be written by hand. Weakest cost/benefit of the four.

### 11.3 On the Calibre-based blueprint in NR-31

The blueprint attached to the ticket is sound about the frontend and the
tunnel, but it rests on a factual error worth recording so it is not
rediscovered later: **Calibre does not do OCR.** Its conversion pipeline
is format-to-format (EPUB ↔ MOBI ↔ AZW3 ↔ PDF-with-a-text-layer). It
cannot turn a scanned page image of a traditional Chinese book into
text, which is the *entire* first stage of NobleSee's mission per
`CLAUDE.md` section 7. Calibre-Web Automated is likewise a personal
library manager for an already-digitised collection — it has no concept
of rights status, per-user download limits, staged part releases, or
paid unlocks.

Calibre is still useful, but as a *format-conversion step near the end*
of the pipeline (approved DOCX → EPUB → AZW3), sitting downstream of
PaddleOCR and the vLLM correction stage — not as the library engine.
Note also that Calibre is GPL v3: shelling out to its binaries as
separate processes is fine, but importing its Python modules would pull
NobleSee's own source under the GPL, which matters given the project has
a revenue model.

### 11.4 Migration sketch, if the answer changes

Target: Django + PostgreSQL, keeping `services/converter` untouched
(it is already a standalone FastAPI service by design, and is
platform-agnostic).

1. **Model** — `Book`, `Part`, `Format`, `Collection`, `RightsStatus` as
   ORM models; Django admin replaces `post-types.php` + `meta-boxes.php`.
2. **Auth** — `django-allauth` replaces `auth.php` + `social-login.php`,
   including the Google provider.
3. **Rules** — port `rate-limit.php`, `staged-release.php`, `access.php`,
   `downloads.php` largely 1:1; the rolling-window limiter is plain
   indexed SQL and moves unchanged.
4. **Storage** — `storage.php` is already an S3/R2 abstraction; swap
   `aws/aws-sdk-php` for `boto3`.
5. **Frontend** — the largest unknown. Kadence disappears, so the
   catalog, book, sign-up and reader pages are rebuilt. The EPUB reader
   itself is already custom JS and carries over.
6. **Payments** — Stripe directly instead of WooCommerce.
7. **Data** — a one-off export/import script; the corpus is small and
   the DOCX masters are the source of truth, so this is low-risk.

**Rough estimate: 3–6 focused weeks** to reach current parity, of which
the frontend rebuild and payments are the bulk. Steps 1–4 are perhaps a
week. This is a parity exercise — it delivers no new reader value, which
is the core argument against doing it now.

### 11.5 What would change the answer

Revisit this decision if any of the following becomes true:

- A WordPress plugin/theme CVE causes a real incident, or patching
  becomes a recurring tax.
- The editorial/proofreading workflow outgrows the meta-box UI badly
  enough that ACF or a rebuild is on the table anyway (already flagged
  in `docs/ROADMAP.md`).
- Measured reader-facing performance on mobile fails the mission's bar —
  this has *not* been measured yet, and should be before it is used as
  an argument in either direction.
- Per-user blogs go ahead via Multisite, which would substantially
  deepen the WordPress commitment. Deciding to migrate is much cheaper
  before that than after.
- The conversion pipeline lands and WordPress proves awkward as its
  editorial front end.

Until one of those fires, the platform is not the bottleneck: the
content production pipeline (`docs/ROADMAP.md`, "Content production") is.
