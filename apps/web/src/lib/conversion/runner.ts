/**
 * Running a conversion, in the Worker.
 *
 * This is what `services/converter` was until 2026-08-26. The container
 * is gone and the work moved here, which was only possible because the
 * pipeline had already shed everything that needed a machine: PaddleOCR
 * on 2026-08-26 (reading a scan is Adobe's Export PDF, called from
 * `lib/masterPipeline.ts`), and WeasyPrint and LibreOffice with the
 * generated PDF (CLAUDE.md section 11). What was left — parse a DOCX,
 * write an EPUB, talk HTTP — links against nothing.
 *
 * That is also the rule for what may be added back. CLAUDE.md section 3
 * divides work by CPU shape, not importance: a Worker is billed and
 * limited by CPU time, so anything that wants a model, a font stack or a
 * native library does not belong in this file. It belongs behind an HTTP
 * call to something that has them, the way Adobe already is.
 *
 * ## The four jobs
 *
 *     master    source (DOCX or text) → DOCX master
 *     formats   DOCX master           → EPUB
 *     correct   DOCX master           → suggestions, for a person to read
 *     apply     decisions             → a master rewritten from what they adopted
 *
 * A PDF never reaches a `master` job: Adobe returns the master already
 * built and `masterPipeline` attaches it, so the book goes straight to
 * `master_ready`. That is why nothing here reads a PDF, and why deleting
 * PyMuPDF cost nothing.
 *
 * Correction is two jobs rather than one because section 7 says it must
 * be. A single job that read a master and wrote a better one is
 * precisely the silent rewrite that is forbidden; the human decision is
 * what goes between them.
 */

import type { Book } from '../../payload-types'

import config from '@payload-config'
import { getPayload } from 'payload'

import { applySuggestions } from '../../domain/applySuggestions'
import { artifactKey, bookStem, suggestionsKey } from '../../domain/bookStorage'
import {
  type CorrectionJobKind,
  type CorrectionState,
  correctionClaimableAs,
  correctionCompletedState,
  correctionInProgressState,
  correctionStateForMaster,
  readCorrectionState,
  readDecisions,
} from '../../domain/correction'
import { type Document } from '../../domain/document'
import {
  type ConversionState,
  type JobKind,
  completedState,
  inProgressState,
} from '../../domain/pipeline'
import { originalArtifact, readSourceKind } from '../../domain/publication'
import { suggestCorrections } from '../../domain/proofread'
import { readText } from '../../domain/textSource'
import { freeStem } from '../bookObjects'
import { artifactBytes, putObject } from '../storage'
import { logError } from '../logError'
import { readDocx } from './docxRead'
import { buildDocx } from './docxWrite'
import { buildEpub } from './epubWrite'
import { createChatClient, llmConfigFromEnv } from './llm'

type Payload = Awaited<ReturnType<typeof getPayload>>

/**
 * The states a book may be claimed from, in the order they are offered.
 *
 * Phase 2 first. A book waiting on formats has already had money spent
 * reading it and is one step from being readable; a book waiting on a
 * master is not. Draining the near-finished work first is what stops a
 * busy queue accumulating half-built books.
 */
const CLAIMABLE = ['master_ready', 'ocr_ready'] as const

const CONTENT_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
  json: 'application/json',
}

/**
 * The key to write for one slot of one book.
 *
 * **A slot the book already fills keeps its key.** Rebuilding an EPUB
 * after a master edit must overwrite the object the book points at, not
 * file a second one and orphan the first — and it is what keeps every
 * book stored under the old `books/{id}/book/` layout exactly where it
 * is, with nothing migrated and nothing left behind.
 *
 * Only a slot that is empty gets a freshly minted, slug-derived key,
 * checked against the bucket in case a renamed book left an object
 * there (`lib/bookObjects.ts`).
 */
/**
 * The key to write for one slot of one book.
 *
 * **A slot the book already fills keeps its key.** Rebuilding an EPUB
 * after a master edit must overwrite the object the book points at, not
 * file a second one and orphan the first — and it is what keeps every
 * book stored under the old `books/{id}/book/` layout exactly where it
 * is, with nothing migrated and nothing left behind.
 *
 * An empty slot takes the stem's name for that type, with no numbering
 * of its own. The number was settled once, for the whole book, when its
 * first object was filed (`freeStem` in `lib/bookObjects.ts`) — deciding
 * it again here is what would let a book end up as `scan.docx` beside
 * `scan-2.epub`.
 */
function keyFor(wanted: string, current?: string | null): string {
  return typeof current === 'string' && current.length > 0 ? current : wanted
}

/**
 * The stem every one of this book's objects shares.
 *
 * Anchored on what the book has already filed, so it is fixed by the
 * first object written and no later rename can move it. In the ordinary
 * flow that anchor always exists by the time a job runs: the original is
 * filed — and its stem reserved against the bucket — before a book ever
 * reaches a claimable state (`fileOriginal` in `lib/masterPipeline.ts`).
 *
 * A book arriving here with nothing filed is therefore a can't-happen,
 * and is reserved anyway. The failure it would otherwise cause is the
 * one this whole module is careful about — writing over an object
 * belonging to another book, which serves the wrong text under the right
 * title and reports success.
 */
async function stemOf(book: Book): Promise<string> {
  const filed = (book.artifacts ?? []).some(
    (artifact) => typeof artifact.storageKey === 'string' && artifact.storageKey.length > 0,
  )
  const wanted = bookStem({
    artifacts: book.artifacts,
    sourceFilename: book.conversion?.sourceFilename,
    preferred: originalArtifact(readSourceKind(book.conversion ?? {})),
  })
  if (filed) return wanted
  return freeStem({ wanted, owned: [] })
}

/** The key this book already records for one artifact format, if any. */
function currentKey(book: Book, format: 'docx' | 'epub'): string | null {
  return (book.artifacts ?? []).find((artifact) => artifact.format === format)?.storageKey ?? null
}

/** What one tick did, for the log and for the tests. */
export interface TickResult {
  claimed: 'conversion' | 'correction' | null
  bookId?: number
  kind?: JobKind | CorrectionJobKind
  outcome?: 'completed' | 'failed'
  message?: string
}

/**
 * Claim one book with a compare-and-swap.
 *
 * Conditional on the book still being in the state we found it in, so
 * two overlapping ticks cannot both take it. D1 has no row locking, and
 * a plain read-then-write would run the same job twice — which for a
 * `correct` job means paying a third party twice for the same book.
 *
 * Cron triggers do overlap in practice: a tick that runs long is not
 * cancelled when the next one fires.
 */
async function claim(
  payload: Payload,
  book: Book,
  from: ConversionState,
  to: ConversionState,
): Promise<boolean> {
  const claimed = await payload.update({
    collection: 'books',
    where: { and: [{ id: { equals: book.id } }, { 'conversion.state': { equals: from } }] },
    data: { conversion: { ...book.conversion, state: to } },
    overrideAccess: true,
  })
  return claimed.docs.length > 0
}

async function claimCorrection(
  payload: Payload,
  book: Book,
  from: CorrectionState,
  to: CorrectionState,
): Promise<boolean> {
  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const correction = (conversion.correction ?? {}) as Record<string, unknown>
  const claimed = await payload.update({
    collection: 'books',
    where: {
      and: [{ id: { equals: book.id } }, { 'conversion.correction.state': { equals: from } }],
    },
    data: { conversion: { ...conversion, correction: { ...correction, state: to } } },
    overrideAccess: true,
  })
  return claimed.docs.length > 0
}

function masterKeyOf(book: Book): string | null {
  return (book.artifacts ?? []).find((a) => a.format === 'docx')?.storageKey ?? null
}

async function fetchDocument(key: string, title: string, author: string | null): Promise<Document> {
  const bytes = await artifactBytes(key)
  if (!bytes) throw new Error(`the master at ${key} is not in storage`)
  const document = readDocx(bytes, title)
  // The book's own metadata wins over whatever the file claims: the
  // uploader confirmed it on the details form, and the file may never
  // have carried it at all.
  document.title = title
  document.author = author ?? document.author
  return document
}

// ---------------------------------------------------------------------------
// Phase 1 — build the master
// ---------------------------------------------------------------------------

/**
 * Deliberately produces nothing else. The master is the source of truth
 * (CLAUDE.md section 5) and it may be corrected before any reader-facing
 * format is generated — so generating formats here would be building
 * them from text nobody has looked at yet.
 */
async function runMaster(payload: Payload, book: Book): Promise<TickResult> {
  const bookId = Number(book.id)
  const sourceKey = book.conversion?.sourceKey
  if (!sourceKey) throw new Error('this book has no uploaded source to read')

  const bytes = await artifactBytes(sourceKey)
  if (!bytes) throw new Error(`the source at ${sourceKey} is not in storage`)

  const kind = readSourceKind(book.conversion ?? {})
  let document: Document
  if (kind === 'docx') {
    document = readDocx(bytes, book.title)
  } else if (kind === 'text') {
    // Strict rather than lenient: a mis-encoded file must fail here, not
    // become mojibake in a published book.
    document = readText(new TextDecoder('utf-8', { fatal: true }).decode(bytes), book.title)
  } else {
    // A PDF's master comes back from Adobe already built, and an EPUB is
    // already the edition. Neither should ever have been queued for one.
    throw new Error(`a ${kind} source does not need a master built`)
  }
  document.author = book.author ?? document.author

  const key = keyFor(artifactKey(await stemOf(book), 'docx'), currentKey(book, 'docx'))
  if (!(await putObject(key, buildDocx(document, book.author), CONTENT_TYPES.docx))) {
    throw new Error('object storage is not configured')
  }

  const existing = book.artifacts ?? []
  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      artifacts: [...existing.filter((a) => a.format !== 'docx'), { format: 'docx', storageKey: key }],
      conversion: {
        ...book.conversion,
        state: completedState('master'),
        message: null,
        // Phase 1 finishing is the moment a built master exists, so it
        // is the moment correction has something to read.
        correction: {
          ...((book.conversion?.correction ?? {}) as object),
          state: correctionStateForMaster(book.conversion?.aiCorrection),
        },
      },
      // Not published: a DOCX master is not a readable edition.
    },
    overrideAccess: true,
  })

  return { claimed: 'conversion', bookId, kind: 'master', outcome: 'completed' }
}

// ---------------------------------------------------------------------------
// Phase 2 — build the reading edition
// ---------------------------------------------------------------------------

/**
 * Reads the DOCX and nothing else. That is the rule the whole two-phase
 * split exists to enforce — formats are generated from the *approved*
 * master, so reading the original source here would silently discard
 * every correction that was made.
 */
async function runFormats(payload: Payload, book: Book): Promise<TickResult> {
  const bookId = Number(book.id)
  const masterKey = masterKeyOf(book)
  if (!masterKey) throw new Error('this book has no DOCX master to build from')

  const document = await fetchDocument(masterKey, book.title, book.author ?? null)

  const key = keyFor(artifactKey(await stemOf(book), 'epub'), currentKey(book, 'epub'))
  const epub = buildEpub(document, { identifier: `noblesee-${bookId}` })
  if (!(await putObject(key, epub, CONTENT_TYPES.epub))) {
    throw new Error('object storage is not configured')
  }

  const existing = book.artifacts ?? []
  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      artifacts: [...existing.filter((a) => a.format !== 'epub'), { format: 'epub', storageKey: key }],
      conversion: { ...book.conversion, state: completedState('formats'), message: null },
      // Only once a reader can actually read it.
      //
      // Published here still means private to its owner: publishing to
      // the library is a separate act needing an administrator and a
      // rights status that permits it — a finished conversion is not
      // consent.
      status: 'published' as const,
    },
    overrideAccess: true,
  })

  return { claimed: 'conversion', bookId, kind: 'formats', outcome: 'completed' }
}

// ---------------------------------------------------------------------------
// Correction — not a phase, and deliberately on its own state field
// ---------------------------------------------------------------------------

async function runCorrect(payload: Payload, book: Book, env: Record<string, unknown>) {
  const bookId = Number(book.id)
  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const correction = (conversion.correction ?? {}) as Record<string, unknown>

  // Consent is re-read at the moment of sending rather than trusted from
  // when the state was set. A reader who changes their mind between the
  // two must not have their book sent.
  if (book.conversion?.aiCorrection !== true) {
    throw new Error('this book has not been offered for third-party AI correction')
  }

  const masterKey = masterKeyOf(book)
  if (!masterKey) throw new Error('this book has no DOCX master to read')

  const document = await fetchDocument(masterKey, book.title, book.author ?? null)
  const client = createChatClient(llmConfigFromEnv(env))
  const report = await suggestCorrections(document, client.complete, { model: client.model })

  const key = keyFor(
    suggestionsKey(await stemOf(book)),
    book.conversion?.correction?.suggestionsKey,
  )
  const body = JSON.stringify({
    model: report.model,
    batches: report.batches,
    lines_examined: report.linesExamined,
    suggestions: report.suggestions,
    // A stage that silently discards what the model said is as
    // unauditable as one that silently applies it.
    rejected: report.rejected,
  })
  if (!(await putObject(key, new TextEncoder().encode(body), CONTENT_TYPES.json))) {
    throw new Error('object storage is not configured')
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
          count: report.suggestions.length,
          // Cleared: these belong to the pass that has just been
          // superseded, and leaving them would have the book page offer
          // decisions about suggestions nobody made.
          decisionsKey: null,
          adopted: null,
          message: null,
        },
      },
    },
    overrideAccess: true,
  })

  return {
    claimed: 'correction' as const,
    bookId,
    kind: 'correct' as const,
    outcome: 'completed' as const,
  }
}

/**
 * Rewrite the master from what the reader adopted.
 *
 * An ordinary master edit: the book returns to `master_ready` and the
 * reading edition is rebuilt from the corrected text by the path any
 * corrected master takes.
 */
async function runApply(payload: Payload, book: Book): Promise<TickResult> {
  const bookId = Number(book.id)
  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const correction = (conversion.correction ?? {}) as Record<string, unknown>

  const decisionsKey = correction.decisionsKey
  if (typeof decisionsKey !== 'string') throw new Error('there are no decisions to apply')

  const masterKey = masterKeyOf(book)
  if (!masterKey) throw new Error('this book has no DOCX master to correct')

  const raw = await artifactBytes(decisionsKey)
  if (!raw) throw new Error(`the decisions at ${decisionsKey} are not in storage`)
  const decisions = readDecisions(JSON.parse(new TextDecoder().decode(raw)))

  const document = await fetchDocument(masterKey, book.title, book.author ?? null)
  const report = applySuggestions(document, decisions)

  // Nothing adopted, or every adopted line had drifted. The master is
  // already what it should be, so only the correction state moves —
  // sending the book back to `master_ready` over an empty apply would
  // rebuild an EPUB that is already correct.
  const wrote = report.applied.length > 0
  if (wrote) {
    const key = keyFor(artifactKey(await stemOf(book), 'docx'), currentKey(book, 'docx'))
    if (!(await putObject(key, buildDocx(document, book.author), CONTENT_TYPES.docx))) {
      throw new Error('object storage is not configured')
    }
  }

  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      conversion: {
        ...conversion,
        ...(wrote ? { state: 'master_ready' as const } : {}),
        correction: {
          ...correction,
          state: correctionCompletedState('apply'),
          adopted: report.applied.length,
          message: null,
        },
      },
    },
    overrideAccess: true,
  })

  return { claimed: 'correction', bookId, kind: 'apply', outcome: 'completed' }
}

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

async function failConversion(payload: Payload, book: Book, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 500) : 'The conversion did not complete.'
  await payload.update({
    collection: 'books',
    id: Number(book.id),
    data: { conversion: { ...book.conversion, state: 'failed', message } },
    overrideAccess: true,
  })
  return message
}

async function failCorrection(payload: Payload, book: Book, error: unknown) {
  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const correction = (conversion.correction ?? {}) as Record<string, unknown>
  const message = error instanceof Error ? error.message.slice(0, 500) : 'The correction did not complete.'
  await payload.update({
    collection: 'books',
    id: Number(book.id),
    data: {
      conversion: { ...conversion, correction: { ...correction, state: 'failed', message } },
    },
    overrideAccess: true,
  })
  return message
}

// ---------------------------------------------------------------------------
// One unit of work
// ---------------------------------------------------------------------------

/**
 * Claim and run at most one job.
 *
 * One per tick, deliberately. A cron invocation has a bounded CPU
 * budget, and a loop that kept claiming would spend it all on whichever
 * book happened to be first and then be killed mid-write. One book per
 * minute is also faster than the container ever was in practice, since
 * nothing was polling for most of the day.
 */
export async function runOneJob(env: Record<string, unknown>): Promise<TickResult> {
  const payload = await getPayload({ config })

  // Conversion first: a book that cannot be read yet is more urgent
  // than an improvement to one that can.
  for (const state of CLAIMABLE) {
    const waiting = await payload.find({
      collection: 'books',
      where: { 'conversion.state': { equals: state } },
      sort: 'createdAt',
      limit: 10,
      depth: 0,
      overrideAccess: true,
    })

    for (const book of waiting.docs) {
      const kind: JobKind = state === 'master_ready' ? 'formats' : 'master'
      if (!(await claim(payload, book, state, inProgressState(kind)))) continue

      try {
        return kind === 'master' ? await runMaster(payload, book) : await runFormats(payload, book)
      } catch (error) {
        logError(`conversion: ${kind} job for book ${book.id}`, error)
        const message = await failConversion(payload, book, error)
        return { claimed: 'conversion', bookId: Number(book.id), kind, outcome: 'failed', message }
      }
    }
  }

  // Correction, which is not a phase and deliberately queues separately.
  // Offered last: a book waiting on formats is one step from being
  // readable, while correction is an improvement to a book that already
  // is.
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
      if (!masterKeyOf(book)) continue
      if (!(await claimCorrection(payload, book, state, correctionInProgressState(kind)))) continue

      try {
        return kind === 'correct'
          ? await runCorrect(payload, book, env)
          : await runApply(payload, book)
      } catch (error) {
        logError(`correction: ${kind} job for book ${book.id}`, error)
        const message = await failCorrection(payload, book, error)
        return { claimed: 'correction', bookId: Number(book.id), kind, outcome: 'failed', message }
      }
    }
  }

  return { claimed: null }
}
