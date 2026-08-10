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

### Resetting

```
docker compose down -v   # drops the db_data and wp_data volumes — full reset
```

## Layout

```
wordpress/plugins/nobleread-core/   custom plugin: content model, downloads, rate limiting, templates
provisioning/                       first-boot install/activation/seed scripts (idempotent)
docs/                                architecture review + roadmap
docker-compose.yml                   db, wordpress, provision, adminer
```

## Status

MVP / early runnable system — one full vertical slice working end to end.
See `docs/ROADMAP.md` for what's deliberately deferred (OCR/AI conversion
pipeline, WooCommerce paid unlocks + donations, Send-to-Kindle, per-user
blogs, e-reader resale link, X anti-explicit-content worker, S3/MinIO,
Kubernetes).
