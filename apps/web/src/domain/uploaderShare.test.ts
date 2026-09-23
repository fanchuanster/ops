import { describe, expect, it } from 'vitest'

import {
  POINTS_PER_CREDIT,
  UPLOADER_SHARE,
  settleShare,
  shareDescription,
  shareForDelivery,
  sharePercent,
} from './uploaderShare'

const earn = (creditsSpent: number, rightsStatus: Parameters<typeof sharePercent>[0]) =>
  shareForDelivery({ creditsSpent, rightsStatus, hasUploader: true })

describe('the rates', () => {
  it('is two thirds for every book that may be shared, public domain included', () => {
    for (const status of ['public_domain', 'licensed', 'permission_granted'] as const) {
      expect(sharePercent(status)).toBe(UPLOADER_SHARE)
    }
  })

  it('is nothing for anything not publicly distributable', () => {
    for (const status of ['user_owned', 'unknown', 'restricted'] as const) {
      expect(sharePercent(status)).toBe(0)
    }
  })
})

describe('earning on one delivery', () => {
  it('earns points, not credits, so small books are not rounded to nothing', () => {
    expect(earn(1, 'public_domain')).toBe(66)
    expect(earn(1, 'licensed')).toBe(66)
    expect(earn(7, 'public_domain')).toBe(462)
  })

  it('pays nobody when the book has no uploader', () => {
    expect(
      shareForDelivery({ creditsSpent: 7, rightsStatus: 'public_domain', hasUploader: false }),
    ).toBe(0)
  })

  it('pays nothing on a free delivery', () => {
    expect(earn(0, 'licensed')).toBe(0)
  })

  it('never pays out more than the reader paid in', () => {
    for (const credits of [1, 2, 3, 5, 7]) {
      expect(earn(credits, 'licensed')).toBeLessThanOrEqual(credits * POINTS_PER_CREDIT)
    }
  })

  it('survives nonsense', () => {
    for (const bad of [NaN, Infinity, -3]) {
      expect(earn(bad, 'licensed')).toBe(0)
    }
  })
})

describe('settling points into credits', () => {
  it('pays nothing until a whole credit has accumulated', () => {
    expect(settleShare({ carry: 0, points: 33 })).toEqual({ credits: 0, carry: 33 })
    expect(settleShare({ carry: 33, points: 33 })).toEqual({ credits: 0, carry: 66 })
  })

  it('pays a credit when the total crosses a hundred, and carries the rest', () => {
    expect(settleShare({ carry: 66, points: 33 })).toEqual({ credits: 0, carry: 99 })
    expect(settleShare({ carry: 99, points: 33 })).toEqual({ credits: 1, carry: 32 })
  })

  it('pays several credits at once when it should', () => {
    expect(settleShare({ carry: 50, points: 260 })).toEqual({ credits: 3, carry: 10 })
  })

  it('adds up to the exact percentage over many deliveries', () => {
    let carry = 0
    let credits = 0
    for (let i = 0; i < 100; i += 1) {
      const settled = settleShare({ carry, points: earn(1, 'public_domain') })
      credits += settled.credits
      carry = settled.carry
    }
    expect(credits).toBe(66)
    expect(carry).toBe(0)
  })

  it('never loses or invents a point', () => {
    let carry = 7
    let paid = 0
    const earned = [33, 66, 231, 99, 1]
    for (const points of earned) {
      const settled = settleShare({ carry, points })
      paid += settled.credits
      carry = settled.carry
    }
    expect(paid * POINTS_PER_CREDIT + carry).toBe(7 + earned.reduce((a, b) => a + b, 0))
  })

  it('cannot be driven negative', () => {
    expect(settleShare({ carry: -50, points: -20 })).toEqual({ credits: 0, carry: 0 })
  })
})

describe('describing the share to the uploader', () => {
  it('states the one rate for a public-domain book', () => {
    expect(shareDescription('public_domain')).toContain(`${UPLOADER_SHARE}%`)
  })

  it('says nothing for a book that cannot earn', () => {
    expect(shareDescription('user_owned')).toBeNull()
  })
})
