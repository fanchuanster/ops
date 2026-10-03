import { describe, expect, it } from 'vitest'

import {
  MAX_PURCHASE_CREDITS,
  MIN_PURCHASE_CREDITS,
  checkPurchaseAmount,
  coinLabel,
  isCoin,
  isResumable,
  minimumCreditsFor,
  paymentUri,
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

describe('the wallet payment link in the QR code', () => {
  it('carries the amount so a scan fills it in', () => {
    expect(paymentUri('btc', 'bc1qabc', '0.00012345')).toBe('bitcoin:bc1qabc?amount=0.00012345')
    expect(paymentUri('ltc', 'ltc1qabc', '0.5')).toBe('litecoin:ltc1qabc?amount=0.5')
  })

  it('asks for ether in wei', () => {
    expect(paymentUri('eth', '0xabc', '0.001')).toBe('ethereum:0xabc?value=1000000000000000')
  })

  it('names the USDC mint for the Solana stablecoin', () => {
    expect(paymentUri('usdcsol', 'Sol1', '3.12')).toBe(
      'solana:Sol1?amount=3.12&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    )
  })

  it('writes small exponent amounts out in full', () => {
    expect(paymentUri('btc', 'bc1qabc', '1e-7')).toBe('bitcoin:bc1qabc?amount=0.0000001')
  })

  it('falls back to the bare address when the amount is unusable', () => {
    expect(paymentUri('btc', 'bc1qabc', 'nope')).toBe('bc1qabc')
  })
})

describe('the minimum per coin', () => {
  it('keeps the three-credit minimum on cheap-fee coins', () => {
    expect(minimumCreditsFor('usdcsol')).toBe(3)
    expect(minimumCreditsFor('ltc')).toBe(3)
  })

  it('asks for more where a network fee can reach a dollar', () => {
    expect(minimumCreditsFor('eth')).toBe(10)
    expect(minimumCreditsFor('btc')).toBe(25)
  })
})
