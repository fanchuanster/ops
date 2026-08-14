/**
 * How much a reader may put through the conversion pipeline each month.
 *
 * Conversion is the expensive thing NobleSee does — OCR and LLM
 * correction on a scanned book is minutes to hours of CPU, and it is
 * offered free to anyone with an account. The quota exists so that
 * remains possible, not to ration a scarce good: almost nobody uploads
 * three books a month, and the reader who does is the one the limit is
 * for.
 *
 * Two limits, because one does not describe the cost. Three uploads
 * stops a script; twelve hundred pages stops three scanned
 * encyclopaedias. A reader can hit either without going near the other.
 *
 * Framework-independent, like everything in `src/domain`. The caller
 * counts the month's usage and passes it in.
 */

// Typed as `number` rather than left to infer the literal: these are
// tunable policy values, and a literal type makes TypeScript reject
// perfectly reasonable comparisons against them as "no overlap".
export const MONTHLY_UPLOAD_LIMIT: number = 3
export const MONTHLY_PAGE_LIMIT: number = 1200

export interface QuotaUsage {
  /** Books this reader has put through conversion this month. */
  uploads: number
  /** Pages those books came to, in total. */
  pages: number
}

export interface QuotaRequest extends QuotaUsage {
  /** Pages the book being converted now is expected to come to. */
  pagesRequested: number
  /**
   * Administrators are unlimited.
   *
   * Passed in rather than derived from a user object, because the domain
   * layer never sees one — it takes the decision, not the identity.
   */
  isAdmin?: boolean
}

export type QuotaDecision =
  | { allowed: true; uploadsLeft: number; pagesLeft: number }
  | {
      allowed: false
      reason: 'upload_limit' | 'page_limit'
      uploadsLeft: number
      pagesLeft: number
      /** Pages over the limit this book would put them. */
      over: number
    }

/**
 * May this book be converted?
 *
 * The page rule is "would this book take the total past the limit",
 * not "is there any room left". A reader with 200 pages of allowance
 * left and a 201-page book is refused, because letting it through since
 * *some* room existed would make the limit meaningless on exactly the
 * books that cost the most.
 *
 * A book that would not fit in an empty month is still refused, rather
 * than being allowed as a special case. That is a real edge — a book
 * longer than the whole monthly budget can never be converted — and it
 * is deliberate: the
 * limit is about what the pipeline can afford, and a book too big for
 * the monthly budget is too big full stop. The refusal says so.
 */
export function checkUploadQuota(request: QuotaRequest): QuotaDecision {
  const { uploads, pages, pagesRequested, isAdmin = false } = request

  if (isAdmin) {
    return { allowed: true, uploadsLeft: Infinity, pagesLeft: Infinity }
  }

  const uploadsLeft = Math.max(0, MONTHLY_UPLOAD_LIMIT - uploads)
  const pagesLeft = Math.max(0, MONTHLY_PAGE_LIMIT - pages)

  if (uploads >= MONTHLY_UPLOAD_LIMIT) {
    return { allowed: false, reason: 'upload_limit', uploadsLeft: 0, pagesLeft, over: 0 }
  }

  // Zero or unknown pages must not be a way through the page limit, but
  // it also should not fail: a book whose length we could not estimate
  // still counts against the upload limit, which is what catches it.
  const requested = Number.isFinite(pagesRequested) ? Math.max(0, pagesRequested) : 0

  if (pages + requested > MONTHLY_PAGE_LIMIT) {
    return {
      allowed: false,
      reason: 'page_limit',
      uploadsLeft,
      pagesLeft,
      over: pages + requested - MONTHLY_PAGE_LIMIT,
    }
  }

  return { allowed: true, uploadsLeft: uploadsLeft - 1, pagesLeft: pagesLeft - requested }
}

/** What a refused conversion should tell the reader. */
export function quotaMessage(decision: QuotaDecision): string | null {
  if (decision.allowed) return null

  if (decision.reason === 'upload_limit') {
    return `You have converted ${MONTHLY_UPLOAD_LIMIT} book${MONTHLY_UPLOAD_LIMIT === 1 ? '' : 's'} this month, which is the limit. Your allowance resets at the start of next month — the book stays here as a draft until then.`
  }

  const over = `${decision.over} page${decision.over === 1 ? '' : 's'}`
  return `This book is about ${over} more than your remaining allowance for this month (${decision.pagesLeft} of ${MONTHLY_PAGE_LIMIT} pages left). It stays here as a draft, and you can convert it next month.`
}

/**
 * Roughly how many pages a source file will come to.
 *
 * A real page count needs the book rendered, which is the converter's
 * job and happens far too late to decide whether to start converting.
 * So the quota runs on an estimate, and the estimate is deliberately
 * generous — rounding a reader's usage *up* means the limit is never
 * quietly exceeded, and the exact count replaces it once conversion
 * finishes.
 *
 * Returns null when there is nothing to go on, which the quota treats
 * as zero pages rather than refusing: an unmeasurable book is still
 * caught by the upload count.
 */
export function estimatePages(input: {
  /** From the PDF page tree, when it could be read. */
  pdfPageCount?: number | null
  /** Characters of extractable text, for DOCX and plain text. */
  characters?: number | null
}): number | null {
  if (typeof input.pdfPageCount === 'number' && input.pdfPageCount > 0) {
    return input.pdfPageCount
  }

  if (typeof input.characters === 'number' && input.characters > 0) {
    // A printed page of this library's typical setting holds roughly
    // this much. Chinese text runs far denser per character than Latin,
    // so the figure is a compromise that errs towards more pages.
    return Math.max(1, Math.ceil(input.characters / CHARACTERS_PER_PAGE))
  }

  return null
}

export const CHARACTERS_PER_PAGE = 1500
