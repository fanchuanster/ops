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
    return { encodedKey, processor, location, bucket }
  } catch {
    return null
  }
}

/** Where this book's batch output goes in the scratch bucket. */
function outputPrefix(bookId: string | number): string {
  return `output/${bookId}/`
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

    const pages = await collectOcrPages({
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

    const document = buildOcrDocument({
      bookId: book.id,
      pages,
      pageCount: pages.length,
    })

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
