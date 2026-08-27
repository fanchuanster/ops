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

import { exportHasExpired, exportLocaleFor, masterKey, withinSizeLimit } from '../domain/adobe'
import { bookStem } from '../domain/bookStorage'
import { type CorrectionState, correctionStateForMaster } from '../domain/correction'
import { type ConversionState, needsMasterRun, stateWithoutExport } from '../domain/pipeline'
import {
  type SourceKind,
  needsExport,
  originalArtifact,
  originalKey,
  readSourceKind,
  resolvePlan,
} from '../domain/publication'
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
 * Put the uploaded file under the book, in the slot it occupies.
 *
 * A PDF upload *is* the book's PDF, a DOCX *is* its master, an EPUB *is*
 * its EPUB — so filing the original is also, for three of the four
 * sources, publishing an artifact. That is what makes "keep the
 * original" free rather than a second copy of everything
 * (`domain/publication.ts`).
 *
 * Text is the exception and gets no artifact: a .txt file is not an
 * edition of anything, and the converter reads it from `sourceKey`.
 *
 * Idempotent. A book that already has this artifact is left alone — a
 * retry must not overwrite a master an editor has since corrected with
 * the scan it was built from.
 *
 * Returns the book's artifacts as they now stand, or null if the book
 * has been failed. Returning them rather than a boolean is deliberate:
 * the caller goes on to attach a master, and doing that from the list it
 * read *before* this ran would delete the original it just filed.
 */
async function fileOriginal(
  payload: Payload,
  book: { id: string | number; conversion?: unknown; artifacts?: Book['artifacts'] },
  { conversion, kind }: { conversion: Record<string, unknown>; kind: SourceKind },
): Promise<Book['artifacts'] | null> {
  const format = originalArtifact(kind)
  const existing = book.artifacts ?? []
  if (!format) return existing
  if (existing.some((artifact) => artifact.format === format)) return existing

  const sourceKey = conversion.sourceKey as string
  // The first object this book files, so this is where its stem is
  // decided — from the name of the uploaded file, numbered if that name
  // is already taken. Everything else the book owns is named from the
  // key this writes (`domain/bookStorage.ts`).
  const stem = await freeStem({
    wanted: bookStem({ artifacts: existing, sourceFilename: conversion.sourceFilename }),
    owned: existing.map((artifact) => artifact.storageKey),
  })
  const key = originalKey(stem, kind)
  const size = await copyObject(sourceKey, key, CONTENT_TYPES[kind])
  if (size === null) {
    await fail(payload, book, 'The uploaded file could not be read from storage.')
    return null
  }

  const artifacts = [
    ...existing,
    {
      format,
      storageKey: key,
      bytes: size,
      // The DOCX master is the editorial source of truth, never a
      // reader download (CLAUDE.md section 5) — which is exactly what a
      // DOCX upload becomes.
      downloadable: format !== 'docx',
    },
  ]

  await payload.update({
    collection: 'books',
    id: book.id,
    data: { artifacts },
    overrideAccess: true,
  })
  return artifacts
}

const CONTENT_TYPES: Record<SourceKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
  text: 'text/plain; charset=utf-8',
}

/**
 * Start phase 1 for one queued book, if there is one.
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
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const book = queued.docs[0]
  if (!book) return false

  const conversion = (book.conversion ?? {}) as Record<string, unknown>
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
  const artifacts = await fileOriginal(payload, book, { conversion, kind })
  if (artifacts === null) return true

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
  if (!credentials) return false

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
    await fail(
      payload,
      book,
      error instanceof Error ? error.message : 'The conversion could not be started.',
    )
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
      // Failing it frees the poll to move on to the next book.
      if (exportHasExpired(conversion.exportStartedAt as string | null, Date.now())) {
        await fail(payload, book, 'The conversion did not finish in time. Please try again.')
        return true
      }
      return false
    }

    if (outcome.state === 'failed') {
      await fail(payload, book, outcome.message ?? 'The pages could not be read.')
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
    await fail(
      payload,
      book,
      error instanceof Error ? error.message : 'The converted file could not be read.',
    )
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
 * Finish a book that has nothing to export, without waiting for anyone.
 *
 * The pipeline's clock is the converter's poll (see the header), which
 * is the right answer for work a converter has to do and the wrong one
 * for work nobody has to do. A PDF published as it stands, or an EPUB
 * upload, needs no export, no rendering and no converter — and yet it
 * sat at `queued` until some converter polled, on a deployment where
 * none was running and none was needed. The book could not be read, not
 * submitted for review, and not published: "there is nothing to review
 * yet", about a book whose file was sitting right there.
 *
 * So the details form calls this directly. Filing an original is an R2
 * copy — I/O, not computation — which is exactly the shape of work a
 * Worker is supposed to do inline.
 *
 * Returns true if the book was settled. Never throws: this runs after
 * the uploader's details have already been saved, and a failure here
 * must not turn a successful save into an error. The book stays
 * `queued`, which the pipeline tick will pick up later.
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

    const conversion = (book.conversion ?? {}) as Record<string, unknown>
    if (conversion.state !== 'queued') return false

    const kind = readSourceKind(conversion)
    const plan = resolvePlan(kind, conversion.plan)

    // Anything needing Adobe is left to the tick, which owns the whole
    // export lifecycle — including the polling and the timeout.
    if (needsExport(kind, plan)) return false
    if (typeof conversion.sourceKey !== 'string' || !conversion.sourceKey) return false

    const artifacts = await fileOriginal(payload, book, { conversion, kind })
    if (artifacts === null) return false

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
