import { describe, expect, it } from 'vitest'

import {
  MAX_PURCHASE_CREDITS,
  MIN_PURCHASE_CREDITS,
  checkPurchaseAmount,
  coinLabel,
  isCoin,
  isResumable,
  priceInUsd,
  sameSignature,
  signedPayload,
  statusFromProvider,
  windowEndsAt,
} from './creditPurchases'

describe('the amount', () => {
  it('accepts a whole number of credits in range', () => {
    expect(checkPurchaseAmount(25)).toEqual({ ok: true, credits: 25 })
    expect(checkPurchaseAmount('100')).toEqual({ ok: true, credits: 100 })
  })

  it('refuses anything under the three-dollar minimum', () => {
    expect(MIN_PURCHASE_CREDITS).toBe(3)
    expect(checkPurchaseAmount(2).ok).toBe(false)
    expect(checkPurchaseAmount(3).ok).toBe(true)
  })

  it('refuses fractions, zero, negatives and rubbish', () => {
    for (const bad of [1.5, 0, -3, 'abc', null, undefined, NaN]) {
      expect(checkPurchaseAmount(bad).ok).toBe(false)
    }
  })

  it('refuses more than the single-purchase ceiling', () => {
    expect(checkPurchaseAmount(MAX_PURCHASE_CREDITS).ok).toBe(true)
    expect(checkPurchaseAmount(MAX_PURCHASE_CREDITS + 1).ok).toBe(false)
  })

  it('charges one dollar a credit', () => {
    expect(priceInUsd(25)).toBe(25)
  })
})

describe('the coins', () => {
  it('only offers the listed ones', () => {
    expect(isCoin('btc')).toBe(true)
    expect(isCoin('doge')).toBe(false)
    expect(isCoin(undefined)).toBe(false)
  })

  it('labels a coin for display', () => {
    expect(coinLabel('usdcsol')).toBe('USDC (Solana)')
    expect(coinLabel('xmr')).toBe('XMR')
  })
})

describe('the provider status', () => {
  it('credits only once the payment is finished', () => {
    expect(statusFromProvider('finished')).toBe('paid')
    for (const waiting of ['waiting', 'confirming', 'confirmed', 'sending', 'partially_paid']) {
      expect(statusFromProvider(waiting)).toBe('pending')
    }
  })

  it('ends a purchase that failed, was refunded or ran out', () => {
    expect(statusFromProvider('failed')).toBe('failed')
    expect(statusFromProvider('refunded')).toBe('failed')
    expect(statusFromProvider('expired')).toBe('expired')
  })

  it('treats an unknown status as still waiting', () => {
    expect(statusFromProvider('something_new')).toBe('pending')
    expect(statusFromProvider(null)).toBe('pending')
  })
})

describe('resuming a purchase', () => {
  const now = new Date('2026-10-02T12:00:00Z')

  it('resumes a pending one inside its window', () => {
    expect(isResumable({ status: 'pending', expiresAt: windowEndsAt(now).toISOString() }, now)).toBe(true)
  })

  it('does not resume one past its window or already settled', () => {
    expect(isResumable({ status: 'pending', expiresAt: '2026-10-02T11:59:00Z' }, now)).toBe(false)
    expect(isResumable({ status: 'paid', expiresAt: windowEndsAt(now).toISOString() }, now)).toBe(false)
    expect(isResumable({ status: 'pending', expiresAt: null }, now)).toBe(false)
  })
})

describe('the notification signature', () => {
  it('signs the body with its keys sorted at every depth', () => {
    expect(signedPayload({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}',
    )
  })

  it('compares signatures exactly', () => {
    expect(sameSignature('abc123', 'ABC123')).toBe(true)
    expect(sameSignature('abc123', 'abc124')).toBe(false)
    expect(sameSignature('abc123', 'abc12')).toBe(false)
    expect(sameSignature('abc123', null)).toBe(false)
  })
})
