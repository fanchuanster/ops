import { describe, expect, it } from 'vitest'

import { nowPaymentsConfig, readNotification, verifyNotification } from './nowpayments'

async function sign(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const raw = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(raw), (b) => b.toString(16).padStart(2, '0')).join('')
}

describe('verifying a notification', () => {
  const body = { payment_status: 'finished', order_id: 'ns-1-abc', payment_id: 5, price_amount: 25 }

  it('accepts the signature over the key-sorted body, whatever order it arrived in', async () => {
    const signature = await sign(
      'secret',
      '{"order_id":"ns-1-abc","payment_id":5,"payment_status":"finished","price_amount":25}',
    )
    expect(await verifyNotification('secret', body, signature)).toBe(true)
  })

  it('refuses a signature made with another secret', async () => {
    const signature = await sign('other', '{}')
    expect(await verifyNotification('secret', body, signature)).toBe(false)
  })

  it('refuses a body changed after signing', async () => {
    const signature = await sign(
      'secret',
      '{"order_id":"ns-1-abc","payment_id":5,"payment_status":"finished","price_amount":25}',
    )
    expect(await verifyNotification('secret', { ...body, price_amount: 1 }, signature)).toBe(false)
  })

  it('refuses a missing signature', async () => {
    expect(await verifyNotification('secret', body, null)).toBe(false)
  })
})

describe('reading a notification', () => {
  it('needs both an order and a payment', () => {
    expect(readNotification({ order_id: 'a' })).toBeNull()
    expect(readNotification(null)).toBeNull()
    expect(readNotification({ order_id: 'a', payment_id: 7, payment_status: 'finished' })).toMatchObject({
      orderId: 'a',
      paymentId: '7',
      status: 'finished',
    })
  })
})

describe('the configuration', () => {
  it('is absent without the api key, and the notification secret is optional', () => {
    expect(nowPaymentsConfig({ NOWPAYMENTS_IPN_SECRET: 's' })).toBeNull()
    expect(nowPaymentsConfig({ NOWPAYMENTS_API_KEY: 'k' })).toEqual({ apiKey: 'k', ipnSecret: null })
    expect(nowPaymentsConfig({ NOWPAYMENTS_API_KEY: 'k', NOWPAYMENTS_IPN_SECRET: ' s ' })).toEqual({
      apiKey: 'k',
      ipnSecret: 's',
    })
  })
})
