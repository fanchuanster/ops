/**
 * The credit economy.
 *
 * Two things here are worth testing hard. Pricing, because it decides
 * what readers are charged. And accrual, because it is lazy — nothing
 * runs on a schedule, grants are worked out when a reader signs in —
 * and the failure mode of getting that wrong is either paying someone
 * twice on every page load or quietly never paying them at all.
 */

import { describe, expect, it } from 'vitest'

import {
  ACTIVE_MONTH_GRANT,
  INACTIVE_MONTH_GRANT,
  MAX_BACKLOG_MONTHS,
  MAX_BOOK_PRICE,
  MIN_BOOK_PRICE,
  PAGES_PER_CREDIT,
  RESEND_PRICE,
  accrualFor,
  addMonths,
  decideDelivery,
  monthKey,
  monthsBetween,
  priceInCredits,
  totalCredits,
} from './credits'

describe('what a book costs', () => {
  it('charges one credit per 70 pages, rounded up', () => {
    expect(priceInCredits(1)).toBe(1)
    expect(priceInCredits(70)).toBe(1)
    expect(priceInCredits(71)).toBe(2)
    expect(priceInCredits(140)).toBe(2)
    expect(priceInCredits(141)).toBe(3)
  })

  it('never charges less than the minimum', () => {
    expect(priceInCredits(0)).toBe(MIN_BOOK_PRICE)
    expect(priceInCredits(-10)).toBe(MIN_BOOK_PRICE)
  })

  it('never charges more than the maximum, however long the book', () => {
    // 7 credits is reached at 421 pages and never exceeded.
    expect(priceInCredits(MAX_BOOK_PRICE * PAGES_PER_CREDIT)).toBe(MAX_BOOK_PRICE)
    expect(priceInCredits(MAX_BOOK_PRICE * PAGES_PER_CREDIT + 1)).toBe(MAX_BOOK_PRICE)
    expect(priceInCredits(100_000)).toBe(MAX_BOOK_PRICE)
  })

  it('charges the minimum when the page count is unknown', () => {
    // Our missing metadata is not the reader's problem.
    for (const unknown of [null, undefined, NaN, Infinity]) {
      expect(priceInCredits(unknown as number)).toBe(MIN_BOOK_PRICE)
    }
  })
})

describe('month arithmetic', () => {
  it('formats in UTC', () => {
    expect(monthKey(new Date('2026-08-14T03:00:00Z'))).toBe('2026-08')
    expect(monthKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01')
  })

  it('counts months across a year boundary', () => {
    expect(monthsBetween('2025-11', '2026-02')).toBe(3)
    expect(monthsBetween('2026-02', '2026-02')).toBe(0)
    expect(monthsBetween('2026-03', '2026-01')).toBe(-2)
  })

  it('adds months across a year boundary', () => {
    expect(addMonths('2025-11', 3)).toBe('2026-02')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', 0)).toBe('2026-01')
  })
})

describe('monthly accrual', () => {
  const now = new Date('2026-08-14T03:00:00Z')

  it('grants the active rate for the month a reader signs in', () => {
    const grants = accrualFor({ grantedThrough: '2026-07', now })
    expect(grants).toEqual([
      { month: '2026-08', credits: ACTIVE_MONTH_GRANT, reason: 'monthly_active' },
    ])
  })

  it('grants nothing twice in the same month', () => {
    // The one that must never break: this runs on sign-in, and a reader
    // may sign in twenty times a day.
    expect(accrualFor({ grantedThrough: '2026-08', now })).toEqual([])
  })

  it('grants nothing if the stored month is somehow ahead of the clock', () => {
    expect(accrualFor({ grantedThrough: '2026-12', now })).toEqual([])
  })

  it('pays the inactive rate for months that went by unvisited', () => {
    // A sign-in always grants for its own month, so a month with no
    // grant is by construction a month with no sign-in.
    const grants = accrualFor({ grantedThrough: '2026-05', now })
    expect(grants).toEqual([
      { month: '2026-06', credits: INACTIVE_MONTH_GRANT, reason: 'monthly_inactive' },
      { month: '2026-07', credits: INACTIVE_MONTH_GRANT, reason: 'monthly_inactive' },
      { month: '2026-08', credits: ACTIVE_MONTH_GRANT, reason: 'monthly_active' },
    ])
    expect(totalCredits(grants)).toBe(INACTIVE_MONTH_GRANT * 2 + ACTIVE_MONTH_GRANT)
  })

  it('establishes a baseline for an account that has never accrued', () => {
    const grants = accrualFor({ grantedThrough: null, now })
    expect(grants).toEqual([
      { month: '2026-08', credits: ACTIVE_MONTH_GRANT, reason: 'monthly_active' },
    ])
  })

  it('caps the backlog for someone returning after years', () => {
    const grants = accrualFor({ grantedThrough: '2019-01', now })
    expect(grants).toHaveLength(MAX_BACKLOG_MONTHS)
    // Still ends at the present month, at the active rate.
    expect(grants[grants.length - 1]).toEqual({
      month: '2026-08',
      credits: ACTIVE_MONTH_GRANT,
      reason: 'monthly_active',
    })
  })

  it('never grants the same month twice within one accrual', () => {
    const grants = accrualFor({ grantedThrough: '2024-02', now })
    expect(new Set(grants.map((g) => g.month)).size).toBe(grants.length)
  })
})

describe('paying for a delivery', () => {
  it('charges the book price the first time', () => {
    expect(decideDelivery({ price: 3, balance: 10, alreadyOwned: false })).toEqual({
      allowed: true,
      cost: 3,
      isResend: false,
      balanceAfter: 7,
    })
  })

  it('charges the flat resend price afterwards, not the book price again', () => {
    expect(decideDelivery({ price: 7, balance: 10, alreadyOwned: true })).toEqual({
      allowed: true,
      cost: RESEND_PRICE,
      isResend: true,
      balanceAfter: 10 - RESEND_PRICE,
    })
  })

  it('allows a purchase that spends the reader down to nothing', () => {
    expect(decideDelivery({ price: 5, balance: 5, alreadyOwned: false })).toMatchObject({
      allowed: true,
      balanceAfter: 0,
    })
  })

  it('refuses when the reader cannot afford it, and says by how much', () => {
    expect(decideDelivery({ price: 7, balance: 2, alreadyOwned: false })).toEqual({
      allowed: false,
      reason: 'insufficient_credits',
      cost: 7,
      isResend: false,
      short: 5,
    })
  })

  it('refuses a resend at zero balance', () => {
    // Owning the book is not a licence to keep sending it for free —
    // the resend charge is what replaced the rolling delivery cap.
    expect(decideDelivery({ price: 3, balance: 0, alreadyOwned: true })).toMatchObject({
      allowed: false,
      isResend: true,
      cost: RESEND_PRICE,
    })
  })
})
