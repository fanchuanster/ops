# NobleRead — Architecture Review (MVP)

This document records the architecture decisions made for the first
runnable slice of NobleRead, as required by `CLAUDE.md` ("Before
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
Gutenberg + Kadence/Blocksy/Astra + custom NobleRead blocks... rather than
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
doesn't work for a Part-to-Book relationship. `nobleread-core` renders
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

The route `/nobleread-download/{part_id}/{format}/` requires: a logged-in
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
hero copy and `[nobleread_books]` grid as ordinary WP-admin-editable page
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
  unverified OAuth identity and take over their NobleRead account.
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
