# NobleSee — Roadmap

The platform was rebuilt on Next.js + Payload in August 2026 (NR-31; see
`docs/MODERNIZATION_ASSESSMENT.md`), and moved from PostgreSQL in a container
to Cloudflare D1 + Workers on 2026-08-13 (see
`docs/CLOUDFLARE_ARCHITECTURE.md`).

What exists today is a working reading site: a catalog, book pages, an
in-browser reflowable reader, reader accounts, Send-to-Kindle, a credit
economy, and a reader upload portal — with the rules that govern them
implemented and unit-tested in a framework-independent layer.

Everything under "Not built" is deliberately deferred, named here so the
current scope stays legible as a foundation rather than reading as an
oversight.

## Built

- **Rights model** — six statuses, failing closed on `unknown` (NR-9, NR-10).
  Two access rules, not one: `canReadOnline` stops before the account
  requirement that `canAccessArtifact` enforces, because reading is free.
- **Credits** — 1 per 70 pages of the DOCX master, min 1 max 7; 10 at signup,
  5 for a month you sign in and 2 for a month away; the first delivery buys
  the book and later ones cost a flat credit. Reading is never charged.
  Accrual is lazy — no cron — because a sign-in always grants for its own
  month. Replaced the rolling delivery cap on 2026-08-14.
- **Whole books** — Parts and staged release were removed on 2026-08-14. A book
  is one record, one master, one set of formats.
- **Converter** — the full pipeline: OCR, structure, DOCX master, EPUB 3, three
  PDF sizes, R2, the async job API, and the pull handoff from the Worker.
- **Phase 1 on Adobe PDF Services** — a scanned PDF is OCR'd and mastered in
  one Export PDF call from the Worker, replacing Google Document AI on
  2026-08-19 and taking `domain/ocr.ts` with it. Traditional Chinese via
  `ocrLang: zh-Hant`; running heads land in Word's header parts and headings
  come back as `Heading 1`/`Heading 2`, so neither has to be inferred any more.
  Text sources still reach the converter and are mastered there.
- **Upload portal** — file-only upload with metadata read from the file
  (UTF-16/UTF-8/GBK/Big5), an editable summary, a private draft workspace with
  master download and replace, delete, retry, and optional submit-for-review.
- **Conversion quota** — 3 books and 1200 pages a month, admins unlimited,
  charged at conversion so drafts stay free.
- **Uploader share** — 33% public domain, 66% authored or licensed, accumulated
  in hundredths so small books actually pay.
- **Site** — catalog with collection filtering, book pages, reading-first
  typography with Traditional Chinese first in the font stack.
- **The uploader is private** — `owner` is readable only by its own owner and
  by an administrator, as field-level access, so it never reaches the UI or the
  API for anyone else (2026-08-23).
- **Administrators publish directly** — the Publish control no longer waits for
  an approved review, because publishing a book is approving it (2026-08-23).
  The write records the approval so the queue and the audit trail stay honest.
  Two things are unchanged: the rights gate, which nobody waives, and the
  uploader's offer — an administrator cannot publish someone else's unsubmitted
  book, only their own. An admin's own submission publishes itself.
- **A way in to the admin** — nothing on the public site linked to `/admin`, so
  an editor had to know the URL. The account nav now carries "Editors' desk"
  for administrators.
- **Nested collections** — a shelf can stand on another shelf, and a parent
  shows every book beneath it (2026-08-23). The `parent` field had been on the
  collection since the first migration with nothing reading it; what makes it
  mean something is `domain/collectionTree.ts` — the subtree filter behind
  `?collection=`, the depth cap, and the refusal to file a collection under its
  own descendant. Three levels deep at most, and the limit is editorial.
- **Two orders on every shelf** (`CLAUDE.md` section 5.4) — curated or A–Z,
  picked with `?sort=` and applied to the books on a shelf and to the shelves
  themselves alike (2026-08-25). Curated is the default and it is a *number the
  book carries*: given when it is filed, unique among that shelf's books,
  editable in the panel and over the admin API. Typing a number another book
  holds shifts the run along rather than swapping, which is what keeps them
  unique; `domain/shelfOrder.ts` owns the rule and `lib/shelfPlacement.ts` does
  the writing. Backfilled in title order, so nothing a reader sees moved on the
  day it shipped.
- **Default covers** — page one of the book, rendered by the converter and used
  wherever nobody has uploaded a cover (2026-08-23). Its own claimable job kind
  rather than a pipeline stage, because the books that most need one are the
  two the pipeline never touches: an EPUB upload and a PDF published as it
  stands. Taken from the PDF where there is one, since for a scan page one *is*
  the cover the publisher printed. `domain/cover.ts` and `app/cover/`.
- **Authorized delivery** — the three domain rules wired to artifact streaming
  through the Worker (`src/lib/authorizeDownload.ts`). Not signed URLs: the R2
  binding has no presigning, and streaming turned out to be the better shape.
- **In-browser reflowable EPUB reading** (epub.js) — rebuilt after the
  WordPress removal (NR-16).
- **Reader accounts** — sign-up, log-in and account pages against Payload auth,
  front-of-site rather than through the admin.
- **The cover, on the book's own screen** — the edit panel's face *is* the
  cover, showing what a reader sees (upload, else page one, else the first
  character), with a small upload button on it. It was an upload field in the
  CMS until 2026-08-24, which made the cover the one property of a book that
  could not be changed on the screen for changing books. Removing an upload
  falls back to page one rather than to nothing. Media's accepted types are now
  an allowlist rather than `image/*`: SVG is an image and a script container,
  and media is served from this origin.
- **No generated admin panel** — `app/(payload)/cms` is deleted, which is how
  Payload itself says to disable it (`admin.disable` is deprecated). What it
  was still needed for was granting the admin role and correcting an email;
  both are now the `/admin/users` panel, which selects with `?reader=` like
  every other admin screen and refuses self-demotion — somebody has to be able
  to grant the role back. Credits are shown there and editable nowhere: the
  field refuses writes at field level and only `lib/credits.ts` moves a
  balance. What went with it: a browser view of the ledgers for anyone other
  than yourself, and the Media list. `(payload)/api` stays.
- **Personal access tokens** — `/account/tokens`, where a reader mints a token
  that lets a script act as them. Payload's `useAPIKey` underneath, so
  `payload.auth()` stays the only thing that resolves a credential and the
  admin API needed no change to accept one; the screen supplies the value so it
  carries a recognisable `nbl_pat_` prefix. One per account, so minting is also
  rotating. It was a checkbox in the CMS until 2026-08-24, which made ticking it
  the one legitimate reason a *reader* ever had to open `/cms`.
- **Send-to-Kindle** (NR-17) — over Resend's HTTP API, because Workers cannot
  speak SMTP. Authorized by the same path as any delivery and recorded in the
  same ledger.
- **Admin bootstrap** — `npm run create-admin`, for after the first-user screen
  is gone.
- **The editorial admin** (`/admin`) — the review queue with its decision
  panel, the library with reading level and shelf set in place, the
  collections and their order, and the readers. Front-of-site and built to the
  design, in its own route group with its own shell. Payload's generated admin
  moved to `/cms` to make room and was deleted outright on 2026-08-24, once the
  readers screen took on the last two things only it could do — see below.
  Approving and publishing stay two acts, because
  `CLAUDE.md` section 6.1 says they are two gates: approval is editorial, the
  publish consults the rights, and the collection hook refuses either way.
  Readers are read-only — the design's suspend control has no account state
  behind it, and a button that only looks like it suspends someone is worse
  than no button.
- **Infrastructure as code** — Terraform for R2, D1, DNS and the www redirect.
- **Converter, partially** — PyMuPDF rendering, PaddleOCR behind a replaceable
  interface, normalization/structure, and python-docx master generation, driven
  by a CLI.
- **Four inputs, one master** — scanned PDF (OCR), text-layer PDF, DOCX and
  plain text all converge on the same DOCX master, detected by file content
  rather than extension. The DOCX reader is also what makes "generate reader
  formats from the *approved* master" possible, and the round trip is tested.
- **Reading levels** (`CLAUDE.md` section 5.1) — essential/normal/extensive as
  ordered ids, nesting so a reader sees their level and everything shallower.
  Curation, not access control; filtered in the catalog query.
- **Publication review** (`CLAUDE.md` section 6.1) — a reader-created book
  reaches the public library only on an admin approval *and* cleared rights,
  which are independent gates. Enforced in the domain layer and on write.
- **Google sign-in** (NR-30) — Authorization Code with PKCE, in two route
  handlers under `/auth/google`. Claim checking and account linking live in
  `domain/googleIdentity.ts` under test, not in the handler: an unverified
  Google email is refused outright, because linking one to an existing account
  would be account takeover. Requires the redirect URIs registered in the Google
  Cloud Console and the credentials uploaded as Worker secrets — see
  `.env.example`.
- **AI-assisted OCR correction** — `correct` proposes, a human approves in a
  review file, `apply` edits. Never silent rewriting, per `CLAUDE.md` section 7,
  and enforced by deterministic guardrails rather than by the prompt: a proposal
  that changes more than two substantive characters is refused as a rewrite, and
  the refusal is recorded. The provider is xAI by default and a self-hosted
  vLLM endpoint by configuration (`CLAUDE.md` section 4).
- **The conversion pipeline runs in the Worker** (2026-08-26) — the Python
  container is deleted. Driven by a cron trigger once a minute, one book per
  tick, claimed with the same compare-and-swap the poll used. `CLAUDE.md`
  section 13.

## Not built

### Reader experience

- **In-reader typography controls** — font size, line spacing, margins (NR-18).
- **Apple Sign In** (NR-25) — hangs off the accounts that now exist.

### Content production

- **EPUB validation** — generated EPUBs are well-formed and open, but nothing
  runs epubcheck over them (NR-1 … NR-8).

- **The portal's remaining screens** — per-user upload quotas.

  The question that used to sit here — whether a private upload may be sent
  to a third-party LLM at all — was settled on 2026-08-26 and is no longer
  open. It is the uploader's decision, disclosed on the screen that makes it,
  stored as `conversion.aiCorrection`, and re-read at the moment of sending
  (`CLAUDE.md` sections 4 and 6.1). `allow_third_party_ai` is no longer false
  everywhere.

  `tools/generate-seed-content.py` still writes the seed library's own
  reproducible artifacts into `content/seed/`.

- **Cover image processing** — Payload uses `sharp`, a native binary that cannot
  run on a Worker, so an *uploaded* cover is stored at whatever size it arrives.
  Either move the resizing into the converter or use Cloudflare Images.
  Generated covers are unaffected: the converter renders them into a fixed box
  already (`app/cover/first_page.py`).

### Monetization

Secondary to the reading mission — see `CLAUDE.md`'s Business Model section.
No dark patterns.

- **Stripe** — donations and paid unlocks, integrated directly from the
  application (NR-12). WooCommerce is gone with WordPress and is not being
  replaced.
- **Buying credits** — the economy exists and grants credits monthly; nothing
  sells them. Any purchase route should stay a top-up rather than becoming the
  only realistic way to read, which the free online reader already prevents.
- **E-reader affiliate/resale link** — discounted, dedicated product link
  (NR-14).

### Platform

- **Per-user blogs** (NR-20) — re-scoped by the rebuild. This was nearly free
  on WordPress; on the new stack it is a Payload collection plus author-scoped
  access rules, routes and moderation. Re-estimate before scheduling.
- **Automated X anti-explicit-content worker** (NR-21) — secondary to the core
  mission per `CLAUDE.md`'s Core Mission section. Standalone service.
- **Chinese full-text search** — on D1 (SQLite) this means FTS5. Its built-in
  tokenizers will not segment Chinese usefully: `unicode61` treats a run of Han
  characters as one token, so only whole-field matches work. The practical
  options are the `trigram` tokenizer, which works without segmentation at some
  index cost, or segmenting at index time in the converter and storing a
  space-delimited field. Custom tokenizers such as `pg_jieba`/`zhparser` are not
  available — those were the Postgres answer, and this needs a different one.

### Infrastructure

- **Cloudflare Queues** — the web → converter handoff. Needed before the
  conversion service can be driven from the site rather than the CLI.
- **Where the converter container runs** — this host, Cloudflare Containers, or
  elsewhere. Deliberately open; the queue boundary means it can be answered
  without touching application code.
- **Kubernetes manifests** (NR-24) — no longer urgent. The web tier is a Worker
  and Compose is retired; revisit only if the converter grows into several
  services that need orchestrating.

## Closed by the Workers port

- **Hosting target** (NR-28) and **public HTTPS** (NR-29) — these were blocked
  on outbound TCP/UDP 7844 being filtered upstream of this host, so the
  Cloudflare Tunnel could not connect and the site returned error 1033. Running
  the application as a Worker removes the tunnel from the architecture
  entirely, so the blocker no longer applies to the web tier. The converter
  sidesteps it too, by pulling from a queue rather than accepting inbound
  connections.
- **Redis** (NR-23) — was to back the conversion job queue. Cloudflare Queues
  takes that role, so there is no Redis to run.
