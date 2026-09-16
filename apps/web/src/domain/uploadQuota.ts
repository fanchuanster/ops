export const MONTHLY_UPLOAD_LIMIT: number = 3
export const MONTHLY_PAGE_LIMIT: number = 1200

export interface QuotaUsage {
  uploads: number
  pages: number
}

export interface QuotaRequest extends QuotaUsage {
  pagesRequested: number
  isAdmin?: boolean
}

export type QuotaDecision =
  | { allowed: true; uploadsLeft: number; pagesLeft: number }
  | {
      allowed: false
      reason: 'upload_limit' | 'page_limit'
      uploadsLeft: number
      pagesLeft: number
      over: number
    }

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

export function quotaMessage(decision: QuotaDecision): string | null {
  if (decision.allowed) return null

  if (decision.reason === 'upload_limit') {
    return `You have converted ${MONTHLY_UPLOAD_LIMIT} book${MONTHLY_UPLOAD_LIMIT === 1 ? '' : 's'} this month, which is the limit. Your allowance resets at the start of next month — the book stays here as a draft until then.`
  }

  const over = `${decision.over} page${decision.over === 1 ? '' : 's'}`
  return `This book is about ${over} more than your remaining allowance for this month (${decision.pagesLeft} of ${MONTHLY_PAGE_LIMIT} pages left). It stays here as a draft, and you can convert it next month.`
}

export function estimatePages(input: {
  pdfPageCount?: number | null
  characters?: number | null
}): number | null {
  if (typeof input.pdfPageCount === 'number' && input.pdfPageCount > 0) {
    return input.pdfPageCount
  }

  if (typeof input.characters === 'number' && input.characters > 0) {
    return Math.max(1, Math.ceil(input.characters / CHARACTERS_PER_PAGE))
  }

  return null
}

export const CHARACTERS_PER_PAGE = 1500
