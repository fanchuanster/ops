# NobleSee

A digital preservation and e-reader accessibility project: valuable books —
traditional Chinese classics, history, and works on wisdom and living well —
rebuilt from scans into clean, reflowable editions that are genuinely pleasant
to read.

The point is not to host PDFs. The point is to make these books readable: on a
phone, on a Kindle, in the dark, at whatever type size you need.

## Stack

Next.js 16 (App Router) + React + TypeScript, with **Payload 3 embedded inside
the same application** as CMS and admin. One deployable serves the public site,
the JSON API and the editorial admin.

It runs as a **Cloudflare Worker**, built by OpenNext, on **D1** for the
database and **R2** for book artifacts. Both are reached through Worker
bindings rather than credentials: there is no connection string and no S3 access
key in the environment, so there is no secret to lift and replay from elsewhere.
Infrastructure is managed by Terraform in `infra/`.

Business rules live in `apps/web/src/domain` — a framework-independent layer
that may not import Payload, Next or a database client. That boundary is
enforced by a check in `npm run verify`, not just documented.

> This replaced a WordPress implementation in August 2026. The reasoning is in
> `docs/MODERNIZATION_ASSESSMENT.md`; the deciding factor was that there were no
> users and no data to preserve. The old code is in git history — nothing was
> migrated.

## Running it

Everything goes through `apps/web/cf`, which runs the toolchain in a container.
That is not a style preference: wrangler ships `workerd`, the real Workers
runtime, and workerd needs glibc 2.32+. On an older host — this one is Ubuntu
20.04 on 2.31 — it cannot start, which takes out `wrangler dev`, the Miniflare
behind `getPlatformProxy`, and every Payload CLI command that needs a binding.

```bash
cp .env.example .env                  # CLOUDFLARE_API_TOKEN for Terraform
cp apps/web/.dev.vars.example apps/web/.dev.vars
# set PAYLOAD_SECRET in .dev.vars — there is no default:  openssl rand -hex 32

cd apps/web
./cf npm install
./cf npm run migrate                  # apply schema to local D1
./cf npm run seed                     # load the catalog
../../tools/mirror-r2-local.sh        # copy book artifacts into local R2
./cf npx wrangler dev --ip 0.0.0.0    # the site, on :8787
```

- Site: http://localhost:8787
- Admin: http://localhost:8787/admin (create the first user on first visit)
- Health: http://localhost:8787/health — checks D1, not just the process

Migrations are explicit and versioned in `apps/web/src/migrations`; the adapter
is configured with `push: false` so nothing alters the schema at boot.

The seed loads the curatorial collections and two reference books (Tao Te Ching;
The Analects, in three parts, which exercises staged release). It is idempotent
— matched on slug and updated in place — and deliberately manual rather than
automatic, because updating in place would quietly revert an editor's changes.

Its `storageKey` values point at artifacts that really exist in the production
R2 bucket, so delivery has real files behind it. `mirror-r2-local.sh` copies
those objects into the local bucket; without it the catalog renders but the
reader and Send-to-Kindle return 502.

### Deploying

```bash
cd apps/web
./cf npx wrangler secret put PAYLOAD_SECRET   # once, per environment
./cf npm run deploy
```

The bundle is ~5.9 MB gzipped, against a 10 MB limit on Workers Paid. It does
not fit the 3 MB free tier — Payload's admin UI is most of it. The measurements
behind that, and what a free-tier split would cost, are in
`docs/CLOUDFLARE_ARCHITECTURE.md`.

### Creating an administrator

Payload shows its "create first user" screen only while the users table is
empty. The first reader to register closes it permanently — so on a live site
that screen is usually already gone, and there is no way back in through the
browser. Use:

```bash
cd apps/web
./cf npm run create-admin          # local D1
./cf npm run create-admin:remote   # the live production database
```

It prompts for an email and a password (echo off; `ADMIN_EMAIL` and
`ADMIN_PASSWORD` work too for non-interactive use). An address that already
exists is promoted to admin rather than duplicated, and a promotion leaves the
password alone.

Run it from a real terminal rather than piping input, so the password is
prompted for instead of sitting in your shell history.

The remote variant selects `wrangler.remote.jsonc`, which carries
`"remote": true` on the D1 and R2 bindings so the script acts on live data from
your machine. That flag lives in a *separate* config on purpose: putting it in
`wrangler.jsonc` would silently repoint `npm run migrate`, `npm run seed` and
`wrangler dev` at production too. The target is selected by `ADMIN_TARGET`
rather than a `--remote` argument because `payload run` replaces `process.argv`
before the script runs, so a flag would vanish silently and the script would
act on the wrong database while reporting success.

## Development

```bash
cd apps/web
./cf npm run verify   # generate types, domain-boundary check, typecheck, unit tests
```

```bash
./tools/smoke-test.sh                                # HTTP-level checks, localhost:8787
BASE_URL=https://noblesee.com ./tools/smoke-test.sh  # read-only against production
```

The signed-in checks register a reader and record deliveries, so they write to
whatever database `BASE_URL` names. Against a non-local host they are skipped
and reported as such — a read-only pass is a legitimate way to check a
deployment, and leaving test accounts in the live database is not. Add
`ALLOW_WRITES=1` when you do want them.

`npm run verify` covers the domain rules in isolation; the smoke test covers the
wiring between them — that the catalog only lists cleared books, that a
held-back part offers no reader link, that the DOCX master is never offered to
readers, that the page carries no download links at all, and that an anonymous
request for the EPUB stream is refused.

### Generating book artifacts

```bash
pip install python-docx ebooklib weasyprint pillow
python3 tools/generate-seed-content.py
```

Writes DOCX, EPUB and three PDF sizes into `content/seed/`. This stands in for
the OCR/AI conversion pipeline, which reaches a proofread DOCX master but does
not yet generate EPUB or PDF — see `services/converter/README.md`. The seed
content is generated rather than committed so it is reproducible instead of a
pile of binaries nobody can regenerate.

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
  cf                         runs the toolchain in a container (see "Running it")
  scripts/create-admin.ts    bootstraps an admin once the first-user screen is gone
  wrangler.jsonc             Worker bindings — mirrors `terraform output`
  wrangler.remote.jsonc      the same bindings, pointed at live D1/R2 (opt-in only)
services/converter/          scan → OCR → proofread → DOCX master (its own README)
content/seed/                generated book artifacts (DOCX/EPUB/PDF)
infra/                       Terraform: R2, D1, DNS, the www redirect
tools/                       smoke test, seed-content generator, R2 mirror
docs/                        architecture decisions and roadmap
```

## Send to Kindle

A reader adds their `@kindle.com` address on `/account`, and each part gains a
**Send to Kindle** button. Delivery is authorized by exactly the same code path
as a download — rights, staged release and the per-reader limit — and recorded
in the same ledger, because it *is* a download that happens to arrive by email.
Taking the EPUB and also sending it to a Kindle is still one book against the
limit.

Two things must be true before anything arrives:

1. **The reader has added `kindle@noblesee.com`** to their Approved Personal
   Document E-mail List, under *Manage Your Content and Devices → Preferences →
   Personal Document Settings* in Amazon. The account page walks them through
   it, deliberately prominently: Amazon **silently discards** documents from an
   unapproved sender — no bounce, no error, the book simply never appears — so
   this is the one failure the UI has to prevent rather than report.
2. **The sending domain is verified.** Workers cannot speak SMTP, so delivery
   goes over Resend's HTTP API. Set `RESEND_API_KEY` as a Worker secret, and put
   the SPF/DKIM records Resend issues into `email_dns_records` in
   `infra/terraform.tfvars`. Amazon drops mail failing either check, just as
   silently.

With `RESEND_API_KEY` unset the feature switches itself off rather than
offering a button that cannot work.

```bash
cd apps/web
./cf npx wrangler secret put RESEND_API_KEY
```

The sender address lives in `src/domain/kindle.ts` as one constant, so the
reminder shown to readers and the `From:` header cannot drift apart.

## Domain rules worth knowing

**Rights fail closed.** Every book carries an explicit rights status; only
`public_domain`, `licensed` and `permission_granted` may be distributed
publicly. `unknown` is deliberately not distributable — an unreviewed book is
never published by default. A Part may be *more* restricted than its Book, never
less.

**There are no downloads.** A book is read here, in the reflowable reader, or
sent to the reader's device. It is never handed over as a file to collect. That
is a product decision, not a technical limit: NobleSee exists to make books
pleasant to *read*, and a folder of PDFs is not that.

**Delivery limits count books, not files.** A reader who sends EPUB and all
three PDF variants of one book to their Kindle has consumed one slot, because
they read one book. Reading in the browser is never limited at all — the policy
paces bulk delivery, and charging someone for opening a book would penalise
exactly the behaviour the site is for. This is an application-level fairness
policy, not a bandwidth control.

**Staged release is a per-reader clock.** Part N+1 opens a fixed delay after
*that reader* reached part N — so someone who discovers a book a year late gets
the same paced experience as an early reader. It is a reading rhythm, not
scarcity: nothing expires, and starting late costs nothing.

All three are enforced server-side. The frontend renders what the API permits
and is never the only thing between a reader and a restricted file.
