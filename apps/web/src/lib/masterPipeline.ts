/**
 * Driving phase 1.
 *
 * The web application owns this stage because Adobe's Export PDF is an
 * HTTP call: a Worker is billed for CPU, and waiting on a fetch costs
 * almost none. Everything after the master — the EPUB, the PDFs — is
 * rendering and belongs to the converter (`domain/pipeline.ts` for the
 * phases).
 *
 * ## Two doors, and only one of them goes to Adobe
 *
 * A PDF goes to Adobe and comes back as a DOCX master, so phase 1 is
 * finished here and the book lands directly on `master_ready`. A DOCX or
 * plain text upload needs no OCR and no export; it goes to `ocr_ready`,
 * where the converter reads the original and builds the master itself.
 * Both converge on the same master, which is what CLAUDE.md section 6.1
 * requires.
 *
 * `ocr_ready` therefore no longer means "the text has been read". It
 * means "phase 1's remaining work is the converter's", which for a text
 * source is all of it. The state kept its name because renaming it would
 * migrate a column to say the same thing in different words.
 *
 * ## What moves this forward
 *
 * Nothing schedules this. There is no cron trigger and no queue
 * consumer; the converter already polls `GET /api/conversion` for work,
 * and that poll is used as the clock. Each poll advances at most one
 * book before answering.
 *
 * That is a deliberately small idea with a large payoff: the thing that
 * wants the work is the thing that drives the work, so there is no
 * scheduler to deploy, nothing fires when no converter is running, and
 * the polling interval is tuned in exactly one place. Its cost is that a
 * scan does not progress while no converter is polling — which is fine,
 * because nothing downstream could act on it if it did.
 *
 * ## Bounded work per call
 *
 * One book started and one export checked, at most. A Worker has five
 * minutes of CPU and a poll must stay quick; sweeping every queued book
 * in one request would make the slowest possible poll proportional to
 * the backlog.
 */

import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { Payload } from 'payload'

import {
  MAX_EXPORT_RETRIES,
  exportHasExpired,
  exportLocaleFor,
  isTransientExportFailure,
  masterKey,
  withinSizeLimit,
} from '../domain/adobe'
import type { ArtifactFormat } from '../domain/conversion'
import { bookStem } from '../domain/bookStorage'
import { type CorrectionState, correctionStateForMaster } from '../domain/correction'
import {
  type ConversionState,
  needsMasterRun,
  releasedExportHandle,
  stateWithoutExport,
  statusOnQueue,
} from '../domain/pipeline'
import {
  type SourceKind,
  needsExport,
  originalArtifact,
  originalKey,
  readSourceKind,
  resolvePlan,
} from '../domain/publication'
import {
  ADD_SOURCE_ERRORS,
  type BookSource,
  canAddSource,
  readSources,
} from '../domain/sources'
import type { Book } from '../payload-types'
import {
  type AdobeCredentials,
  accessToken,
  createAsset,
  deleteAsset,
  downloadResult,
  exportStatus,
  startExport,
  uploadAsset,
} from './adobe/client'
import { freeStem } from './bookObjects'
import { artifactBytes, copyObject, objectBucket } from './storage'
import { logError } from './logError'

/**
 * Adobe credentials, or null when they are not configured.
 *
 * Null is not an error. It means this deployment cannot export PDFs, and
 * the caller skips these stages rather than failing books — which is
 * what lets the Worker be deployed before the secret is set, the same
 * fail-closed shape the handoff endpoint uses.
 */
export async function adobeConfig(): Promise<AdobeCredentials | null> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    const e = env as unknown as Record<string, string | undefined>

    // `ADOBE_API_KEY` is Adobe's own name for the client id — it is what
    // the Developer Console labels the value, and what the REST API
    // wants in `X-API-Key`. Accepted as an alias so a project set up
    // from Adobe's own wording works without renaming anything.
    const clientId = e.ADOBE_CLIENT_ID || e.ADOBE_API_KEY
    const clientSecret = e.ADOBE_CLIENT_SECRET

    // Both, always. The API key alone authenticates nothing: PDF
    // Services issues a bearer token from the id *and* the secret
    // together, so a deployment holding one of them can do exactly as
    // much as a deployment holding neither.
    if (!clientId || !clientSecret) return null
    return { clientId, clientSecret }
  } catch {
    // Not logged, for the same reason as the converter route's secret
    // lookup: no bindings is a deployment fact, not an incident.
    return null
  }
}

/** SHA-256 of the uploaded original, as lowercase hex. */
async function sourceHash(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Has a byte-identical file already been exported?
 *
 * The export is the one third-party, per-page cost in the pipeline, and
 * the public-domain scans this library preserves circulate as a small
 * number of widely-copied PDFs — so the same file arriving twice is
 * ordinary, not exotic. When it does, the second book gets a copy of the
 * first book's master and Adobe is not called at all.
 *
 * Safe across owners: the master is a function of the bytes the second
 * uploader already holds, so nothing is revealed that they did not
 * upload themselves.
 *
 * The bytes are *copied* rather than the key being shared. Every
 * artifact must live under its own book's prefix — that containment is
 * what the download path checks (`domain/conversion.ts`) — and a master
 * is a few megabytes, so the copy is cheap and the alternative would
 * poke a hole in the one rule keeping one book's files out of another's.
 */
async function alreadyExported(
  payload: Payload,
  hash: string,
  bookId: string | number,
): Promise<{ storageKey: string; pageCount: number | null } | null> {
  const twin = await payload.find({
    collection: 'books',
    where: {
      and: [{ 'conversion.sourceHash': { equals: hash } }, { id: { not_equals: bookId } }],
    },
    sort: 'createdAt',
    limit: 4,
    depth: 0,
    overrideAccess: true,
  })

  for (const found of twin.docs) {
    const master = (found.artifacts ?? []).find((artifact) => artifact.format === 'docx')
    if (!master?.storageKey) continue
    return {
      storageKey: master.storageKey,
      pageCount: typeof found.pageCount === 'number' ? found.pageCount : null,
    }
  }
  return null
}

async function fail(
  payload: Payload,
  book: { id: string | number; conversion?: unknown },
  message: string,
) {
  await payload.update({
    collection: 'books',
    id: book.id,
    data: {
      conversion: {
        ...(book.conversion as Record<string, unknown>),
        state: 'failed',
        message: message.slice(0, 500),
      },
    },
    overrideAccess: true,
  })
}

/**
 * A failed export: send the book round again, or stop.
 *
 * Adobe answers a busy service and an unreadable PDF with the same
 * `status: failed`, and the only thing separating them is the wording of
 * the message — so `isTransientExportFailure` reads it, and this decides
 * what to do about the answer.
 *
 * A transient failure puts the book back to `queued` with its export
 * handle released, which is exactly what a person pressing Try again
 * produces; the next tick starts a fresh export. A permanent one fails
 * the book as before. Either way the vendor's own text goes to the log,
 * because the uploader is shown something they can act on and the
 * operator needs the request id.
 *
 * The retry count is written *after* `releasedExportHandle`, which
 * resets it: this is the one caller that means to keep a number.
 *
 * Returns whether the book was requeued, so the caller can let go of the
 * Adobe-side asset it is about to upload again.
 */
async function failOrRetry(
  payload: Payload,
  book: { id: string | number },
  conversion: Record<string, unknown>,
  { message, retryable }: { message: string; retryable: boolean },
): Promise<boolean> {
  const retries = typeof conversion.exportRetries === 'number' ? conversion.exportRetries : 0
  logError(`export: book ${book.id} failed after ${retries} retries`, message)

  if (!retryable || retries >= MAX_EXPORT_RETRIES) {
    await fail(
      payload,
      { id: book.id, conversion },
      retryable
        ? 'The service that reads scanned pages was busy every time we tried, so this book has not been read yet. Nothing is wrong with your file — try again in a little while.'
        : message,
    )
    return false
  }

  const attempt = retries + 1
  await payload.update({
    collection: 'books',
    id: book.id,
    data: {
      conversion: {
        ...conversion,
        state: 'queued' as const,
        ...releasedExportHandle('queued'),
        exportRetries: attempt,
        message: `The service that reads scanned pages was busy, so this book is being sent again (attempt ${attempt + 1} of ${MAX_EXPORT_RETRIES + 1}). Nothing is wrong with your file and there is nothing to do.`,
      },
    },
    overrideAccess: true,
  })
  return true
}

/**
 * Attach a DOCX master to a book and hand it to phase 2.
 *
 * The bytes are in storage before the state moves, so `master_ready`
 * always means the file is there. A converter that claimed a book whose
 * master had not landed yet would fail on a missing object and look like
 * a converter bug.
 *
 * The master is attached rather than replacing the artifact list: a book
 * arriving here has no formats yet, but merging is what keeps this
 * correct if it ever does.
 */
/**
 * The correction field for a book that has just settled without export.
 *
 * `master_ready` here means one thing only — a DOCX upload, which *is*
 * its own master (`stateWithoutExport`). That is the one settle path
 * with something for correction to read: a text upload has not been
 * mastered yet, and an EPUB or an as-is PDF never will be.
 *
 * Returns nothing at all in every other case, so the field is left
 * exactly as it stands rather than being reset to `none` under a book
 * that is mid-correction.
 */
function correctionFor(
  conversion: Record<string, unknown>,
  state: ConversionState,
): { correction?: { state: CorrectionState } } {
  if (state !== 'master_ready') return {}
  return {
    correction: {
      ...((conversion.correction as object) ?? {}),
      state: correctionStateForMaster(conversion.aiCorrection),
    },
  }
}


async function attachMaster(
  payload: Payload,
  book: { id: string | number; conversion?: unknown; artifacts?: Book['artifacts'] },
  {
    bytes,
    conversion,
    pageCount,
  }: { bytes: Uint8Array; conversion: Record<string, unknown>; pageCount?: number | null },
): Promise<boolean> {
  const bucket = await objectBucket()
  if (!bucket) {
    await fail(payload, book, 'Object storage is not available.')
    return true
  }

  const key = masterKey(book.id)
  await bucket.put(key, bytes, {
    httpMetadata: {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  })

  const existing = book.artifacts ?? []
  await payload.update({
    collection: 'books',
    id: book.id,
    data: {
      artifacts: [
        ...existing.filter((artifact) => artifact.format !== 'docx'),
        {
          format: 'docx' as const,
          storageKey: key,
          bytes: bytes.byteLength,
          // The DOCX master is the editorial source of truth, never a
          // reader download (CLAUDE.md section 5).
          downloadable: false,
        },
      ],
      conversion: {
        ...conversion,
        state: 'master_ready',
        exportJob: null,
        exportAsset: null,
        // The budget is spent per export, not per book: a master that
        // took two attempts must not leave the next one — a re-master
        // from a different source (`domain/sources.ts`) — with a single
        // transient failure between it and `failed`.
        exportRetries: 0,
        message: null,
        // There is now something for correction to read. Queued only if
        // the uploader asked for it — `correctionStateForMaster` reads
        // an unanswered question as no (domain/correction.ts).
        correction: {
          ...((conversion as { correction?: object }).correction ?? {}),
          state: correctionStateForMaster(
            (conversion as { aiCorrection?: unknown }).aiCorrection,
          ),
        },
      },
      ...(pageCount ? { pageCount } : {}),
    },
    overrideAccess: true,
  })
  return true
}

/**
 * Copy one uploaded file into the slot it occupies under the book.
 *
 * A PDF upload *is* the book's PDF, a DOCX *is* its master, an EPUB *is*
 * its EPUB, a text file *is* its TXT — so filing an original is also
 * publishing an artifact. That is what makes "keep the original" free
 * rather than a second copy of everything (`domain/publication.ts`).
 *
 * Returns the artifact list as it now stands and the source entry to
 * record, or null if the bytes could not be copied. Deliberately writes
 * nothing itself: the two callers below disagree about what a failure
 * means — for the book's chosen source it is a failed conversion, for
 * one being added alongside it is a refused upload and the book is
 * fine — and about which conversion fields move with it.
 *
 * Idempotent by the caller's check, not its own: a slot already filled
 * is never reached, because a retry must not overwrite a master an
 * editor has since corrected with the scan it was built from.
 */
async function fileUnderBook(
  book: { artifacts?: Book['artifacts'] },
  {
    kind,
    format,
    sourceKey,
    filename,
    anchorFilename,
  }: {
    kind: SourceKind
    format: ArtifactFormat
    sourceKey: string
    /** This file's own name, which is what its owner recognises it by. */
    filename: unknown
    /**
     * The name the *book* is stemmed from — always its first upload,
     * whichever file is being filed. See below.
     */
    anchorFilename: unknown
  },
): Promise<{ artifacts: NonNullable<Book['artifacts']>; source: BookSource } | null> {
  const existing = book.artifacts ?? []

  // **The stem is settled by the first object, and only by it.** A book
  // that has filed anything already reads its stem back off that key
  // (`bookStem`); only a book with nothing filed reserves one, numbered
  // if that name is taken (`lib/bookObjects.ts`).
  //
  // Re-reserving for a book that has objects would be worse than
  // redundant. `freeStem` calls a stem taken when *any* key in its
  // footprint exists, so a second source landing on a book whose name
  // another book happens to share would be filed under `scan-2` while
  // the rest of this book stayed `scan` — variations that no longer
  // agree, which is the one thing the naming scheme exists to prevent.
  //
  // Which is also why the stem comes from `anchorFilename` — the book's
  // *first* upload — and never from the file in hand. A second source
  // can be added to a book whose first one has not been filed yet (a
  // book still queued, whose tick has not reached it), and stemming that
  // one from its own name would mint `notes` while the scan behind it
  // went on to mint `tao`. One book, two names, and nothing to notice it.
  const filed = existing.some(
    (artifact) => typeof artifact.storageKey === 'string' && artifact.storageKey.length > 0,
  )
  const wanted = bookStem({ artifacts: existing, sourceFilename: anchorFilename })
  const stem = filed ? wanted : await freeStem({ wanted, owned: [] })

  const key = originalKey(stem, kind)
  const size = await copyObject(sourceKey, key, CONTENT_TYPES[kind])
  if (size === null) return null

  return {
    artifacts: [
      ...existing,
      {
        format,
        storageKey: key,
        bytes: size,
        // The DOCX master is the editorial source of truth, never a
        // reader download (CLAUDE.md section 5) — which is exactly what
        // a DOCX upload becomes.
        downloadable: format !== 'docx',
      },
    ],
    source: {
      kind,
      storageKey: key,
      filename: typeof filename === 'string' ? filename : '',
      bytes: size,
      addedAt: new Date().toISOString(),
    },
  }
}

/**
 * `status` for a book that has just gained an artifact.
 *
 * Written with the artifacts, in the same update, because it is the
 * same fact: `status` says whether there is an edition to read, and for
 * three of the four sources the file just filed *is* one
 * (`statusOnQueue`). A book in the middle of a conversion was left at
 * `in_production` regardless, so an administrator who approved it
 * published a book the catalog query then refused to list — for the
 * length of the conversion, and for ever on a deployment whose export
 * never runs.
 *
 * Only ever upwards. A book that already has an edition is already
 * `published`, and nothing here can move one back.
 */
function statusFor(artifacts: NonNullable<Book['artifacts']>): { status?: 'published' } {
  return statusOnQueue(artifacts.map((artifact) => artifact.format)) === 'published'
    ? { status: 'published' }
    : {}
}

/**
 * Put the book's **chosen** source under the book.
 *
 * Returns the artifacts and the conversion group as they now stand, or
 * null if the book has been failed. Returning both rather than a boolean
 * is what keeps the callers correct: each of them goes on to write the
 * conversion group, and doing that from the copy it read *before* this
 * ran would undo the source list and the redirected `sourceKey` below.
 *
 * ## Why `sourceKey` moves
 *
 * The upload lands at `conversion/{job}/input/...`, which the R2
 * lifecycle rule sweeps after 30 days, and until now that is where
 * `conversion.sourceKey` went on pointing forever. The bytes were safe —
 * they are copied here — but the *pointer* was not, so a text book that
 * sat in the queue past a month would be handed to the runner with a
 * source key resolving to nothing (`runMaster`). Repointing it at the
 * copy costs nothing and is the only version of this that stays true.
 */
async function fileOriginal(
  payload: Payload,
  book: { id: string | number; conversion?: unknown; artifacts?: Book['artifacts'] },
  { conversion, kind }: { conversion: Record<string, unknown>; kind: SourceKind },
): Promise<{
  artifacts: NonNullable<Book['artifacts']>
  conversion: Record<string, unknown>
} | null> {
  const format = originalArtifact(kind)
  const existing = book.artifacts ?? []
  if (!format) return { artifacts: existing, conversion }
  if (existing.some((artifact) => artifact.format === format)) {
    return { artifacts: existing, conversion }
  }

  const filed = await fileUnderBook(book, {
    kind,
    format,
    sourceKey: conversion.sourceKey as string,
    filename: conversion.sourceFilename,
    anchorFilename: conversion.sourceFilename,
  })
  if (!filed) {
    await fail(payload, book, 'The uploaded file could not be read from storage.')
    return null
  }

  // Composed from `readSources`, never from the stored array, because a
  // book whose only source predates the list has an empty array and a
  // perfectly real source. Appending to the array would lose it
  // (`domain/sources.ts`).
  const sources = [
    // Against the artifacts as they were *before* this one was filed,
    // which is where the pre-existing sources actually live. Passing the
    // list is what repoints a legacy entry away from the `conversion/`
    // key it was uploaded to (`readSources`).
    ...readSources(conversion, existing).filter((source) => source.kind !== kind),
    filed.source,
  ]

  const next = {
    ...conversion,
    sources,
    sourceKey: filed.source.storageKey,
  }

  await payload.update({
    collection: 'books',
    id: book.id,
    data: { artifacts: filed.artifacts, conversion: next, ...statusFor(filed.artifacts) },
    overrideAccess: true,
  })
  return { artifacts: filed.artifacts, conversion: next }
}

/**
 * Add a second file to a book that already has one.
 *
 * The portal's other door (`api/upload/route.ts` with a `book`
 * parameter). It files the new original exactly as the first one was
 * filed, and then stops: **nothing about the conversion changes.** The
 * master is still built from whatever the owner chose, this book is not
 * re-queued, and no quota is spent. Choosing to build from the new file
 * is a separate act with a separate cost (`actions/sources.ts`).
 *
 * That separation is the point. Uploading a transcription beside a scan
 * should be free and reversible; committing to master from it should
 * not be silent.
 *
 * Returns a message on refusal and null on success — the caller is an
 * HTTP route, and the only thing it needs back is what to tell the
 * person who chose the file.
 */
export async function addSourceToBook(
  payload: Payload,
  book: Book,
  { kind, sourceKey, filename }: { kind: SourceKind; sourceKey: string; filename: string },
): Promise<string | null> {
  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const decision = canAddSource({
    kind,
    existingFormats: (book.artifacts ?? []).map((artifact) => artifact.format),
  })
  if (!decision.allowed) return ADD_SOURCE_ERRORS[decision.reason]

  const filed = await fileUnderBook(book, {
    kind,
    format: decision.slot,
    sourceKey,
    filename,
    // The book's own name, not this file's. See `fileUnderBook`.
    anchorFilename: conversion.sourceFilename,
  })
  // Not a failed book. The conversion this book is actually running is
  // untouched by an upload that did not arrive, so failing it here would
  // break something that was working over something that was optional.
  if (!filed) return 'That file could not be stored. Please try again.'

  await payload.update({
    collection: 'books',
    id: book.id,
    data: {
      artifacts: filed.artifacts,
      conversion: {
        ...conversion,
        sources: [
          ...readSources(conversion, book.artifacts).filter((source) => source.kind !== kind),
          filed.source,
        ],
      },
      ...statusFor(filed.artifacts),
    },
    overrideAccess: true,
  })
  return null
}

const CONTENT_TYPES: Record<SourceKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
  text: 'text/plain; charset=utf-8',
}

/**
 * Say why a queued book is not moving, without failing it.
 *
 * `failed` would be the wrong state — nothing about the book is wrong,
 * and a failed book waits for a person to requeue it — but silence is
 * worse than either. A book stopped here reads as "Waiting to be
 * converted" for as long as the deployment stays as it is, which is
 * indistinguishable from waiting its turn behind someone else's scan.
 *
 * Written at most once. The tick runs every minute and reaches this on
 * every one of them, so an unconditional update would rewrite the row
 * 1,440 times a day and drag `updatedAt` along with it.
 *
 * Cleared by whoever moves the book on: both paths out of `queued`
 * below set `message: null` as part of the same update.
 */
async function noteWaiting(
  payload: Payload,
  book: { id: string | number },
  conversion: Record<string, unknown>,
  message: string,
): Promise<void> {
  if (conversion.message === message) return
  await payload.update({
    collection: 'books',
    id: book.id,
    data: { conversion: { ...conversion, message } },
    overrideAccess: true,
  })
}

/**
 * How many queued books one tick will consider.
 *
 * More than one because a book that cannot be started must not stop the
 * books behind it. That took the whole queue out once: a scan wanting an
 * export, on a deployment whose Adobe credentials had never been set,
 * was the oldest queued book — so every later upload sat at `queued`
 * behind a book that could not move until somebody set a secret.
 *
 * Bounded because a tick is billed for CPU. This is a short scan for
 * something to start, not a sweep of the queue, and it still stops at
 * the first book it can start.
 */
const QUEUE_SCAN = 5

/**
 * Start phase 1 for one queued book, if any of them can be started.
 *
 * Returns whether anything was done, so the caller can stop after one
 * unit of work.
 */
export async function startNextMaster(
  payload: Payload,
  credentials: AdobeCredentials | null,
): Promise<boolean> {
  const queued = await payload.find({
    collection: 'books',
    where: { 'conversion.state': { equals: 'queued' } },
    sort: 'createdAt',
    limit: QUEUE_SCAN,
    depth: 0,
    overrideAccess: true,
  })

  for (const book of queued.docs) {
    if (await startMasterFor(payload, book, credentials)) return true
  }
  return false
}

/**
 * Try to start phase 1 for one book.
 *
 * Returns whether a unit of work happened. False means this book could
 * not be started at all — nothing was written that matters and the
 * caller moves on to the next one.
 */
async function startMasterFor(
  payload: Payload,
  book: Book,
  credentials: AdobeCredentials | null,
): Promise<boolean> {
  // Reassigned once, by the filing below. `fileOriginal` writes the
  // source list and repoints `sourceKey` at the copy it made, and every
  // update after this point spreads the group — so going on to use the
  // copy read before it would silently undo both.
  let conversion = (book.conversion ?? {}) as Record<string, unknown>
  const sourceKey = typeof conversion.sourceKey === 'string' ? conversion.sourceKey : ''

  if (!sourceKey) {
    await fail(payload, book, 'The uploaded file is missing.')
    return true
  }

  if (
    !needsMasterRun({
      state: 'queued',
      exportJob: conversion.exportJob as string | null,
    })
  ) {
    return false
  }

  const kind = readSourceKind(conversion)
  const plan = resolvePlan(kind, conversion.plan)

  // Every original is filed under the book before anything else
  // happens. Two reasons, and the second is the one that bites: it is
  // what "always keep the original" means, and the key it was uploaded
  // to lives under `conversion/`, which the R2 lifecycle rule sweeps
  // after 30 days. An original left there would quietly disappear from
  // a published book a month after it was published.
  const filed = await fileOriginal(payload, book, { conversion, kind })
  if (filed === null) return true
  const artifacts = filed.artifacts
  conversion = filed.conversion

  // Nothing to send to Adobe. Where the book goes next is entirely a
  // question of what its source already is:
  //
  //   text  → the converter still has to build a master from it
  //   docx  → the upload *is* the master; phase 2 can start
  //   epub  → the upload *is* the edition; the book is finished
  //   pdf, published as it stands → likewise finished
  if (!needsExport(kind, plan)) {
    const state = stateWithoutExport(kind, plan)
    await payload.update({
      collection: 'books',
      id: book.id,
      data: {
        conversion: { ...conversion, state, message: null, ...correctionFor(conversion, state) },
        // Nothing downstream will ever set this for a book no converter
        // touches, so it is set here. `published` is about the book
        // being finished, not about who may see it — an unsubmitted
        // upload stays `visibility: private` and is readable by its
        // owner alone.
        ...(state === 'ready' ? { status: 'published' as const } : {}),
      },
      overrideAccess: true,
    })
    return true
  }

  // Only from here on is Adobe involved, so only from here on do the
  // credentials matter. Checking them any earlier is what stranded
  // books that never needed Adobe at all.
  if (!credentials) {
    await noteWaiting(
      payload,
      book,
      conversion,
      'This scan is waiting to be read. The service that reads scanned pages is not configured on this deployment, so nothing has picked it up yet — your file and its details are safe, and it will convert as soon as it is.',
    )
    return false
  }

  try {
    const bytes = await artifactBytes(sourceKey)
    if (!bytes) {
      await fail(payload, book, 'The uploaded file could not be read from storage.')
      return true
    }

    if (!withinSizeLimit(bytes.byteLength)) {
      await fail(
        payload,
        book,
        'This PDF is larger than 100 MB, which is the most the conversion service accepts. A copy scanned at a lower resolution, or split into volumes, will work.',
      )
      return true
    }

    // Before anything is sent to Adobe. This is the only place in the
    // pipeline where a check can still prevent the charge.
    const hash = await sourceHash(bytes)
    const seen = await alreadyExported(payload, hash, book.id)
    if (seen) {
      const master = await artifactBytes(seen.storageKey)
      if (master) {
        return await attachMaster(payload, { ...book, artifacts }, {
          bytes: master,
          conversion: { ...conversion, sourceHash: hash },
          pageCount: seen.pageCount,
        })
      }
      // The twin's row says there is a master and storage disagrees.
      // Fall through and pay for the export rather than failing the
      // book on someone else's missing file.
    }

    const token = await accessToken(credentials)
    const target = await createAsset(credentials, token)
    await uploadAsset(target.uploadUri, bytes)

    const jobUrl = await startExport({
      credentials,
      token,
      assetID: target.assetID,
      locale: exportLocaleFor(book.language),
    })

    // Written together, and only after Adobe has accepted the job. A
    // recorded job that was never submitted would stall the book
    // forever, waiting on something that does not exist; an accepted job
    // that was never recorded would be paid for and never collected.
    await payload.update({
      collection: 'books',
      id: book.id,
      data: {
        conversion: {
          ...conversion,
          state: 'ocr',
          exportJob: jobUrl,
          exportAsset: target.assetID,
          exportStartedAt: new Date().toISOString(),
          // Recorded now so the *next* identical upload can find it,
          // even though this one paid.
          sourceHash: hash,
          message: null,
        },
      },
      overrideAccess: true,
    })
    return true
  } catch (error) {
    // Submitting is as capable of hitting a busy service as polling is,
    // and here the book has almost certainly not been billed yet —
    // everything before `startExport` fails free. So the same rule
    // applies: a recognised transient fault goes round again, anything
    // else fails the book and waits for a person.
    await failOrRetry(payload, book, conversion, {
      message: error instanceof Error ? error.message : 'The conversion could not be started.',
      retryable: isTransientExportFailure(error instanceof Error ? error.message : null),
    })
    return true
  }
}

/**
 * Check one running export, and collect it if it has finished.
 */
export async function advanceRunningMaster(
  payload: Payload,
  credentials: AdobeCredentials,
): Promise<boolean> {
  const running = await payload.find({
    collection: 'books',
    where: { 'conversion.state': { equals: 'ocr' } },
    sort: 'createdAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const book = running.docs[0]
  if (!book) return false

  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const jobUrl = typeof conversion.exportJob === 'string' ? conversion.exportJob : ''
  const assetID = typeof conversion.exportAsset === 'string' ? conversion.exportAsset : ''

  if (!jobUrl) {
    await fail(payload, book, 'The conversion was never started for this book.')
    return true
  }

  try {
    const token = await accessToken(credentials)
    const outcome = await exportStatus({ credentials, token, jobUrl })

    if (outcome.state === 'running') {
      // Adobe's assets expire after a day, so a job still running well
      // past any real book will never produce a file we could fetch.
      // Letting go of it frees the poll to move on to the next book.
      //
      // Retryable, and for the same reason a timeout is: a job that hung
      // says nothing about the file, and this is the one failure we
      // diagnose ourselves rather than reading it off a message.
      if (exportHasExpired(conversion.exportStartedAt as string | null, Date.now())) {
        const retried = await failOrRetry(payload, book, conversion, {
          message: 'The conversion did not finish in time.',
          retryable: true,
        })
        if (retried && assetID) await deleteAsset(credentials, token, assetID)
        return true
      }
      return false
    }

    if (outcome.state === 'failed') {
      const retried = await failOrRetry(payload, book, conversion, {
        message: outcome.message ?? 'The pages could not be read.',
        retryable: outcome.retryable === true,
      })
      // The next attempt uploads the same bytes from R2, so this copy is
      // of no further use. Best effort, as everywhere: Adobe expires it
      // within a day anyway.
      if (retried && assetID) await deleteAsset(credentials, token, assetID)
      return true
    }

    // No sanity check on what came back, and that is a real change:
    // Document AI handed over text, so an upside-down scan could be
    // caught here by noticing the pages held almost no characters
    // (`looksLikeABook`). Adobe hands over a DOCX, and telling a bad
    // export from a good one would mean unzipping and parsing OOXML on a
    // Worker to re-derive what phase 2 is about to read anyway. Adobe
    // fails such a scan itself often enough; when it does not, the
    // damage shows up in the master, which is exactly the thing an
    // editor is meant to look at.
    //
    // Nor is a page count recorded. Adobe does not report one, so the
    // book keeps the estimate `extractMetadata` read from the file until
    // phase 2 reports the real count from the rendered document — which
    // is what happens for every other source too.
    const master = await downloadResult(outcome.downloadUri!)
    const attached = await attachMaster(payload, book, { bytes: master, conversion })

    // Only once the master is safely ours. Deleting before storing would
    // trade a day of Adobe holding a copy for the chance of losing the
    // thing we paid for.
    if (assetID) await deleteAsset(credentials, token, assetID)
    return attached
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The converted file could not be read.'

    // A transient fault *while polling* is the cheapest kind to survive:
    // the export itself is untouched and its job URL is still good, so
    // the book stays in `ocr` and the next tick simply asks again. Doing
    // what a `failed` status does here — requeueing — would throw away a
    // running export and pay for it a second time because Adobe's token
    // endpoint had a bad minute.
    //
    // The expiry check comes first because it is the only thing bounding
    // this: every path that would otherwise notice a stuck job lives
    // after the call that just threw, so an endpoint failing every time
    // would leave the book polling for ever.
    const expired = exportHasExpired(conversion.exportStartedAt as string | null, Date.now())
    if (!expired && isTransientExportFailure(message)) {
      logError(`export: book ${book.id} could not be polled`, error)
      return false
    }

    await failOrRetry(payload, book, conversion, {
      message,
      retryable: expired || isTransientExportFailure(message),
    })
    return true
  }
}

/**
 * Move phase 1 along by one step.
 *
 * Checking finished work before starting new work, so a busy pipeline
 * drains rather than accumulating exports nobody has collected. Never
 * throws: this runs inside the converter's poll, and a failure here must
 * not stop the converter being handed a job it could otherwise do.
 */
export async function advanceMasterPipeline(payload: Payload): Promise<void> {
  try {
    const credentials = await adobeConfig()

    // Credentials gate the *export*, not the tick. A book that needs no
    // export — an EPUB, a DOCX, a PDF published as it stands — still has
    // to be filed under itself and marked finished, and returning early
    // here stranded precisely the books that never needed Adobe.
    if (credentials && (await advanceRunningMaster(payload, credentials))) return
    await startNextMaster(payload, credentials)
  } catch (error) {
    // See above — the converter's poll must still be answered. This is
    // where an Adobe failure would otherwise vanish without trace.
    logError('masterPipeline: advance', error)
  }
}

/**
 * Do everything a queued book can have done for it in this request.
 *
 * Two things, and the first one is for every book:
 *
 *   - **File the original under the book.** An R2 copy — I/O, not
 *     computation, exactly the shape of work a Worker should do inline.
 *   - **Finish the book, if nothing has to be converted.** A PDF
 *     published as it stands, or an EPUB upload, needs no export, no
 *     rendering and no worker at all.
 *
 * The pipeline's clock is a cron tick (see the header), which is the
 * right answer for work somebody has to do and the wrong one for work
 * nobody has to do: such a book sat at `queued` until a tick reached it,
 * unreadable, unsubmittable and unpublished — "there is nothing to
 * review yet", about a file sitting right there.
 *
 * Filing the original is here for the same reason, and for every source
 * rather than only the ones that can be finished. A book being
 * converted had no artifact until the tick picked it up, so its owner
 * was told "Waiting to be converted" and offered nothing to read —
 * while the file they had just uploaded was already in storage, and
 * *is* the book's own PDF or text (`domain/publication.ts`). Filing it
 * now costs a copy and makes the wait readable; the export, when it
 * comes, only adds a master beside it.
 *
 * Returns true if the book was *settled* — moved out of `queued`. A
 * book waiting on an export files its original and returns false, which
 * is not an error. Never throws either: this runs after the uploader's
 * details have already been saved, and a failure here must not turn a
 * successful save into an error. The book stays `queued`, which the
 * pipeline tick will pick up later.
 */
export async function settleQueuedBook(
  payload: Payload,
  bookId: string | number,
): Promise<boolean> {
  try {
    const book = await payload.findByID({
      collection: 'books',
      id: bookId,
      depth: 0,
      overrideAccess: true,
    })

    // Reassigned by the filing below, for the reason `startMasterFor`
    // gives: it writes the source list and repoints `sourceKey`, and the
    // update after it spreads the whole group.
    let conversion = (book.conversion ?? {}) as Record<string, unknown>
    if (conversion.state !== 'queued') return false

    const kind = readSourceKind(conversion)
    const plan = resolvePlan(kind, conversion.plan)

    if (typeof conversion.sourceKey !== 'string' || !conversion.sourceKey) return false

    // First, and for every source. A book waiting on an export is
    // waiting with something to read.
    const filed = await fileOriginal(payload, book, { conversion, kind })
    if (filed === null) return false
    conversion = filed.conversion

    // The state, though, is the tick's to move for anything needing
    // Adobe: it owns the whole export lifecycle, including the polling
    // and the timeout.
    if (needsExport(kind, plan)) return false

    const state = stateWithoutExport(kind, plan)
    await payload.update({
      collection: 'books',
      id: book.id,
      data: {
        conversion: { ...conversion, state, message: null, ...correctionFor(conversion, state) },
        ...(state === 'ready' ? { status: 'published' as const } : {}),
      },
      overrideAccess: true,
    })
    return true
  } catch (error) {
    logError('masterPipeline: settle queued book', error)
    return false
  }
}
