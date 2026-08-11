# NobleRead

A WordPress-based site for hosting and sharing essential and noble books —
especially traditional Chinese culture and history — digitized, proofread,
and made comfortable to read on any device. See `CLAUDE.md` for the full
project mission and architecture, and `docs/ARCHITECTURE_REVIEW.md` /
`docs/ROADMAP.md` for the decisions and scope behind this MVP.

Domain: nobelread.com

## What's here

This is the first runnable slice: a Dockerized WordPress site with a
custom `nobleread-core` plugin implementing the Book/Part content model,
rights-status gating, per-format downloads (EPUB / PDF in three font-size
variants), and per-user download rate limiting — seeded with one real
public-domain book (*Tao Te Ching*, ch. 1, Legge's 1891 translation) so
the whole catalog → book → download flow works out of the box.

## Quickstart

```
cp .env.example .env
docker compose up -d
docker compose logs -f provision   # first boot: installs WP, theme, plugin, seed content — exits when done
```

Then:

- Site: http://localhost:8090
- Book catalog: http://localhost:8090/books/
- wp-admin: http://localhost:8090/wp-admin (`WORDPRESS_ADMIN_USER` /
  `WORDPRESS_ADMIN_PASSWORD` from `.env`, defaults `admin` / `admin`)
- Adminer (DB inspection, dev only): http://localhost:8091 — server `db`,
  user/password/database from `.env`

### Exposing it beyond localhost

To reach the site from another machine, set `WORDPRESS_URL` in `.env` to
`http://<host-ip-or-hostname>:8090` *before* first provisioning — WordPress
bakes this into its `siteurl`/`home` options, and links/assets will point
at `localhost` (broken for remote visitors) otherwise. If the site is
already provisioned, fix it after the fact instead of re-provisioning:

```
docker compose run --rm --entrypoint sh provision -c '
  wp --path=/var/www/html --allow-root option update siteurl "http://<host-ip>:8090"
  wp --path=/var/www/html --allow-root option update home    "http://<host-ip>:8090"
  wp --path=/var/www/html --allow-root rewrite flush --hard
'
```

The container already publishes on `0.0.0.0:8090`, so nothing in
`docker-compose.yml` needs to change — this is purely a WordPress config
step.

Downloads require a reader account — register via the "create a free
account" link on a book page, or in wp-admin. This is intentional:
per-user rate limiting needs a real identity, not just an IP/cookie.

Re-running `docker compose up` is safe — provisioning and seeding are
idempotent and won't duplicate content or reinstall WordPress.

### Useful WP-CLI commands

```
docker compose exec provision wp --path=/var/www/html --allow-root plugin list
docker compose exec provision wp --path=/var/www/html --allow-root theme list
docker compose exec provision wp --path=/var/www/html --allow-root post list --post_type=nr_book
docker compose exec provision wp --path=/var/www/html --allow-root post list --post_type=nr_part
```

(`provision` exits after seeding on its first run — use `docker compose
run --rm provision wp ...` if the container has already exited, or swap
in the long-lived `wordpress` service's container instead.)

### Storage (R2)

Book-format files (DOCX/EPUB/PDF) live on local WordPress uploads by
default and need no setup — the plugin falls back to local storage
whenever R2 isn't configured. To store them in Cloudflare R2 instead,
set these in `.env` before `docker compose up` (or `docker compose build
wordpress` if the stack is already running — the SDK is installed at
image build time, see `wordpress/Dockerfile`):

```
CLOUDFLARE_S3_ENDPOINTS=https://<account_id>.r2.cloudflarestorage.com
CLOUDFLARE_S3_ACCESS_KEY_ID=...
CLOUDFLARE_S3_SECRET_ACCESS_KEY=...
NR_R2_BUCKET=nobleread
```

New/edited parts sync to R2 automatically on save. To catch up files
attached before R2 was configured:

```
docker compose exec wordpress wp --path=/var/www/html --allow-root nr backfill-storage
```

See `docs/ARCHITECTURE_REVIEW.md` section 4 for what's in scope (part
format files only — theme images and book covers stay local) and why.

### Sign-up

`/sign-up/` (`includes/auth.php`) replaces WordPress's default
`wp-login.php?action=register` — a visit to the old URL now redirects
there. Name/email/password sign-up needs no setup. "Continue with
Google" (`includes/social-login.php`) needs real OAuth credentials and
stays hidden until they're set:

```
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

Get these from Google Cloud Console > APIs & Services > Credentials >
Create OAuth client ID (Web application), and add this exact URL as an
Authorized redirect URI (must match `WORDPRESS_URL` above):

```
{WORDPRESS_URL}/auth/google/callback/
```

Apple Sign In isn't implemented yet — see `docs/ROADMAP.md`.

### Smoke test

```
./tools/smoke-test.sh                                  # against localhost:8090
BASE_URL=http://10.0.0.5:8090 ./tools/smoke-test.sh    # or an explicit host
```

Exercises the paths that actually protect content and readers: rights
gating, the format allowlist (the DOCX master must never be publicly
downloadable), authentication, nonce validity, staged-release locking,
and the distinct-book download limit. Exits non-zero on any failure.

Development only — it creates a subscriber account, clears that
account's download history, and temporarily changes the download limit
(restored on exit). It only ever touches its own test user's rows, but
don't point it at production.

### Resetting

```
docker compose down -v   # drops the db_data and wp_data volumes — full reset
```

## Layout

```
wordpress/Dockerfile                 wordpress service image: WP-CLI + plugin's Composer deps (R2 SDK, OAuth client)
wordpress/plugins/nobleread-core/   custom plugin: content model, downloads, rate limiting, templates, R2 storage, sign-up/Google login
provisioning/                       first-boot install/activation/seed scripts (idempotent)
tools/                               dev utilities (seed-content generation)
docs/                                architecture review + roadmap
docker-compose.yml                   db, wordpress, provision, adminer
```

### Seed content

Two public-domain books ship as seed data: *Tao Te Ching* ch. 1 and *The
Analects* Books I–III (three parts, to exercise multi-part behaviour).
Their DOCX/EPUB/PDF files are generated by
`tools/generate-seed-content.py` — a dev utility standing in for the real
conversion pipeline (see `docs/ROADMAP.md`), kept in the repo so the
committed files are reproducible rather than opaque binaries:

```
pip install python-docx ebooklib weasyprint pillow
python3 tools/generate-seed-content.py          # writes only missing files
python3 tools/generate-seed-content.py --force  # regenerate everything
```

Adding a book is a matter of adding one entry to the spec in that script
and one to `$books` in `provisioning/seed-import.php`; the importer is
idempotent per book, so new books can be seeded into an already-running
site by re-running it.

## Status

MVP / early runnable system — one full vertical slice working end to end.
See `docs/ROADMAP.md` for what's deliberately deferred (OCR/AI conversion
pipeline, WooCommerce paid unlocks + donations, Send-to-Kindle, per-user
blogs, e-reader resale link, X anti-explicit-content worker, Kubernetes).
