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
  type OcrBox,
  type OcrPage,
  type TextSegment,
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
  /**
   * Ask for type-size and weight information.
   *
   * A **paid extra**. `computeStyleInfo` is one of Document AI's premium
   * features and is billed above the base per-page rate, so this is off
   * unless the deployment turns it on — see DOCUMENT_AI_STYLE_INFO in
   * `lib/ocrPipeline.ts`.
   *
   * What it buys is headings. Without it every paragraph is classified
   * `body`, because type size is the only evidence that distinguishes a
   * chapter title from a sentence and guessing from length alone
   * invents chapters (`domain/ocr.ts`).
   */
  styleInfo?: boolean
  /**
   * BCP-47 language hints, most likely first.
   *
   * Free, and worth setting. The engine detects script perfectly well
   * but hints resolve the genuinely ambiguous cases — Traditional
   * versus Simplified, and Han characters shared with Japanese — which
   * is exactly the material this library is made of.
   */
  languageHints?: readonly string[]
}

/**
 * The default hints for this library.
 *
 * Traditional first, then Simplified, then English. Order is a
 * preference and not a restriction: an English book sent with these
 * hints is still read as English.
 */
export const DEFAULT_LANGUAGE_HINTS = ['zh-Hant', 'zh-Hans', 'en'] as const

/**
 * OCR options for one request.
 *
 * Everything here was previously left unset, which meant every option
 * took its default: no hints, no native PDF parsing, no style. Two of
 * the three cost nothing to fix.
 */
function ocrConfig(request: BatchOcrRequest): Record<string, unknown> {
  const config: Record<string, unknown> = {
    hints: { languageHints: [...(request.languageHints ?? DEFAULT_LANGUAGE_HINTS)] },
    // Free, and strictly better on a PDF that already has a text layer:
    // the characters are read from the file rather than recognised from
    // a rendering of it. `needsOcr` deliberately sends every PDF here
    // rather than trying to tell scanned from born-digital, so this is
    // the option that makes that choice cheap.
    enableNativePdfParsing: true,
  }

  if (request.styleInfo) {
    // Nested under premiumFeatures rather than set as the top-level
    // `computeStyleInfo`, which the API marks deprecated.
    config.premiumFeatures = { computeStyleInfo: true }
  }

  return config
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
      processOptions: { ocrConfig: ocrConfig(request) },
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
interface NormalizedVertex {
  x?: number
  y?: number
}

interface DocumentLayout {
  textAnchor?: { textSegments?: { startIndex?: string; endIndex?: string }[] }
  boundingPoly?: { normalizedVertices?: NormalizedVertex[] }
}

interface DocumentToken {
  layout?: DocumentLayout
  styleInfo?: { fontSize?: number; pixelFontSize?: number; bold?: boolean }
}

interface DocumentShard {
  text?: string
  shardInfo?: { textOffset?: string | number }
  pages?: {
    pageNumber?: number
    paragraphs?: { layout?: DocumentLayout }[]
    tokens?: DocumentToken[]
  }[]
}

/**
 * The axis-aligned hull of a bounding polygon.
 *
 * Document AI returns four vertices, which are not axis-aligned on a
 * skewed scan — and a scanned book is very often slightly skewed. Taking
 * the extremes rather than assuming vertex 0 is the top left is what
 * keeps a crooked page's running head in the margin band where the
 * detector can find it.
 */
export function hullOf(layout: DocumentLayout | undefined): OcrBox | undefined {
  const vertices = layout?.boundingPoly?.normalizedVertices
  if (!vertices || vertices.length === 0) return undefined

  const xs = vertices.map((v) => v.x ?? 0)
  const ys = vertices.map((v) => v.y ?? 0)
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  }
}

/** Do two segments overlap at all? */
function overlaps(a: TextSegment, b: TextSegment): boolean {
  return a.start < b.end && b.start < a.end
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((x, y) => x - y)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * The type size and weight of a paragraph, from the tokens inside it.
 *
 * Document AI reports style per *token*, not per paragraph, so a
 * paragraph's size has to be gathered from the tokens whose text range
 * falls inside the paragraph's. The median again, so one large drop
 * capital does not make the whole paragraph a heading — which is
 * precisely the mistake that would turn the first paragraph of every
 * chapter into a chapter title.
 *
 * `fontSize` is in points and `pixelFontSize` in pixels; either is
 * usable because everything downstream compares sizes to the book's own
 * median rather than to an absolute. Points are preferred when present
 * so the comparison is not disturbed by a change of scan resolution
 * partway through a book.
 */
export function styleOf(
  tokens: readonly DocumentToken[],
  paragraph: TextSegment,
  base: number,
): { fontSize?: number; bold?: boolean } {
  const sizes: number[] = []
  let bold = 0
  let counted = 0

  for (const token of tokens) {
    const segments = token.layout?.textAnchor?.textSegments ?? []
    const inside = segments.some((segment) =>
      overlaps(
        { start: offset(segment.startIndex) - base, end: offset(segment.endIndex) - base },
        paragraph,
      ),
    )
    if (!inside) continue

    counted += 1
    const size = token.styleInfo?.fontSize ?? token.styleInfo?.pixelFontSize
    if (typeof size === 'number' && size > 0) sizes.push(size)
    if (token.styleInfo?.bold) bold += 1
  }

  const fontSize = median(sizes)
  return {
    ...(fontSize === undefined ? {} : { fontSize }),
    // Bold only if most of the paragraph is, so an emphasised phrase
    // inside a sentence does not make the sentence a heading.
    ...(counted > 0 && bold > counted / 2 ? { bold: true } : {}),
  }
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
    const tokens = page.tokens ?? []

    const paragraphs = (page.paragraphs ?? [])
      .flatMap((paragraph) =>
        (paragraph.layout?.textAnchor?.textSegments ?? []).map((segment) => ({
          segment,
          layout: paragraph.layout,
        })),
      )
      .map(({ segment, layout }) => {
        const range = {
          start: offset(segment.startIndex) - base,
          end: offset(segment.endIndex) - base,
        }
        return {
          text: tidyParagraph(sliceSegment(units, range)),
          ...(hullOf(layout) ? { box: hullOf(layout) } : {}),
          // Skipped entirely when no token carries style, which is the
          // case whenever the paid feature is off — one pass over the
          // page's tokens per paragraph is not free on a dense page.
          // `base` again, because the token offsets are in whole-document
          // space exactly as the paragraph's were, and `range` above has
          // already been rebased into this shard.
          ...(tokens.some((token) => token.styleInfo)
            ? styleOf(tokens, range, base)
            : {}),
        }
      })
      .filter((paragraph) => paragraph.text.length > 0)

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
}): Promise<{ pages: OcrPage[]; pageCount: number }> {
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

  // Counted before the blank ones are dropped. A blank verso is still a
  // page of the book, and the count is what the credit price derives
  // from — so counting only pages with text on them would under-charge
  // every book with plates, part-title pages or a blank last leaf.
  return { pages: orderPages(pages), pageCount: pages.length }
}
