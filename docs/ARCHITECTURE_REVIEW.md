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

## 4. Storage: local WordPress uploads for the MVP, not MinIO/S3 yet

`CLAUDE.md`'s target architecture uses S3-compatible storage (MinIO in
dev). This MVP deliberately stays on WordPress's native local uploads
instead. Rationale: MinIO's only real payoff shows up once something
else in the system actually needs S3 semantics — a conversion service
writing artifacts, a CDN, multi-instance web servers — none of which
exist yet in this slice. Adding it now would mean also adopting an S3
offload path (e.g. WP Offload Media) for zero present benefit, which is
exactly the "premature complexity" `CLAUDE.md` warns against. The
`nr_stream_file()` download path in `includes/downloads.php` already
avoids exposing raw file paths (it streams via `readfile()`, never
redirects to a public media URL), so swapping the storage backend later
won't change the public download contract. See `docs/ROADMAP.md`.

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

## 7. What's deferred

See `docs/ROADMAP.md` for the full list. In short: the OCR/AI conversion
pipeline, WooCommerce-based paid unlocks and donations, Send-to-Kindle,
per-user blogs, the e-reader affiliate/resale link, the X
anti-explicit-content worker, the S3/MinIO storage swap, and Kubernetes
manifests are all out of scope for this pass.
