export const CREDIT_PRICE_USD = 1

export const MIN_PURCHASE_CREDITS = 3
export const MAX_PURCHASE_CREDITS = 500

export const QUICK_AMOUNTS = [3, 10, 25, 50, 100, 250] as const

export const PAYMENT_WINDOW_MINUTES = 60

export const COINS = [
  { id: 'usdcsol', label: 'USDC (Solana)', minCredits: 3, feeNote: 'Network fee: usually under $0.01' },
  { id: 'sol', label: 'SOL', minCredits: 3, feeNote: 'Network fee: usually under $0.01' },
  { id: 'ltc', label: 'LTC', minCredits: 3, feeNote: 'Network fee: usually a few cents' },
  { id: 'eth', label: 'ETH', minCredits: 10, feeNote: 'Network fee: can be $1 or more' },
  { id: 'btc', label: 'BTC', minCredits: 25, feeNote: 'Network fee: can be $1 or more' },
] as const

export type CoinId = (typeof COINS)[number]['id']

export type PurchaseStatus = 'pending' | 'paid' | 'failed' | 'expired'

export function isCoin(value: unknown): value is CoinId {
  return COINS.some((coin) => coin.id === value)
}

export function minimumCreditsFor(id: string): number {
  return COINS.find((coin) => coin.id === id)?.minCredits ?? MIN_PURCHASE_CREDITS
}

export function coinFeeNote(id: string): string {
  return COINS.find((coin) => coin.id === id)?.feeNote ?? ''
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

const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const WEI_PER_ETH_DIGITS = 18

function plainDecimal(amount: string): string | null {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) return null
  if (/^\d+(\.\d+)?$/.test(amount)) return amount
  return value.toFixed(WEI_PER_ETH_DIGITS).replace(/0+$/, '').replace(/\.$/, '')
}

function toWei(decimal: string): string {
  const [whole, fraction = ''] = decimal.split('.')
  const padded = fraction.padEnd(WEI_PER_ETH_DIGITS, '0').slice(0, WEI_PER_ETH_DIGITS)
  return BigInt(`${whole}${padded}`).toString()
}

export function paymentUri(coin: string, address: string, amount: string): string {
  const decimal = plainDecimal(amount)
  if (!decimal) return address
  const to = encodeURIComponent(address)
  switch (coin) {
    case 'btc':
      return `bitcoin:${to}?amount=${decimal}`
    case 'ltc':
      return `litecoin:${to}?amount=${decimal}`
    case 'eth':
      return `ethereum:${to}?value=${toWei(decimal)}`
    case 'sol':
      return `solana:${to}?amount=${decimal}`
    case 'usdcsol':
      return `solana:${to}?amount=${decimal}&spl-token=${USDC_SOLANA_MINT}`
    default:
      return address
  }
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
