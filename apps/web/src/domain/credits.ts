export const PAGES_PER_CREDIT = 70

export const MIN_BOOK_PRICE = 1
export const MAX_BOOK_PRICE = 7

export const SIGNUP_GRANT = 10

export const ACTIVE_MONTH_GRANT = 5
export const INACTIVE_MONTH_GRANT = 2

export const MAX_BACKLOG_MONTHS = 24

export type CreditReason =
  | 'signup'
  | 'monthly_active'
  | 'monthly_inactive'
  | 'unlock'
  | 'resend'
  | 'uploader_share'
  | 'adjustment'

export function priceInCredits(pageCount: number | null | undefined): number {
  if (typeof pageCount !== 'number' || !Number.isFinite(pageCount) || pageCount <= 0) {
    return MIN_BOOK_PRICE
  }
  const byLength = Math.ceil(pageCount / PAGES_PER_CREDIT)
  return Math.min(MAX_BOOK_PRICE, Math.max(MIN_BOOK_PRICE, byLength))
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  if (!fy || !fm || !ty || !tm) return 0
  return (ty - fy) * 12 + (tm - fm)
}

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

export function accrualFor({
  grantedThrough,
  now,
}: {
  grantedThrough: string | null | undefined
  now: Date
}): CreditGrant[] {
  const current = monthKey(now)

  if (!grantedThrough) {
    return [{ month: current, credits: ACTIVE_MONTH_GRANT, reason: 'monthly_active' }]
  }

  const elapsed = monthsBetween(grantedThrough, current)

  if (elapsed <= 0) return []

  const grants: CreditGrant[] = []
  const firstUnpaid = Math.max(1, elapsed - MAX_BACKLOG_MONTHS + 1)

  for (let offset = firstUnpaid; offset < elapsed; offset += 1) {
    grants.push({
      month: addMonths(grantedThrough, offset),
      credits: INACTIVE_MONTH_GRANT,
      reason: 'monthly_inactive',
    })
  }

  grants.push({ month: current, credits: ACTIVE_MONTH_GRANT, reason: 'monthly_active' })
  return grants
}

export function totalCredits(grants: readonly CreditGrant[]): number {
  return grants.reduce((sum, grant) => sum + grant.credits, 0)
}

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

export function decideDelivery({
  price,
  balance,
  alreadyOwned,
}: {
  price: number
  balance: number
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
