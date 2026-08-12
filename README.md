# NobleSee

A digital preservation and e-reader accessibility project: valuable books —
traditional Chinese classics, history, and works on wisdom and living well —
rebuilt from scans into clean, reflowable editions that are genuinely pleasant
to read.

The point is not to host PDFs. The point is to make these books readable: on a
phone, on a Kindle, in the dark, at whatever type size you need.

## Stack

Next.js 16 (App Router) + React + TypeScript, with **Payload 3 embedded inside
the same application** as CMS and admin, on PostgreSQL 18. One deployable
serves the public site, the JSON API and the editorial admin. Object storage is
Cloudflare R2 over the S3 API.

Business rules live in `apps/web/src/domain` — a framework-independent layer
that may not import Payload, Next or a database client. That boundary is
enforced by a check in `npm run verify`, not just documented.

> This replaced a WordPress implementation in August 2026. The reasoning is in
> `docs/MODERNIZATION_ASSESSMENT.md`; the deciding factor was that there were no
> users and no data to preserve. The old code is in git history — nothing was
> migrated.

## Running it

```bash
cp .env.example .env
# set PAYLOAD_SECRET — there is no default:  openssl rand -hex 32
docker compose up -d --build
```

- Site: http://localhost:8093
- Admin: http://localhost:8093/admin (create the first user on first visit)
- Health: http://localhost:8093/health — checks the database, not just the process

Schema migrations run automatically as a one-shot `appmigrate` service before
the app starts. Payload's Postgres adapter does not auto-create tables outside
dev, so migrations are explicit and versioned in `apps/web/src/migrations`.

### Seeding the catalog

```bash
docker compose --profile seed run --rm appseed
```

Loads the curatorial collections and two reference books (Tao Te Ching; The
Analects, in three parts, which exercises staged release). Idempotent — matched
on slug and updated in place. It is profile-gated rather than automatic
precisely because it updates in place: running it on every `up` would quietly
revert an editor's changes to those books.

### Other profiles

```bash
docker compose --profile tools up -d     # Adminer on :8091, dev-only DB inspection
docker compose --profile tunnel up -d    # publish on noblesee.com via Cloudflare Tunnel
```

## Development

```bash
cd apps/web
npm install
npm run verify     # generate types, domain-boundary check, typecheck, unit tests
npm run dev
```

```bash
./tools/smoke-test.sh                                # HTTP-level checks, localhost:8093
BASE_URL=https://noblesee.com ./tools/smoke-test.sh  # or an explicit host
```

`npm run verify` covers the domain rules in isolation; the smoke test covers the
wiring between them — that the catalog only lists cleared books, that a
held-back part offers no download link, that the DOCX master is never offered to
readers, and that anonymous downloads are refused.

### Generating book artifacts

```bash
pip install python-docx ebooklib weasyprint pillow
python3 tools/generate-seed-content.py
```

Writes DOCX, EPUB and three PDF sizes into `content/seed/`. This stands in for
the real OCR/AI conversion pipeline (`services/converter`, not yet built) so the
seed content is reproducible rather than a pile of committed binaries nobody can
regenerate.

## Layout

```
apps/web/                    the application — public site, API and admin
  src/domain/                business rules; imports no framework (enforced)
  src/collections/           Payload collections: Users, Media, Books, Parts, Collections
  src/lib/                   Payload-aware query helpers for the site
  src/app/(frontend)/        public pages
  src/app/(payload)/         admin and API routes
  src/migrations/            versioned schema migrations
  src/seed/                  catalog seed
content/seed/                generated book artifacts (DOCX/EPUB/PDF)
tools/                       smoke test, seed-content generator
docs/                        architecture decisions and roadmap
docker-compose.yml           appdb, appmigrate, app (+ seed/tools/tunnel profiles)
```

## Domain rules worth knowing

**Rights fail closed.** Every book carries an explicit rights status; only
`public_domain`, `licensed` and `permission_granted` may be distributed
publicly. `unknown` is deliberately not distributable — an unreviewed book is
never published by default. A Part may be *more* restricted than its Book, never
less.

**Download limits count books, not files.** A reader who takes EPUB, DOCX and
three PDF variants of one book has consumed one slot, because they read one
book. This is an application-level fairness policy, not a bandwidth control.

**Staged release is a per-reader clock.** Part N+1 opens a fixed delay after
*that reader* reached part N — so someone who discovers a book a year late gets
the same paced experience as an early reader. It is a reading rhythm, not
scarcity: nothing expires, and starting late costs nothing.

All three are enforced server-side. The frontend renders what the API permits
and is never the only thing between a reader and a restricted file.
