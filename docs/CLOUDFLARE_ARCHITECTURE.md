# Cloudflare architecture: what runs where

Decided 2026-08-12. Workers are preferred; containers are acceptable where a
Worker genuinely cannot do the job.

## The dividing line

The question is not "is this important" but **"is this bounded work on the
request path?"**

A Worker is billed and limited by **CPU time**, not wall-clock time. Waiting on
R2, D1 or an upstream HTTP call costs almost no CPU, so an I/O-shaped request
is comfortable on a Worker no matter how long the network takes. What a Worker
cannot do is *compute* for a long time — and OCR, LLM-assisted correction, DOCX
assembly and PDF rendering are exactly that.

| Work                                     | Shape          | Runs on   |
| ---------------------------------------- | -------------- | --------- |
| Catalog, book pages, reader UI           | render         | Worker    |
| Auth, sessions, access decisions         | CPU-trivial    | Worker    |
| Download authorization + streaming        | I/O            | Worker    |
| Streaming an EPUB to the reader          | I/O            | Worker    |
| Payload admin / editorial                | render         | Worker    |
| **OCR + DOCX master, scanned PDF**       | external HTTP  | Worker    |
| **LLM-assisted OCR correction**          | long, external | Container |
| **DOCX master, text sources**            | heavy CPU      | Container |
| **PDF rendering (3 sizes)**              | heavy CPU      | Container |
| **EPUB 3 generation + validation**       | heavy CPU      | Container |
| **Send-to-Kindle delivery**              | SMTP, retries  | Container |

Nothing in the top half is new work to move — the reading path was already
built as bounded request handling. Nothing in the bottom half was a regression
at the time — `services/converter` was always specified as a standalone service
that talks to the application over HTTP and knows nothing about the frontend.

**The bottom half is now empty.** On 2026-08-26 the container was deleted and
the whole pipeline moved into the Worker (`CLAUDE.md` section 13). Every row
that put it there had already changed shape or gone:

| Row | What happened |
|---|---|
| OCR | PaddleOCR deleted; reading a scan is an Adobe HTTP call |
| PDF rendering | deleted outright — nothing renders a PDF (section 11) |
| LLM correction | always an HTTP call; "long" is wall clock, not CPU |
| DOCX master, text sources | parse a zip, write a zip — milliseconds |
| EPUB generation | the same |
| Send-to-Kindle | already moved, over Resend's HTTP API |

The test the table applies is unchanged and still the right one. What the
table got wrong was calling zip-and-XML work "heavy CPU" when the heavy part
was always the OCR model sitting next to it in the same process.

The one row that changed sides did so by changing shape, which is the test
this table applies. Reading a scan and building its master was heavy CPU while
we did it ourselves; on Adobe PDF Services it is one HTTP request and a poll,
so it is I/O and belongs on the Worker (`apps/web/src/lib/masterPipeline.ts`).
It moved once before for the same reason, to Google Document AI on 2026-08-14,
and that only carried the OCR half — Adobe returns the master too, which is
why the DOCX row qualified "text sources": a DOCX or plain text upload still
had its master built by the converter. That was true until the converter was
deleted; it is now built by the Worker, and the measurement above is why.

## What this actually changes

*Written as a plan on 2026-08-12; the port landed the same day. Everything
below is now observed rather than predicted, except where marked.*

**`sharp` comes out.** Payload uses it to resize uploaded images. It is a
native binary and cannot run on a Worker. An *uploaded* cover is therefore
stored at the size it arrives; the container that was one way out is gone, so
what remains is Cloudflare Images or resizing in the browser before the upload.
A *generated* cover is already boxed in the browser by pdf.js, which is the
same answer arrived at from the other end.

**Presigned URLs come out.** The R2 *binding* has no equivalent — presigning is
an S3-API feature — so downloads and the reader stream the object through the
Worker instead of redirecting to a short-lived URL. This turned out to be the
better shape regardless: no credential exists in the environment to be lifted,
and no URL outlives the authorization decision that produced it. Streaming is
I/O, so it stays on the right side of the dividing line above.

**Bindings replace credentials outright.** D1 and R2 arrive as capabilities
granted to this Worker. There is no connection string and no S3 access key
anywhere in the environment. The only secret left is `PAYLOAD_SECRET`, set with
`wrangler secret put`.

**The Payload admin fits, on Workers Paid.** This was the genuine risk in the
whole direction — a Worker script is capped at 10 MB gzipped on Workers Paid,
and Payload's admin UI is a large React application. Measured: **5.9 MB
gzipped**, comfortably inside it.

It does not fit the 3 MB free tier, and staying free was measured rather than
guessed before the plan was bought:

| Build                              | gzipped  | vs 3072 KiB |
| ---------------------------------- | -------- | ----------- |
| Full — frontend + `/api` + `/admin` | 6020 KiB | 196%        |
| Minus `/admin`                     | 4387 KiB | 143%        |
| Frontend only                      | 2691 KiB | 88% — fits  |

The saving is stepwise, not proportional, and the metafile says why. Payload
core — config, collections, lexical, the D1/drizzle adapter — is ~2.1 MB raw,
and Next bundles it **once per runtime entry point**. The full build carries
three byte-identical copies: two route-handler roots and one SSR root. Dropping
`/admin` deletes one copy, dropping `/api` deletes another, and the third is
irreducible because the catalog's server components use Payload's local API.
So the free tier is reachable only by removing *both* the admin and the REST
API — dropping the admin alone still lands 43% over.

That option was rejected at a cost of $5/month. It works (25 of 29 smoke
assertions pass; the 4 failures are the harness driving `/api/users`, which the
site itself never calls — sign-up and login go through server actions). But it
leaves 380 KiB of headroom against a roadmap of Stripe, blogs and Kindle
delivery, each of which grows the surviving config chunk, and it permanently
forecloses a REST API for any future mobile or external client.

**drizzle-kit has to be stubbed out of the bundle.** Payload's Drizzle layer
`require`s it lazily to diff schemas — that is what backs `push: true` and
`migrate:create`. Neither happens at runtime, but a lazy `require` is still a
static edge to a bundler, and the real package carries its own copy of esbuild
and expects a filesystem. `src/lib/drizzle-kit-stub.mjs` replaces it with
functions that throw, so a schema push on the request path would fail loudly
rather than appear to succeed against a production database.

**The toolchain needs a container, for an unrelated reason.** wrangler ships
`workerd`, which needs glibc 2.32+; this host is Ubuntu 20.04 on 2.31. That
takes out `wrangler dev`, the Miniflare behind `getPlatformProxy`, and every
Payload CLI command needing a binding. `apps/web/cf` runs all of it in
`node:22-bookworm`. An irony worth noting: the move that removed the container
from production put one back into development.

**D1 caps a query at 100 bound parameters.** A `where` built from a list of
ids is therefore bounded by the catalog, not by taste, and Payload spends two
parameters per value on a relationship `in`. The admin library page tallied
deliveries with one `in` over every book on the screen; it worked until the
50th book and then answered 500 for every administrator, because 50 ids is 101
parameters. Queries of that shape batch — `MAX_IN_VALUES` in
`lib/adminData.ts` — and a new one keyed on anything that grows must do the
same. An `in` over shelves is safe by size; an `in` over books is not.

**Job handoff needs a queue, not a request** — *superseded on 2026-08-26,
recorded because the reasoning was half right.* The plan was that the Worker
enqueues and returns a job id, a container consumes the queue over Cloudflare
Queues and pushes results to R2 over the S3 API, keeping its own credentials
because it is not a Worker and has no binding, and needing no inbound port —
which sidestepped the filtered outbound 7844 that stalled the tunnel and
blocked NR-28.

What held is that the Worker must not wait for a conversion. What did not is
everything the queue was for: the container it fed was deleted, so no consumer
needs feeding, no S3 credential exists to keep, and the tunnel problem went
with the second tier rather than being sidestepped. A queue would now be a
second durable record beside the book row that can disagree with it, and the
book row is already the durable record of a conversion — so the book's own
state is the queue and a cron tick advances it (`docs/PIPELINE.md`).

## Deliberately not decided yet

Nothing about where a second tier runs, because there is no second tier: the
deployment choice this section was written to leave open was answered by
deleting the thing that had to be deployed.
