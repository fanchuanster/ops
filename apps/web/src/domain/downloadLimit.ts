/**
 * Per-reader download limiting.
 *
 * The rule that matters, and the one most easily got wrong: the limit
 * counts **distinct books within a rolling window**, not files. A reader
 * who takes EPUB, DOCX and three PDF variants of the same book has
 * consumed *one* slot, because they read one book. Charging them five
 * would punish the reader for our own format choices.
 *
 * This is an application-level fairness policy, not a bandwidth control
 * (MODERNIZATION.md section 13) — a CDN handles bandwidth.
 *
 * Framework-independent: callers supply the ledger rows, this module
 * decides. No database, no Payload, no clock of its own.
 */

export interface DownloadRecord {
  bookId: string
  /** When the download was authorized. */
  at: Date
}

export interface LimitPolicy {
  /** Distinct books permitted per window. */
  maxBooksPerWindow: number
  windowHours: number
}

export const DEFAULT_LIMIT_POLICY: LimitPolicy = {
  maxBooksPerWindow: 5,
  windowHours: 24,
}

export type LimitDecision =
  | { allowed: true; remaining: number; alreadyCounted: boolean }
  | { allowed: false; remaining: 0; retryAfter: Date }

/** Records that fall inside the rolling window ending at `now`. */
export function withinWindow(
  history: readonly DownloadRecord[],
  now: Date,
  policy: LimitPolicy = DEFAULT_LIMIT_POLICY,
): DownloadRecord[] {
  const cutoff = now.getTime() - policy.windowHours * 60 * 60 * 1000
  return history.filter((record) => record.at.getTime() > cutoff)
}

export function distinctBooksInWindow(
  history: readonly DownloadRecord[],
  now: Date,
  policy: LimitPolicy = DEFAULT_LIMIT_POLICY,
): Set<string> {
  return new Set(withinWindow(history, now, policy).map((record) => record.bookId))
}

/**
 * Decide whether this reader may download `bookId` now.
 *
 * A book already counted in the window is always allowed through, even
 * at the limit — otherwise finishing a book you started would be
 * blocked by your own earlier downloads of it.
 */
export function checkDownloadLimit(
  bookId: string,
  history: readonly DownloadRecord[],
  now: Date,
  policy: LimitPolicy = DEFAULT_LIMIT_POLICY,
): LimitDecision {
  const inWindow = withinWindow(history, now, policy)
  const books = new Set(inWindow.map((record) => record.bookId))

  if (books.has(bookId)) {
    return {
      allowed: true,
      remaining: Math.max(0, policy.maxBooksPerWindow - books.size),
      alreadyCounted: true,
    }
  }

  if (books.size >= policy.maxBooksPerWindow) {
    return { allowed: false, remaining: 0, retryAfter: nextSlotAt(inWindow, policy) }
  }

  return {
    allowed: true,
    remaining: policy.maxBooksPerWindow - books.size - 1,
    alreadyCounted: false,
  }
}

/**
 * When the oldest counted book leaves the window, freeing a slot.
 * Used for an honest `Retry-After` rather than a generic refusal.
 */
function nextSlotAt(inWindow: readonly DownloadRecord[], policy: LimitPolicy): Date {
  const oldestPerBook = new Map<string, number>()
  for (const record of inWindow) {
    const current = oldestPerBook.get(record.bookId)
    if (current === undefined || record.at.getTime() < current) {
      oldestPerBook.set(record.bookId, record.at.getTime())
    }
  }
  const earliest = Math.min(...oldestPerBook.values())
  return new Date(earliest + policy.windowHours * 60 * 60 * 1000)
}
