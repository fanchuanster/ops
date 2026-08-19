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
built as bounded request handling. Nothing in the bottom half is a regression —
`services/converter` was always specified as a standalone service that talks to
the application over HTTP and knows nothing about the frontend.

The one row that changed sides did so by changing shape, which is the test
this table applies. Reading a scan and building its master was heavy CPU while
we did it ourselves; on Adobe PDF Services it is one HTTP request and a poll,
so it is I/O and belongs on the Worker (`apps/web/src/lib/masterPipeline.ts`).
It moved once before for the same reason, to Google Document AI on 2026-08-14,
and that only carried the OCR half — Adobe returns the master too, which is
why the DOCX row now qualifies "text sources": a DOCX or plain text upload
still has its master built by the converter, because that is still compute.

## What this actually changes

*Written as a plan on 2026-08-12; the port landed the same day. Everything
below is now observed rather than predicted, except where marked.*

**`sharp` comes out.** Payload uses it to resize uploaded images. It is a
native binary and cannot run on a Worker. Cover-image processing therefore
either moves to the converter container or uses Cloudflare Images. Until one of
those lands, covers are stored at the size they are uploaded.

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

**Job handoff needs a queue, not a request.** The Worker must not wait for a
conversion. It enqueues and returns a job id; the container consumes the queue
and writes results back to R2 and D1. Cloudflare Queues is the native fit and
keeps the Worker's side of the handoff to a single bounded write.

**The container needs no inbound port.** It pulls from the queue and pushes
results to R2 over the S3 API — the converter keeps S3 credentials precisely
because it is not a Worker and has no binding. That matters here specifically:
this host's outbound 7844 is filtered and inbound exposure was never available,
which is what stalled the tunnel. A pull-based worker sidesteps the problem that
blocked NR-28 rather than inheriting it. *(Still a plan; the queue is not built.)*

## Deliberately not decided yet

Where the container runs — this host, Cloudflare Containers, or somewhere else
— is left open. It is a deployment choice, and the queue boundary above means
it can be answered later without touching application code.
