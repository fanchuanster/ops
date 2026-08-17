/**
 * Driving phase 1's OCR half.
 *
 * The web application owns OCR because Document AI is an HTTP call: a
 * Worker is billed for CPU, and waiting on a fetch costs almost none.
 * Everything after the text — the DOCX master, the EPUB — is rendering
 * and belongs to the converter (`domain/pipeline.ts` for the phases).
 *
 * ## What moves this forward
 *
 * Nothing schedules this. There is no cron trigger and no queue
 * consumer; the converter already polls `GET /api/conversion` for work,
 * and that poll is used as the clock. Each poll advances at most one
 * book through OCR before answering.
 *
 * That is a deliberately small idea with a large payoff: the thing that
 * wants the work is the thing that drives the work, so there is no
 * scheduler to deploy, nothing fires when no converter is running, and
 * the polling interval is tuned in exactly one place. Its cost is that
 * OCR does not progress while no converter is polling — which is fine,
 * because nothing downstream could act on it if it did.
 *
 * ## Bounded work per call
 *
 * One book started and one operation checked, at most. A Worker has five
 * minutes of CPU and a poll must stay quick; sweeping every queued book
 * in one request would make the slowest possible poll proportional to
 * the backlog.
 */

import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { Payload } from 'payload'

import { buildOcrDocument, looksLikeABook, needsOcr, ocrTextKey } from '../domain/ocr'
import { needsOcrRun } from '../domain/pipeline'
import { collectOcrPages, ocrStatus, startBatchOcr } from './google/documentai'
import { stageForConversion } from './google/storage'
import { artifactBytes, objectBucket } from './storage'

interface OcrConfig {
  encodedKey: string
  processor: string
  location: string
  bucket: string
  /**
   * Whether to pay for type-size information.
   *
   * `DOCUMENT_AI_STYLE_INFO=true` turns it on. Off by default because
   * it is a Document AI premium feature billed above the base per-page
   * rate, and this project reads whole books — a surcharge per page is
   * a surcharge per four hundred pages, per book.
   *
   * What it buys is headings: without it every paragraph is classified
   * `body`, because type size is the only honest evidence for a chapter
   * title (`domain/ocr.ts`). Running-head removal does *not* depend on
   * it — that runs off geometry, which costs nothing extra.
   */
  styleInfo: boolean
}

/**
 * Document AI settings, or null when it is not configured.
 *
 * Null is not an error. It means this deployment cannot do OCR, and the
 * caller skips the OCR stages rather than failing books — which is what
 * lets the Worker be deployed before the secret is set, the same
 * fail-closed shape the handoff endpoint uses.
 */
export async function ocrConfig(): Promise<OcrConfig | null> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    const e = env as unknown as Record<string, string | undefined>

    const encodedKey = e.GOOGLE_SERVICE_ACCOUNT_KEY
    const processor = e.DOCUMENT_AI_PROCESSOR
    const location = e.DOCUMENT_AI_LOCATION
    const bucket = e.DOCUMENT_AI_BUCKET

    if (!encodedKey || !processor || !location || !bucket) return null
    return { encodedKey, processor, location, bucket, styleInfo: e.DOCUMENT_AI_STYLE_INFO === 'true' }
  } catch {
    return null
  }
}

/** Where this book's batch output goes in the scratch bucket. */
function outputPrefix(bookId: string | number): string {
  return `output/${bookId}/`
}

/** SHA-256 of the uploaded original, as lowercase hex. */
async function sourceHash(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Has a byte-identical file already been read?
 *
 * OCR is the one third-party, per-page cost in the pipeline, and the
 * public-domain scans this library preserves circulate as a small number
 * of widely-copied PDFs — so the same file arriving twice is ordinary,
 * not exotic. When it does, the second book points at the first book's
 * OCR text and Google is not called at all.
 *
 * Safe across owners: the text returned is a function of the bytes the
 * second uploader already holds, so nothing is revealed that they did
 * not upload themselves. The artifact is *shared*, not copied, which is
 * why the twin's `ocrKey` is used directly.
 */
async function alreadyRead(
  payload: Payload,
  hash: string,
  bookId: string | number,
): Promise<{ ocrKey: string; pageCount: number | null } | null> {
  const twin = await payload.find({
    collection: 'books',
    where: {
      and: [
        { 'conversion.sourceHash': { equals: hash } },
        { 'conversion.ocrKey': { exists: true } },
        { id: { not_equals: bookId } },
      ],
    },
    sort: 'createdAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const found = twin.docs[0]
  const ocrKey = found?.conversion?.ocrKey
  if (!found || typeof ocrKey !== 'string' || ocrKey.length === 0) return null
  return { ocrKey, pageCount: typeof found.pageCount === 'number' ? found.pageCount : null }
}

async function fail(payload: Payload, book: { id: string | number; conversion?: unknown }, message: string) {
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
 * Start OCR for one queued book, if there is one.
 *
 * A book that needs no OCR — a DOCX or a text upload — skips straight to
 * `ocr_ready` with no `ocrKey`. The converter reads the original in that
 * case, which is why the key is optional rather than the handoff having
 * two shapes.
 */
export async function startNextOcr(payload: Payload, config: OcrConfig): Promise<boolean> {
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
  const filename = typeof conversion.sourceFilename === 'string' ? conversion.sourceFilename : ''

  if (!sourceKey) {
    await fail(payload, book, 'The uploaded file is missing.')
    return true
  }

  if (
    !needsOcrRun({
      state: 'queued',
      ocrKey: conversion.ocrKey as string | null,
      ocrOperation: conversion.ocrOperation as string | null,
    })
  ) {
    return false
  }

  // Already text. Hand it to the converter as it is.
  if (!needsOcr(filename)) {
    await payload.update({
      collection: 'books',
      id: book.id,
      data: { conversion: { ...conversion, state: 'ocr_ready', message: null } },
      overrideAccess: true,
    })
    return true
  }

  try {
    const bytes = await artifactBytes(sourceKey)
    if (!bytes) {
      await fail(payload, book, 'The uploaded file could not be read from storage.')
      return true
    }

    // Before anything is sent to Google. This is the only place in the
    // pipeline where a check can still prevent the charge.
    const hash = await sourceHash(bytes)
    const seen = await alreadyRead(payload, hash, book.id)
    if (seen) {
      await payload.update({
        collection: 'books',
        id: book.id,
        data: {
          conversion: {
            ...conversion,
            state: 'ocr_ready',
            sourceHash: hash,
            ocrKey: seen.ocrKey,
            message: null,
          },
          ...(seen.pageCount === null ? {} : { pageCount: seen.pageCount }),
        },
        overrideAccess: true,
      })
      return true
    }

    const { gcsName } = await stageForConversion({
      encodedKey: config.encodedKey,
      bucket: config.bucket,
      sourceKey,
      body: bytes,
      contentType: 'application/pdf',
    })

    const prefix = outputPrefix(book.id)
    const operation = await startBatchOcr({
      encodedKey: config.encodedKey,
      processor: config.processor,
      location: config.location,
      bucket: config.bucket,
      inputName: gcsName,
      mimeType: 'application/pdf',
      outputPrefix: prefix,
      styleInfo: config.styleInfo,
    })

    // Written together, and only after Google has accepted the job. A
    // recorded operation that was never submitted would stall the book
    // forever, waiting on something that does not exist.
    await payload.update({
      collection: 'books',
      id: book.id,
      data: {
        conversion: {
          ...conversion,
          state: 'ocr',
          ocrOperation: operation,
          ocrOutputPrefix: prefix,
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
    await fail(payload, book, error instanceof Error ? error.message : 'OCR could not be started.')
    return true
  }
}

/**
 * Check one running OCR operation, and collect it if it has finished.
 *
 * The collected text is written to R2 under the book's own prefix before
 * the state moves, so `ocr_ready` always means the file is there. A
 * converter that claimed a book whose text had not landed yet would fail
 * on a missing object and look like a converter bug.
 */
export async function advanceRunningOcr(payload: Payload, config: OcrConfig): Promise<boolean> {
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
  const operation = typeof conversion.ocrOperation === 'string' ? conversion.ocrOperation : ''
  const prefix =
    typeof conversion.ocrOutputPrefix === 'string'
      ? conversion.ocrOutputPrefix
      : outputPrefix(book.id)

  if (!operation) {
    await fail(payload, book, 'OCR was never started for this book.')
    return true
  }

  try {
    const status = await ocrStatus({
      encodedKey: config.encodedKey,
      location: config.location,
      operation,
    })

    if (status.state === 'running') return false
    if (status.state === 'failed') {
      await fail(payload, book, status.message ?? 'OCR failed.')
      return true
    }

    const { pages, pageCount } = await collectOcrPages({
      encodedKey: config.encodedKey,
      bucket: config.bucket,
      outputPrefix: prefix,
    })

    // A scan that is upside down, or of the wrong thing entirely,
    // produces pages of scattered nonsense. Failing here costs the
    // uploader a re-upload; not failing costs an editor a day of
    // proofreading something no proofreading can rescue.
    if (!looksLikeABook(pages)) {
      await fail(
        payload,
        book,
        'The pages could not be read. The scan may be upside down, or too faint to recognise.',
      )
      return true
    }

    // `pageCount` is every page the engine saw; `pages` is only those
    // with text on them. Passing the latter for both would lose every
    // blank page in the book.
    const document = buildOcrDocument({ bookId: book.id, pages, pageCount })

    const key = ocrTextKey(book.id)
    const bucket = await objectBucket()
    if (!bucket) {
      await fail(payload, book, 'Object storage is not available.')
      return true
    }

    await bucket.put(key, JSON.stringify(document), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    })

    await payload.update({
      collection: 'books',
      id: book.id,
      data: {
        conversion: { ...conversion, state: 'ocr_ready', ocrKey: key, message: null },
        // The engine's page count is the real one. It replaces the
        // estimate the quota was charged against, and prices the book.
        pageCount: document.pageCount,
      },
      overrideAccess: true,
    })
    return true
  } catch (error) {
    await fail(payload, book, error instanceof Error ? error.message : 'OCR could not be read.')
    return true
  }
}

/**
 * Move the OCR stages along by one step.
 *
 * Checking finished work before starting new work, so a busy pipeline
 * drains rather than accumulating operations nobody has collected.
 * Never throws: this runs inside the converter's poll, and a failure to
 * advance OCR must not stop the converter being handed a job it could
 * otherwise do.
 */
export async function advanceOcrPipeline(payload: Payload): Promise<void> {
  try {
    const config = await ocrConfig()
    if (!config) return

    if (await advanceRunningOcr(payload, config)) return
    await startNextOcr(payload, config)
  } catch {
    // See above.
  }
}
