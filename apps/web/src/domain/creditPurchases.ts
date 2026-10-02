export const CREDIT_PRICE_USD = 1

export const MIN_PURCHASE_CREDITS = 1
export const MAX_PURCHASE_CREDITS = 500

export const QUICK_AMOUNTS = [10, 25, 50, 100, 250] as const

export const PAYMENT_WINDOW_MINUTES = 60

export const COINS = [
  { id: 'btc', label: 'BTC' },
  { id: 'eth', label: 'ETH' },
  { id: 'usdc', label: 'USDC (ERC20)' },
  { id: 'ltc', label: 'LTC' },
  { id: 'sol', label: 'SOL' },
] as const

export type CoinId = (typeof COINS)[number]['id']

export type PurchaseStatus = 'pending' | 'paid' | 'failed' | 'expired'

export function isCoin(value: unknown): value is CoinId {
  return COINS.some((coin) => coin.id === value)
}

export function coinLabel(id: string): string {
  return COINS.find((coin) => coin.id === id)?.label ?? id.toUpperCase()
}

export function checkPurchaseAmount(
  raw: unknown,
): { ok: true; credits: number } | { ok: false; problem: string } {
  const credits = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(credits)) return { ok: false, problem: 'Enter a whole number of credits.' }
  if (credits < MIN_PURCHASE_CREDITS) {
    return { ok: false, problem: `The smallest purchase is ${MIN_PURCHASE_CREDITS} credit.` }
  }
  if (credits > MAX_PURCHASE_CREDITS) {
    return { ok: false, problem: `The largest single purchase is ${MAX_PURCHASE_CREDITS} credits.` }
  }
  return { ok: true, credits }
}

export function priceInUsd(credits: number): number {
  return credits * CREDIT_PRICE_USD
}

export function newOrderId(userId: string | number, random: string): string {
  return `ns-${userId}-${random}`
}

export function statusFromProvider(providerStatus: string | null | undefined): PurchaseStatus {
  switch (providerStatus) {
    case 'finished':
      return 'paid'
    case 'failed':
    case 'refunded':
      return 'failed'
    case 'expired':
      return 'expired'
    default:
      return 'pending'
  }
}

export function windowEndsAt(now: Date): Date {
  return new Date(now.getTime() + PAYMENT_WINDOW_MINUTES * 60_000)
}

export function isResumable(
  purchase: { status: string; expiresAt?: string | null },
  now: Date,
): boolean {
  if (purchase.status !== 'pending') return false
  if (!purchase.expiresAt) return false
  return new Date(purchase.expiresAt).getTime() > now.getTime()
}

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => [key, sortKeys(inner)]),
  )
}

export function signedPayload(body: unknown): string {
  return JSON.stringify(sortKeys(body))
}

export function sameSignature(expected: string, given: string | null | undefined): boolean {
  if (!given || expected.length !== given.length) return false
  let difference = 0
  for (let i = 0; i < expected.length; i += 1) {
    difference |= expected.charCodeAt(i) ^ given.toLowerCase().charCodeAt(i)
  }
  return difference === 0
}
