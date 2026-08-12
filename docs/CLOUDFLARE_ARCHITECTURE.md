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
| Download authorization + signed URLs     | I/O            | Worker    |
| Streaming an EPUB to the reader          | I/O            | Worker    |
| Payload admin / editorial                | render         | Worker    |
| **OCR of scanned pages**                 | heavy CPU, GPU | Container |
| **LLM-assisted OCR correction**          | long, external | Container |
| **DOCX generation**                      | heavy CPU      | Container |
| **PDF rendering (3 sizes)**              | heavy CPU      | Container |
| **EPUB 3 generation + validation**       | heavy CPU      | Container |
| **Send-to-Kindle delivery**              | SMTP, retries  | Container |

Nothing in the top half is new work to move — the reading path was already
built as bounded request handling. Nothing in the bottom half is a regression —
`services/converter` was always specified as a standalone service that talks to
the application over HTTP and knows nothing about the frontend.

## What this actually changes

**`sharp` comes out.** Payload uses it to resize uploaded images. It is a
native binary and cannot run on a Worker. Cover-image processing therefore
either moves to the converter container or uses Cloudflare Images. Until one of
those lands, covers are stored at the size they are uploaded.

**Job handoff needs a queue, not a request.** The Worker must not wait for a
conversion. It enqueues and returns a job id; the container consumes the queue
and writes results back to R2 and D1. Cloudflare Queues is the native fit and
keeps the Worker's side of the handoff to a single bounded write.

**The container needs no inbound port.** It pulls from the queue and pushes
results to R2 over the S3 API. That matters here specifically: this host's
outbound 7844 is filtered and inbound exposure was never available, which is
what stalled the tunnel. A pull-based worker sidesteps the problem that blocked
NR-28 rather than inheriting it.

## Deliberately not decided yet

Where the container runs — this host, Cloudflare Containers, or somewhere else
— is left open. It is a deployment choice, and the queue boundary above means
it can be answered later without touching application code.
