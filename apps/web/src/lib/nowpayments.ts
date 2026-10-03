import { sameSignature, signedPayload } from '../domain/creditPurchases'

const API = 'https://api.nowpayments.io/v1'

export interface NowPaymentsConfig {
  apiKey: string
  ipnSecret: string | null
}

export interface ProviderPayment {
  paymentId: string
  status: string
  payAddress: string | null
  payAmount: string | null
  orderId: string | null
}

export type ProviderResult =
  | { ok: true; payment: ProviderPayment }
  | { ok: false; error: string }

export function nowPaymentsConfig(env: {
  NOWPAYMENTS_API_KEY?: string
  NOWPAYMENTS_IPN_SECRET?: string
}): NowPaymentsConfig | null {
  const apiKey = env.NOWPAYMENTS_API_KEY?.trim()
  if (!apiKey) return null
  return { apiKey, ipnSecret: env.NOWPAYMENTS_IPN_SECRET?.trim() || null }
}

function readPayment(body: Record<string, unknown>): ProviderPayment {
  const text = (value: unknown) =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : null
  return {
    paymentId: text(body.payment_id) ?? '',
    status: text(body.payment_status) ?? 'waiting',
    payAddress: text(body.pay_address),
    payAmount: text(body.pay_amount),
    orderId: text(body.order_id),
  }
}

async function call(
  config: NowPaymentsConfig,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<ProviderResult> {
  let response: Response
  try {
    response = await fetch(`${API}${path}`, {
      method: init.method,
      headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Network error' }
  }

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok || !body) {
    const message = typeof body?.message === 'string' ? body.message : `status ${response.status}`
    return { ok: false, error: message }
  }
  return { ok: true, payment: readPayment(body) }
}

export function createProviderPayment(
  config: NowPaymentsConfig,
  args: {
    priceUsd: number
    payCurrency: string
    orderId: string
    description: string
    callbackUrl: string
  },
): Promise<ProviderResult> {
  return call(config, '/payment', {
    method: 'POST',
    body: {
      price_amount: args.priceUsd,
      price_currency: 'usd',
      pay_currency: args.payCurrency,
      order_id: args.orderId,
      order_description: args.description,
      ipn_callback_url: args.callbackUrl,
    },
  })
}

export type QuoteResult =
  | { ok: true; payAmount: string; minUsd: number | null }
  | { ok: false; error: string }

async function getJson(
  config: NowPaymentsConfig,
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${API}${path}`, { headers: { 'x-api-key': config.apiKey } })
    if (!response.ok) return null
    return (await response.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function fetchQuote(
  config: NowPaymentsConfig,
  args: { priceUsd: number; payCurrency: string },
): Promise<QuoteResult> {
  const currency = encodeURIComponent(args.payCurrency)
  const [estimate, minimum] = await Promise.all([
    getJson(config, `/estimate?amount=${args.priceUsd}&currency_from=usd&currency_to=${currency}`),
    getJson(config, `/min-amount?currency_from=${currency}&currency_to=usd&fiat_equivalent=usd`),
  ])
  const payAmount = estimate?.estimated_amount
  if (typeof payAmount !== 'number' && typeof payAmount !== 'string') {
    return { ok: false, error: 'No quote available right now.' }
  }
  const fiatMinimum = Number(minimum?.fiat_equivalent)
  return {
    ok: true,
    payAmount: String(payAmount),
    minUsd: Number.isFinite(fiatMinimum) && fiatMinimum > 0 ? fiatMinimum : null,
  }
}

export function fetchProviderPayment(
  config: NowPaymentsConfig,
  paymentId: string,
): Promise<ProviderResult> {
  return call(config, `/payment/${encodeURIComponent(paymentId)}`, { method: 'GET' })
}

async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyNotification(
  ipnSecret: string,
  body: unknown,
  signature: string | null,
): Promise<boolean> {
  const expected = await hmacSha512Hex(ipnSecret, signedPayload(body))
  return sameSignature(expected, signature)
}

export function readNotification(body: unknown): ProviderPayment | null {
  if (!body || typeof body !== 'object') return null
  const payment = readPayment(body as Record<string, unknown>)
  if (!payment.orderId || !payment.paymentId) return null
  return payment
}
