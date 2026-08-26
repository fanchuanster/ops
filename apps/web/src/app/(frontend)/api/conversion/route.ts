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

import type { Book } from '../../../../payload-types'

import config from '@payload-config'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import { acceptArtifacts, acceptPageCount } from '../../../../domain/conversion'
import {
  IN_FLIGHT_STATES,
  claimFor,
  completedState,
  inProgressState,
} from '../../../../domain/pipeline'
import {
  type CorrectionJobKind,
  correctionClaimableAs,
  correctionCompletedState,
  correctionInProgressState,
  correctionStateForMaster,
  readCorrectionState,
} from '../../../../domain/correction'
import { readSourceKind } from '../../../../domain/publication'
import { advanceMasterPipeline } from '../../../../lib/masterPipeline'
import { logError } from '../../../../lib/logError'

export const dynamic = 'force-dynamic'

/**
 * The states a converter may claim from, in the order they are offered.
 *
 * Phase 2 first. A book waiting on formats has already had money spent
 * on its OCR and is one step from being readable; a book waiting on a
 * master is not. Draining the near-finished work first is what stops a
 * busy queue from accumulating half-built books.
 */
const CLAIMABLE = ['master_ready', 'ocr_ready'] as const

async function converterSecret(): Promise<string | null> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    const secret = (env as { CONVERTER_SECRET?: string }).CONVERTER_SECRET
    return secret && secret.length >= 16 ? secret : null
  } catch {
    // Not logged. This throws on every request that runs without
    // Cloudflare bindings, which is how a local process discovers it
    // has none — control flow, not a failure.
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

  // The converter's poll is the pipeline's clock. Nothing schedules
  // phase 1 — no cron, no queue consumer — so this is where a queued
  // book gets submitted to Adobe and a finished export gets collected.
  // Bounded to one step, and it never throws: failing to advance phase 1
  // must not stop a converter being handed work it could already do.
  await advanceMasterPipeline(payload)

  for (const state of CLAIMABLE) {
    // More than one, so a lost claim race falls through to the next book
    // rather than ending the poll empty-handed.
    const waiting = await payload.find({
      collection: 'books',
      where: { 'conversion.state': { equals: state } },
      sort: 'createdAt',
      limit: 10,
      depth: 0,
      overrideAccess: true,
    })

    for (const book of waiting.docs) {
      const conversion = (book.conversion ?? {}) as Record<string, unknown>

      // What this book needs built, decided in the domain layer.
      const work = claimFor({
        state,
        sourceKind: readSourceKind(conversion),
        existingFormats: (book.artifacts ?? []).map((artifact) => artifact.format),
      })
      if (!work) continue

      const { kind, formats } = work

      // The claim is a compare-and-swap: conditional on the book still
      // being in the state we found it in, so two converters polling at
      // once cannot both take it. D1 has no row locking, and a plain
      // read-then-write would hand the same book to both.
      const claimed = await payload.update({
        collection: 'books',
        where: {
          and: [{ id: { equals: book.id } }, { 'conversion.state': { equals: state } }],
        },
        data: { conversion: { ...book.conversion, state: inProgressState(kind) } },
        overrideAccess: true,
      })

      // Lost the race. Move on rather than retrying — the poller comes
      // back shortly, and retrying here makes the handler unbounded.
      if (claimed.docs.length === 0) continue

      return NextResponse.json({
        job: {
          job_id: book.conversion?.jobId ?? String(book.id),
          book_id: String(book.id),
          // What the converter is being asked to do. Phase 1 builds the
          // DOCX master from the uploaded original; phase 2 builds reader
          // formats from that master. See domain/pipeline.ts.
          kind,
          // Which formats phase 2 should produce. Empty for phase 1.
          // Sent explicitly rather than left to the converter's
          // judgement: what a book needs depends on what it already has
          // and what a reader asked for, and only this side knows both.
          formats,
          // Phase 1 reads the uploaded original. Only sources that needed
          // no export reach a `master` job at all — a DOCX or a text file
          // — because a PDF's master comes back from Adobe already built
          // (`lib/masterPipeline.ts`).
          source_key: book.conversion?.sourceKey,
          // Phase 2 reads the master, which phase 1 attached.
          master_key:
            (book.artifacts ?? []).find((artifact) => artifact.format === 'docx')?.storageKey ??
            null,
          title: book.title,
          author: book.author ?? null,
          // The uploader's own answer, and nobody else's. It was a
          // hard-coded `false` until 2026-08-26, under a rule that
          // forbade sending a reader's upload to a third party at all;
          // that rule is gone and this is what replaced it — a question
          // asked on the details form, disclosed in the same breath
          // (CLAUDE.md section 6.1).
          //
          // `=== true` rather than a cast: an absent or null column on a
          // book uploaded before the question existed must read as no.
          allow_third_party_ai: book.conversion?.aiCorrection === true,
        },
      })
    }
  }

  // Correction, which is not a phase and deliberately queues separately.
  // Offered last: a book waiting on formats is one step from being
  // readable, while correction is an improvement to a book that already
  // is. See domain/correction.ts for why this is not a conversion state.
  for (const state of ['decided', 'pending'] as const) {
    const waiting = await payload.find({
      collection: 'books',
      where: { 'conversion.correction.state': { equals: state } },
      sort: 'createdAt',
      limit: 10,
      depth: 0,
      overrideAccess: true,
    })

    for (const book of waiting.docs) {
      const correction = (book.conversion?.correction ?? {}) as Record<string, unknown>
      const kind = correctionClaimableAs(readCorrectionState(correction.state))
      if (!kind) continue

      const masterKey = (book.artifacts ?? []).find((a) => a.format === 'docx')?.storageKey
      // No master, nothing to read. Can happen if the master was
      // detached between the state being set and this poll.
      if (!masterKey) continue

      // Consent is re-read here rather than trusted from when the state
      // was set. An uploader who has since unticked the box must not
      // have their book sent because a job was already queued.
      if (book.conversion?.aiCorrection !== true) continue

      const claimed = await payload.update({
        collection: 'books',
        where: {
          and: [
            { id: { equals: book.id } },
            { 'conversion.correction.state': { equals: state } },
          ],
        },
        data: {
          conversion: {
            ...book.conversion,
            correction: { ...correction, state: correctionInProgressState(kind) },
          },
        },
        overrideAccess: true,
      })
      if (claimed.docs.length === 0) continue

      return NextResponse.json({
        job: {
          job_id: book.conversion?.jobId ?? String(book.id),
          book_id: String(book.id),
          kind,
          formats: [],
          master_key: masterKey,
          // Only an `apply` job has these; a `correct` job derives where
          // to write from the book id.
          decisions_key: correction.decisionsKey ?? null,
          suggestions_key: correction.suggestionsKey ?? null,
          title: book.title,
          author: book.author ?? null,
          allow_third_party_ai: true,
        },
      })
    }
  }

  // Nothing to build. Covers are deliberately absent from this queue
  // since 2026-08-25: they are rendered in the browser that has the
  // file open (`lib/client/coverImages.ts`), which is what a picture of
  // page one always should have been. Every book in the library had no
  // cover because a converter claimed each one and never reported, and
  // only `pending` is ever re-offered.
  return NextResponse.json({ job: null })
}

interface CompletionBody {
  book_id?: unknown
  kind?: unknown
  state?: unknown
  page_count?: unknown
  message?: unknown
  artifacts?: unknown
  suggestions_key?: unknown
  suggestion_count?: unknown
}

/**
 * Where the converter is allowed to say it put the suggestions.
 *
 * Under this book's own prefix and nowhere else — the same containment
 * rule `acceptArtifacts` applies to artifacts, for the same reason. The
 * key is handed straight to R2 by a route that has already decided the
 * caller may read this book, so an unchecked key would read any object
 * in the bucket.
 */
function acceptSuggestionsKey(bookId: number, value: unknown): string | null {
  if (typeof value !== 'string') return null
  const prefix = `books/${bookId}/book/`
  if (!value.startsWith(prefix) || value.includes('..')) return null
  return value
}

/**
 * Report a correction job finished, or failed.
 *
 * Kept apart from the conversion report above because the two mean
 * different things about the book. A conversion completing can publish
 * it; a correction completing never can — the most it does is attach a
 * corrected master, which puts the book back through phase 2 by the
 * ordinary master-edit path rather than by anything special here.
 */
async function reportCorrection(
  payload: Awaited<ReturnType<typeof getPayload>>,
  book: Book,
  bookId: number,
  body: CompletionBody,
  kind: CorrectionJobKind,
) {
  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const correction = (conversion.correction ?? {}) as Record<string, unknown>

  if (body.state === 'failed') {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        conversion: {
          ...conversion,
          correction: {
            ...correction,
            state: 'failed',
            message:
              typeof body.message === 'string'
                ? body.message.slice(0, 500)
                : 'The correction did not complete.',
          },
        },
      },
      overrideAccess: true,
    })
    return NextResponse.json({ ok: true })
  }

  if (kind === 'correct') {
    const key = acceptSuggestionsKey(bookId, body.suggestions_key)
    if (!key) {
      return NextResponse.json({ error: 'No usable suggestions key.' }, { status: 400 })
    }
    await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        conversion: {
          ...conversion,
          correction: {
            ...correction,
            state: correctionCompletedState('correct'),
            suggestionsKey: key,
            count:
              typeof body.suggestion_count === 'number' &&
              Number.isInteger(body.suggestion_count)
                ? body.suggestion_count
                : null,
            // Cleared: these belong to the pass that has just been
            // superseded, and leaving them would have the book page
            // offer decisions about suggestions nobody made.
            decisionsKey: null,
            adopted: null,
            message: null,
          },
        },
      },
      overrideAccess: true,
    })
    return NextResponse.json({ ok: true })
  }

  // `apply`. The corrected master arrives as an ordinary artifact, and
  // is attached by exactly the path a re-uploaded master takes: the book
  // returns to `master_ready` and phase 2 rebuilds the reading edition
  // from the corrected text.
  const artifacts = acceptArtifacts({ bookId, artifacts: body.artifacts })
  const master = artifacts.find((artifact) => artifact.format === 'docx')

  // No master reported is a real outcome rather than a failure: nothing
  // was adopted, or every adopted line had drifted. The master is
  // already what it should be, so only the correction state moves.
  const existing = book.artifacts ?? []
  const merged = master ? [...existing.filter((old) => old.format !== 'docx'), master] : existing

  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      ...(master ? { artifacts: merged } : {}),
      conversion: {
        ...conversion,
        // Only when there is something to rebuild from. Sending a book
        // back to `master_ready` over an empty apply would rebuild an
        // EPUB that is already correct.
        ...(master ? { state: 'master_ready' as const } : {}),
        correction: {
          ...correction,
          state: correctionCompletedState('apply'),
          message: null,
        },
      },
    },
    overrideAccess: true,
  })
  return NextResponse.json({ ok: true })
}


/** Report a conversion finished, or failed. */
export async function POST(request: Request) {
  const refusal = await authorize(request)
  if (refusal) return refusal

  let body: CompletionBody
  try {
    body = (await request.json()) as CompletionBody
  } catch (error) {
    // The only caller is our own converter, so malformed JSON here is
    // our bug rather than a stranger's probe.
    logError('conversion: parse completion body', error)
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

  // Correction is not a phase and does not touch `conversion.state` at
  // all — it reports against its own field and returns. Handled before
  // the phase logic so a correction report can never be mistaken for a
  // conversion one, which would publish or fail a book over a proposal.
  if (body.kind === 'correct' || body.kind === 'apply') {
    return await reportCorrection(payload, book, bookId, body, body.kind)
  }

  // Which phase finished. Defaulted to 'formats' so a converter that
  // predates the two-phase split still lands a book on 'ready' rather
  // than stalling it in a state it will never report again.
  const kind = body.kind === 'master' ? 'master' : ('formats' as const)

  // A `cover` completion from an older converter lands here and is read
  // as `formats`, which would publish or fail a book over a picture —
  // so it is refused outright. Covers left this endpoint on 2026-08-25.
  if (body.kind === 'cover') {
    return NextResponse.json({ error: 'Covers are not converted here.' }, { status: 410 })
  }

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

  // What the converter may attach, and only under this book's own
  // prefix. Decided in the domain layer so the containment rule is
  // testable without an HTTP request — domain/conversion.ts.
  const artifacts = acceptArtifacts({ bookId, artifacts: body.artifacts })
  if (artifacts.length === 0) {
    return NextResponse.json({ error: 'No usable artifacts.' }, { status: 400 })
  }

  // Phase 1's whole output is the master. Without it there is nothing
  // for phase 2 to read, and moving the book on would queue a rebuild
  // from a file that does not exist.
  if (kind === 'master' && !artifacts.some((artifact) => artifact.format === 'docx')) {
    return NextResponse.json({ error: 'No DOCX master was reported.' }, { status: 400 })
  }

  const pageCount = acceptPageCount(body.page_count)

  // Phase 1 attaches the master to a book that has no formats yet;
  // phase 2 replaces the formats of a book that already has a master.
  // Merging rather than overwriting is what keeps the master attached
  // across a rebuild — and what lets phase 2 run again after an edit
  // without phase 1 running too.
  const existing = book.artifacts ?? []
  const merged = [
    ...existing.filter((old) => !artifacts.some((fresh) => fresh.format === old.format)),
    ...artifacts,
  ]

  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      artifacts: merged,
      // The price derives from this in a collection hook, so setting it
      // is what prices the book. Null leaves whatever is there, which
      // for a new book means the minimum — the right way to fail.
      ...(pageCount === null ? {} : { pageCount }),
      conversion: {
        ...book.conversion,
        state: completedState(kind),
        message: null,
        // Phase 1 finishing is the moment a converter-built master
        // exists, so it is the moment correction has something to read.
        // Phase 2 leaves the field alone: it rebuilds the EPUB and does
        // not touch the master.
        ...(kind === 'master'
          ? {
              correction: {
                ...((book.conversion?.correction ?? {}) as object),
                state: correctionStateForMaster(book.conversion?.aiCorrection),
              },
            }
          : {}),
        // Whatever was asked for has now been built. Cleared on phase 2
        // only: a phase 1 completion has not touched the formats, and
        // clearing here would silently drop a request made while the
        // master was being rebuilt.
      },
      // Only once a reader can actually read it. A DOCX master is not a
      // readable edition, so phase 1 finishing does not publish
      // anything.
      //
      // Published here still means private to its owner: publishing to
      // the library is a separate act needing an administrator and a
      // rights status that permits it — a finished conversion is not
      // consent.
      ...(kind === 'formats' ? { status: 'published' as const } : {}),
    },
    overrideAccess: true,
  })

  return NextResponse.json({ ok: true })
}
