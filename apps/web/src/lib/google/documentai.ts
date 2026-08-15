/**
 * Document AI batch OCR.
 *
 * The one part of the pipeline that is not on Cloudflare. OCR needs more
 * memory and more CPU time than a Worker has, so it is not run here —
 * it is *called*, and a Worker is billed almost nothing for waiting on
 * a fetch it is not computing during.
 *
 * Batch, not online. Online processing caps a request at 15 pages and
 * answers inline; batch takes 500 and answers into a bucket. A book is
 * not 15 pages, so the inline shape was never available, and everything
 * awkward here — the staging bucket, the operation polling, the sharded
 * output — follows from that one limit.
 *
 * ## The shape of a job
 *
 *   R2 → GCS (lib/google/storage.ts)
 *       → batchProcess          returns an operation name, immediately
 *       → poll the operation    minutes, sometimes tens of minutes
 *       → read output shards    JSON documents under an output prefix
 *       → domain/ocr.ts         pages, in order, as paragraphs
 *
 * Nothing here blocks a request on the middle step. `startBatchOcr`
 * returns as soon as Google accepts the job; whoever polls does so on a
 * later request. A Worker cannot hold a request open for the length of
 * an OCR run and should not try.
 */

import {
  type OcrPage,
  codePoints,
  offset,
  orderPages,
  sliceSegment,
  tidyParagraph,
} from '../../domain/ocr'
import { googleAccessToken } from './auth'
import { listObjects, readObject } from './storage'

/**
 * Regional endpoint, derived from the location.
 *
 * Not optional and not the global host: a processor is reachable only
 * through the endpoint for the region it was created in, and calling
 * `documentai.googleapis.com` for a processor in `asia-southeast1`
 * returns a confusing 404 about the processor rather than about the
 * host.
 */
function endpoint(location: string): string {
  return `https://${location}-documentai.googleapis.com/v1`
}

export interface BatchOcrRequest {
  /** Base64 service-account JSON, from GOOGLE_SERVICE_ACCOUNT_KEY. */
  encodedKey: string
  /** Full processor resource name, from DOCUMENT_AI_PROCESSOR. */
  processor: string
  location: string
  bucket: string
  /** Object name in the bucket, as staged by `stageForConversion`. */
  inputName: string
  mimeType: string
  /** Where output goes. Must end in a slash. */
  outputPrefix: string
}

/**
 * Submit a book for OCR. Returns the operation to poll.
 *
 * `skipHumanReview` is true because the human review this project cares
 * about is its own — an editor working on the DOCX master, per CLAUDE.md
 * section 7 — not Google's review queue, which reviews extraction
 * against a schema and has nothing to say about a scanned book.
 */
export async function startBatchOcr(request: BatchOcrRequest): Promise<string> {
  const token = await googleAccessToken(request.encodedKey)

  const response = await fetch(`${endpoint(request.location)}/${request.processor}:batchProcess`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputDocuments: {
        gcsDocuments: {
          documents: [
            {
              gcsUri: `gs://${request.bucket}/${request.inputName}`,
              mimeType: request.mimeType,
            },
          ],
        },
      },
      documentOutputConfig: {
        gcsOutputConfig: { gcsUri: `gs://${request.bucket}/${request.outputPrefix}` },
      },
      skipHumanReview: true,
    }),
  })

  if (!response.ok) {
    throw new Error(`Document AI batchProcess failed: ${response.status} ${await response.text()}`)
  }

  const body = (await response.json()) as { name?: string }
  if (!body.name) throw new Error('Document AI returned no operation name')
  return body.name
}

export type OcrState = 'running' | 'succeeded' | 'failed'

export interface OcrStatus {
  state: OcrState
  /** Set when failed. Safe to show an administrator; never a credential. */
  message?: string
}

/**
 * Where an operation has got to.
 *
 * `done` alone is not success — a failed operation is also done, with an
 * `error` beside it. Reading only `done` is the classic way to treat a
 * failure as a finished job and then wonder why the output prefix is
 * empty.
 */
export async function ocrStatus({
  encodedKey,
  location,
  operation,
}: {
  encodedKey: string
  location: string
  operation: string
}): Promise<OcrStatus> {
  const token = await googleAccessToken(encodedKey)

  const response = await fetch(`${endpoint(location)}/${operation}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error(`Document AI operation read failed: ${response.status} ${await response.text()}`)
  }

  const body = (await response.json()) as {
    done?: boolean
    error?: { message?: string }
    metadata?: { state?: string; stateMessage?: string }
  }

  if (body.error) {
    return { state: 'failed', message: body.error.message ?? 'OCR failed.' }
  }
  if (!body.done) return { state: 'running' }

  // Done without an error, but the batch metadata carries its own state
  // and can report FAILED for the individual document while the
  // operation itself succeeded.
  const state = body.metadata?.state
  if (state === 'FAILED' || state === 'CANCELLED') {
    return { state: 'failed', message: body.metadata?.stateMessage ?? `OCR ${state.toLowerCase()}.` }
  }
  return { state: 'succeeded' }
}

/** The Document JSON shape, reduced to the parts we read. */
interface DocumentShard {
  text?: string
  shardInfo?: { textOffset?: string | number }
  pages?: {
    pageNumber?: number
    paragraphs?: {
      layout?: { textAnchor?: { textSegments?: { startIndex?: string; endIndex?: string }[] } }
    }[]
  }[]
}

/**
 * Turn one output shard into pages.
 *
 * `textOffset` is the shard's position in the whole document's text, and
 * every segment index in the shard is relative to that whole. So the
 * shard's own text has to be indexed by (segment − textOffset). Getting
 * this wrong on a single-shard document is invisible, because the offset
 * is 0; it only breaks on books long enough to shard, which are the ones
 * where re-running OCR is most expensive.
 */
export function pagesFromShard(shard: DocumentShard): OcrPage[] {
  // Once per shard, not once per paragraph: a shard is a megabyte of
  // text and a book has thousands of paragraphs.
  const units = codePoints(shard.text ?? '')
  const base = offset(shard.shardInfo?.textOffset)

  return (shard.pages ?? []).map((page, index) => {
    const paragraphs = (page.paragraphs ?? [])
      .flatMap((paragraph) => paragraph.layout?.textAnchor?.textSegments ?? [])
      .map((segment) =>
        tidyParagraph(
          sliceSegment(units, {
            start: offset(segment.startIndex) - base,
            end: offset(segment.endIndex) - base,
          }),
        ),
      )
      .filter((paragraph) => paragraph.length > 0)

    return {
      // pageNumber is 1-based and document-wide, which is what we want.
      // Falling back to the array index would restart at 1 in every
      // shard, so it is offset by the base page — but only as a
      // fallback, since Document AI does send it.
      number: page.pageNumber ?? index + 1,
      paragraphs,
    }
  })
}

/**
 * Read every shard under the output prefix and assemble the book.
 *
 * Output lands as `{prefix}{operation-id}/0/....json`, one or more of
 * them. They are read in whatever order the bucket lists and reordered
 * by page number afterwards — see `orderPages`, which exists because a
 * lexicographic listing puts shard 10 before shard 2.
 */
export async function collectOcrPages({
  encodedKey,
  bucket,
  outputPrefix,
}: {
  encodedKey: string
  bucket: string
  outputPrefix: string
}): Promise<OcrPage[]> {
  const token = await googleAccessToken(encodedKey)
  const names = (await listObjects(token, bucket, outputPrefix)).filter((name) =>
    name.endsWith('.json'),
  )

  if (names.length === 0) {
    throw new Error(`OCR produced no output under ${outputPrefix}`)
  }

  const pages: OcrPage[] = []
  for (const name of names) {
    const response = await readObject(token, bucket, name)
    const shard = (await response.json()) as DocumentShard
    pages.push(...pagesFromShard(shard))
  }

  return orderPages(pages)
}
