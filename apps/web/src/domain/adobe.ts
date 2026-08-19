/**
 * Adobe PDF Services, as far as the pipeline is concerned.
 *
 * Phase 1 used to be two halves: Document AI read the pages into text,
 * and the converter turned that text into a DOCX master. Adobe's Export
 * PDF operation does both in one call — it OCRs a scan and returns a
 * Word document with real heading styles — so for a PDF source phase 1
 * is now a single HTTP job and the converter's master stage is skipped
 * entirely.
 *
 * What that deletes is `domain/ocr.ts`'s entire reason for existing: the
 * shard rebasing, the code-point offsets, the running-head geometry, the
 * type-size heading classification. None of it survives because none of
 * it is ours to do any more. The two things it bought are bought again
 * by Adobe, differently:
 *
 *  - **Running heads and folios** land in Word's own header and footer
 *    parts, which `docx.paragraphs` on the converter side does not walk.
 *    They are excluded by where they are, rather than by inferring their
 *    position from normalized vertices.
 *
 *  - **Headings** come back as the built-in `Heading 1` / `Heading 2`
 *    styles, which `sources/docx_in.py` already maps to CHAPTER and
 *    SECTION — because a corrected master had to be readable back
 *    anyway. Adobe's structure detection replaces our type-size ratios.
 *
 * Framework-independent, like everything in `src/domain`. No fetch, no
 * Payload, no storage client.
 */

/**
 * The OCR locales Export PDF accepts, for the languages this library
 * actually holds.
 *
 * `zh-Hant` is the one that decides the question. This project's centre
 * of gravity is traditional Chinese, and an export engine that could
 * only read simplified would have to be rejected however good it was at
 * everything else.
 *
 * Note the asymmetry with Adobe's *other* OCR operation, which spells
 * these `zh-CN` and `zh-HK` and has no `zh-Hant` at all. They are
 * separate enums in Adobe's own SDK and are not interchangeable; these
 * are Export PDF's.
 */
export type ExportLocale = 'zh-Hant' | 'zh-CN' | 'en-US'

/**
 * Which locale to read a book's scan in.
 *
 * Mixed Chinese/English resolves to traditional Chinese rather than to
 * English: Adobe reads Latin script under a CJK locale far better than
 * it reads CJK under a Latin one, so the asymmetric failure decides it.
 */
export function exportLocaleFor(language: string | null | undefined): ExportLocale {
  switch (language) {
    case 'zh-Hans':
      return 'zh-CN'
    case 'en':
      return 'en-US'
    // 'zh-Hant', 'zh-en', and anything unset or unrecognised.
    default:
      return 'zh-Hant'
  }
}

/**
 * The largest file Adobe will accept, in bytes.
 *
 * A published limit, not a guess, and it is the one real constraint this
 * engine imposes on the material: a 400-page book scanned at 300dpi
 * clears 100MB without difficulty, and those are exactly the historical
 * scans the project exists to preserve. Checked here, before the upload,
 * so an oversized book fails in a second with something an uploader can
 * act on rather than after a slow rejected PUT.
 */
export const MAX_SOURCE_BYTES = 100 * 1024 * 1024

/**
 * How many document transactions a book of this many pages costs.
 *
 * One per 50 pages, rounded up, which is Adobe's billing unit for Export
 * PDF. Not used to decide anything — the quota in `domain/uploadQuota.ts`
 * is what bounds usage — but recorded so the cost of a book is a number
 * somebody can look at rather than infer from an invoice.
 */
export function documentTransactions(pages: number): number {
  if (!Number.isFinite(pages) || pages <= 0) return 1
  return Math.ceil(pages / 50)
}

/** Whether a source is small enough to send. */
export function withinSizeLimit(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_SOURCE_BYTES
}

/** What a poll of a running export found. */
export type ExportState = 'running' | 'done' | 'failed'

export interface ExportOutcome {
  state: ExportState
  /** Present only when `done`. Short-lived and single-use. */
  downloadUri?: string
  /** Present only when `failed`. */
  message?: string
}

/**
 * Read a job-status body without trusting its shape.
 *
 * Adobe reports `in progress`, `done` or `failed` in a `status` field,
 * with the finished file under `asset.downloadUri`. Anything else is
 * treated as still running rather than as a failure: a status word we do
 * not recognise means the vendor added one, and abandoning a job we have
 * already paid for on that basis would be the expensive way to be wrong.
 * A genuinely stuck job is caught by `exportHasExpired` instead.
 */
export function readExportStatus(body: unknown): ExportOutcome {
  if (typeof body !== 'object' || body === null) return { state: 'running' }
  const record = body as Record<string, unknown>
  const status = typeof record.status === 'string' ? record.status.toLowerCase() : ''

  if (status === 'failed') {
    const error = record.error
    const message =
      typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'Adobe could not read this PDF.'
    return { state: 'failed', message }
  }

  if (status === 'done') {
    const asset = record.asset
    const uri =
      typeof asset === 'object' && asset !== null && typeof (asset as { downloadUri?: unknown }).downloadUri === 'string'
        ? (asset as { downloadUri: string }).downloadUri
        : ''
    if (uri.length === 0) {
      return { state: 'failed', message: 'Adobe reported the export finished but returned no file.' }
    }
    return { state: 'done', downloadUri: uri }
  }

  return { state: 'running' }
}

/**
 * How long a running export may go unfinished before it is abandoned.
 *
 * Adobe's assets expire after 24 hours, so a job still running past that
 * can never produce a file this application could fetch — the poll would
 * repeat forever against a URL whose result is already gone. Six hours
 * is well past any real book and well inside that expiry, so the book
 * fails while an uploader can still be told something useful.
 */
export const EXPORT_TIMEOUT_MS = 6 * 60 * 60 * 1000

export function exportHasExpired(startedAt: string | null | undefined, now: number): boolean {
  if (!startedAt) return false
  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) return false
  return now - started > EXPORT_TIMEOUT_MS
}

/**
 * Does this source need Adobe at all?
 *
 * A DOCX or a plain text file already *is* text; exporting it would cost
 * a transaction to recover characters we were handed. Those go straight
 * to the converter, which reads the original and builds the master
 * itself — the path that still exists for exactly this case.
 *
 * PDFs always go to Adobe, including ones with a text layer. Telling a
 * scanned PDF from a born-digital one reliably is its own problem, and
 * Export PDF handles both; so the cost of being wrong in this direction
 * is one transaction, and in the other it is a book of empty pages.
 */
export function needsExport(filename: string, mimeType?: string | null): boolean {
  if (mimeType === 'application/pdf') return true
  if (mimeType && mimeType !== 'application/octet-stream') return false
  return /\.pdf$/i.test(filename.trim())
}

/** Where a book's DOCX master lives. */
export function masterKey(bookId: string | number): string {
  return `books/${bookId}/book/master.docx`
}
