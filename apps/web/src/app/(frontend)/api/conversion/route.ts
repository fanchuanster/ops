/**
 * The handoff between the web application and the converter.
 *
 * The converter has no inbound port — that is what makes it deployable
 * behind a filtered egress, and CLAUDE.md treats it as a constraint
 * rather than an accident. So the converter *pulls*: it asks this
 * endpoint for the next queued book, does the work, and reports back.
 *
 * CLAUDE.md section 13 specifies Cloudflare Queues for this hop. A pull
 * consumer against Queues would be the same shape — the converter
 * polling an HTTP endpoint — with a queue to provision, a second place
 * for the job list to disagree with the Book row, and no way to express
 * "claim this one and mark it converting" atomically. The Book row is
 * already the durable record of a conversion, so this asks it directly.
 * Swapping in Queues later means replacing this file and the poller;
 * nothing else knows.
 *
 * ## Authentication
 *
 * A shared secret in `CONVERTER_SECRET`, compared in constant time.
 * These endpoints attach artifacts to books, so anyone who can call
 * them can publish arbitrary files into the library.
 *
 * **Fail closed**: with no secret configured the routes 404 as though
 * they do not exist. That is deliberate — it means deploying the Worker
 * before the secret is set leaves nothing exposed, and a secret that is
 * accidentally cleared disables the handoff rather than opening it.
 */

import config from '@payload-config'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

/** Formats the converter may attach, and nothing else. */
const ALLOWED_FORMATS = new Set(['docx', 'epub', 'pdf_standard', 'pdf_large', 'pdf_xl'])

async function converterSecret(): Promise<string | null> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    const secret = (env as { CONVERTER_SECRET?: string }).CONVERTER_SECRET
    return secret && secret.length >= 16 ? secret : null
  } catch {
    return null
  }
}

/**
 * Length-independent, timing-safe comparison.
 *
 * `===` on secrets leaks their prefix through response timing. The
 * lengths are hashed first so the comparison itself is fixed-width
 * whatever the caller sends.
 */
async function matches(presented: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(presented)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i += 1) diff |= x[i]! ^ y[i]!
  return diff === 0
}

async function authorize(request: Request): Promise<Response | null> {
  const expected = await converterSecret()
  // Not configured: the endpoint does not exist.
  if (!expected) return new NextResponse(null, { status: 404 })

  const header = request.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!presented || !(await matches(presented, expected))) {
    return new NextResponse(null, { status: 401 })
  }
  return null
}

/**
 * Claim the next queued conversion.
 *
 * The claim is a compare-and-swap: the update is conditional on the
 * book still being `queued`, so two converters polling at once cannot
 * both take the same book. D1 has no row locking, and a plain
 * read-then-write would hand the same job to both.
 */
export async function GET(request: Request) {
  const refusal = await authorize(request)
  if (refusal) return refusal

  const payload = await getPayload({ config })

  const queued = await payload.find({
    collection: 'books',
    where: { 'conversion.state': { equals: 'queued' } },
    sort: 'createdAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const book = queued.docs[0]
  if (!book) return NextResponse.json({ job: null })

  const claimed = await payload.update({
    collection: 'books',
    where: {
      and: [{ id: { equals: book.id } }, { 'conversion.state': { equals: 'queued' } }],
    },
    data: { conversion: { ...book.conversion, state: 'converting' } },
    overrideAccess: true,
  })

  // Lost the race to another converter. Returning null rather than
  // retrying keeps this handler bounded; the poller comes back shortly.
  if (claimed.docs.length === 0) return NextResponse.json({ job: null })

  return NextResponse.json({
    job: {
      job_id: book.conversion?.jobId ?? String(book.id),
      book_id: String(book.id),
      source_key: book.conversion?.sourceKey,
      title: book.title,
      author: book.author ?? null,
      // Never true for a reader's upload. Every book that reaches this
      // endpoint is one, so this is a constant rather than a field —
      // making it configurable here would be making it possible to get
      // wrong (CLAUDE.md section 6.1).
      allow_third_party_ai: false,
    },
  })
}

interface CompletionBody {
  book_id?: unknown
  state?: unknown
  page_count?: unknown
  message?: unknown
  artifacts?: unknown
}

/** Report a conversion finished, or failed. */
export async function POST(request: Request) {
  const refusal = await authorize(request)
  if (refusal) return refusal

  let body: CompletionBody
  try {
    body = (await request.json()) as CompletionBody
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  const bookId = Number(body.book_id)
  if (!Number.isInteger(bookId)) {
    return NextResponse.json({ error: 'book_id is required.' }, { status: 400 })
  }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!book) return NextResponse.json({ error: 'No such book.' }, { status: 404 })

  if (body.state === 'failed') {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        conversion: {
          ...book.conversion,
          state: 'failed',
          message:
            typeof body.message === 'string'
              ? body.message.slice(0, 500)
              : 'The conversion did not complete.',
        },
      },
      overrideAccess: true,
    })
    return NextResponse.json({ ok: true })
  }

  // Only keys the converter is allowed to attach, and only under the
  // book's own prefix. A converter that has been tampered with must not
  // be able to point a book's artifacts at another book's files.
  const prefix = `books/${bookId}/`
  const artifacts = Object.entries((body.artifacts ?? {}) as Record<string, unknown>)
    .filter(
      ([format, key]) =>
        ALLOWED_FORMATS.has(format) && typeof key === 'string' && key.startsWith(prefix),
    )
    .map(([format, key]) => ({
      format: format as 'epub',
      storageKey: key as string,
      // The DOCX master is the editorial source of truth, never a
      // reader download.
      downloadable: format !== 'docx',
    }))

  if (artifacts.length === 0) {
    return NextResponse.json({ error: 'No usable artifacts.' }, { status: 400 })
  }

  const pageCount = Number(body.page_count)

  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      artifacts,
      // The price derives from this in a collection hook, so setting it
      // is what prices the book.
      ...(Number.isFinite(pageCount) && pageCount > 0 ? { pageCount } : {}),
      conversion: { ...book.conversion, state: 'ready', message: null },
      // Readable now, and still private to its owner. Publishing to the
      // library is a separate act needing an administrator and a rights
      // status that permits it — a finished conversion is not consent.
      status: 'published',
    },
    overrideAccess: true,
  })

  return NextResponse.json({ ok: true })
}
