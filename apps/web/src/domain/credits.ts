/**
 * Credits: what a book costs, and how a reader comes to have any.
 *
 * Credits pay for *taking a book away* — sending it to a Kindle. They
 * never pay for reading. The online reader is free and unlimited, which
 * is not a generosity setting but the product thesis: NobleSee exists to
 * make these books pleasant to read, and a reader who cannot afford a
 * credit must still be able to read every word. Monetization stays
 * secondary to the reading mission (CLAUDE.md, Business model).
 *
 * Framework-independent, like everything in `src/domain`. Callers supply
 * the balance, the ledger and the clock; this module decides.
 */

/** A credit buys this many pages of book, rounded up. */
export const PAGES_PER_CREDIT = 70

/** Even a pamphlet costs something; even a canon does not cost the earth. */
export const MIN_BOOK_PRICE = 1
export const MAX_BOOK_PRICE = 7

/** What a new account starts with. */
export const SIGNUP_GRANT = 10

/**
 * The monthly grant.
 *
 * A reader who showed up gets more than one who did not — but one who
 * did not still gets something. Reading is not a streak to be broken,
 * and a reader who was away for three months should come back to a
 * library that kept a little aside for them rather than to a penalty.
 */
export const ACTIVE_MONTH_GRANT = 5
export const INACTIVE_MONTH_GRANT = 2

/**
 * How far back a returning reader's accrual is honoured.
 *
 * Accrual is lazy — it happens when we next see the reader, not on a
 * schedule (see `accrualFor`) — so someone returning after four years
 * would otherwise arrive to a windfall of 96 credits. Two years of
 * backlog is generous and bounded.
 */
export const MAX_BACKLOG_MONTHS = 24

export type CreditReason =
  | 'signup'
  | 'monthly_active'
  | 'monthly_inactive'
  /** First delivery of a book: the reader buys it, at its length price. */
  | 'unlock'
  /** Any delivery after the first, at the flat resend price. */
  | 'resend'
  /** Paid to an uploader when a reader sends their book. */
  | 'uploader_share'
  | 'adjustment'

/**
 * The price of a book, in credits.
 *
 * Priced by length, because length is what a reader actually receives
 * and the one measure that cannot be gamed by how we chose to package
 * it. Pages come from the DOCX master — the source of truth for the
 * book's content (CLAUDE.md section 5) — so the price does not shift
 * when a PDF variant is re-rendered at a larger type size.
 *
 * A book whose page count is unknown costs the minimum rather than the
 * maximum: we do not charge a reader for our own missing metadata.
 */
export function priceInCredits(pageCount: number | null | undefined): number {
  if (typeof pageCount !== 'number' || !Number.isFinite(pageCount) || pageCount <= 0) {
    return MIN_BOOK_PRICE
  }
  const byLength = Math.ceil(pageCount / PAGES_PER_CREDIT)
  return Math.min(MAX_BOOK_PRICE, Math.max(MIN_BOOK_PRICE, byLength))
}

/** `YYYY-MM` in UTC — the unit the monthly grant is counted in. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Months between two keys, `to` minus `from`. Negative if `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  if (!fy || !fm || !ty || !tm) return 0
  return (ty - fy) * 12 + (tm - fm)
}

/** The key `n` months after `from`. */
export function addMonths(from: string, n: number): string {
  const [year, month] = from.split('-').map(Number)
  const zeroBased = (year ?? 0) * 12 + (month ?? 1) - 1 + n
  return `${Math.floor(zeroBased / 12)}-${String((zeroBased % 12) + 1).padStart(2, '0')}`
}

export interface CreditGrant {
  month: string
  credits: number
  reason: 'monthly_active' | 'monthly_inactive'
}

/**
 * What a reader is owed, worked out at the moment they sign in.
 *
 * There is no scheduled job behind this, and that is a design decision
 * rather than a shortcut. The trick that makes it work: **a sign-in
 * always grants for its own month, immediately.** So any month with no
 * grant recorded against it is, by construction, a month the reader did
 * not sign in — and can be paid the inactive rate on sight, without
 * storing a per-month attendance record.
 *
 * A reader who never returns accrues nothing until they do, which is
 * also correct: credits they cannot spend are not owed to anyone, and
 * the alternative is a monthly cron writing rows for dormant accounts
 * forever.
 *
 * @param grantedThrough the last month already paid, or null for an
 *        account that has only ever had its signup grant
 */
export function accrualFor({
  grantedThrough,
  now,
}: {
  grantedThrough: string | null | undefined
  now: Date
}): CreditGrant[] {
  const current = monthKey(now)

  // Never accrued before: this sign-in establishes the baseline. The
  // signup grant already covered them, so there is nothing to backfill.
  if (!grantedThrough) {
    return [{ month: current, credits: ACTIVE_MONTH_GRANT, reason: 'monthly_active' }]
  }

  const elapsed = monthsBetween(grantedThrough, current)

  // Already paid for this month, or a stored key somehow ahead of the
  // clock. Either way there is nothing to grant, and paying again on
  // every page load would be the worst possible bug to have here.
  if (elapsed <= 0) return []

  const grants: CreditGrant[] = []
  const firstUnpaid = Math.max(1, elapsed - MAX_BACKLOG_MONTHS + 1)

  // Every month between the last grant and this one went by without a
  // sign-in, or it would have granted itself at the time.
  for (let offset = firstUnpaid; offset < elapsed; offset += 1) {
    grants.push({
      month: addMonths(grantedThrough, offset),
      credits: INACTIVE_MONTH_GRANT,
      reason: 'monthly_inactive',
    })
  }

  // And this month, which the reader is demonstrably present for.
  grants.push({ month: current, credits: ACTIVE_MONTH_GRANT, reason: 'monthly_active' })
  return grants
}

export function totalCredits(grants: readonly CreditGrant[]): number {
  return grants.reduce((sum, grant) => sum + grant.credits, 0)
}

/**
 * What a repeat delivery of a book you already hold costs.
 *
 * Not free, and deliberately so: with the rolling 24-hour cap gone,
 * this is the only thing standing between a compromised account and an
 * unbounded stream of deliveries. One credit is small enough that a
 * reader re-sending to a replaced Kindle barely notices, and large
 * enough that a script cannot run forever.
 *
 * It is charged with a confirmation rather than silently — see
 * `SendToKindleButton`. Taking a credit without asking would be exactly
 * the kind of dark pattern this project rules out.
 */
export const RESEND_PRICE = 1

export type DeliveryDecision =
  | { allowed: true; cost: number; isResend: boolean; balanceAfter: number }
  | {
      allowed: false
      reason: 'insufficient_credits'
      cost: number
      isResend: boolean
      short: number
    }

/**
 * Whether this reader may send this book to their device, and at what
 * price.
 *
 * The first delivery buys the book, at its length-based price. Every
 * delivery after that costs `RESEND_PRICE`, which is the gate that
 * replaced the old per-24-hour book cap.
 */
export function decideDelivery({
  price,
  balance,
  alreadyOwned,
}: {
  price: number
  balance: number
  /** Has this reader already had this book delivered? */
  alreadyOwned: boolean
}): DeliveryDecision {
  const cost = alreadyOwned ? RESEND_PRICE : price

  if (balance < cost) {
    return {
      allowed: false,
      reason: 'insufficient_credits',
      cost,
      isResend: alreadyOwned,
      short: cost - balance,
    }
  }

  return { allowed: true, cost, isResend: alreadyOwned, balanceAfter: balance - cost }
}
