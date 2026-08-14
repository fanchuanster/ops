/**
 * The monthly conversion quota.
 *
 * The case the rule exists for: a reader with 200 pages of allowance
 * left and a 201-page book arriving. There is room, but not enough
 * room, and letting it through "because some was left" would make the
 * limit meaningless on exactly the books that cost the most.
 *
 * Everything here is written against the constants rather than against
 * their current values, so changing a limit does not mean rewriting the
 * suite — which is what happened the first time these numbers moved.
 */

import { describe, expect, it } from 'vitest'

import {
  CHARACTERS_PER_PAGE,
  MONTHLY_PAGE_LIMIT,
  MONTHLY_UPLOAD_LIMIT,
  checkUploadQuota,
  estimatePages,
  quotaMessage,
} from './uploadQuota'

const request = (over: Partial<Parameters<typeof checkUploadQuota>[0]> = {}) =>
  checkUploadQuota({ uploads: 0, pages: 0, pagesRequested: 0, ...over })

describe('the page limit', () => {
  it('blocks a book one page past what is left', () => {
    const used = MONTHLY_PAGE_LIMIT - 200
    const decision = request({ uploads: 1, pages: used, pagesRequested: 201 })
    expect(decision).toMatchObject({ allowed: false, reason: 'page_limit', over: 1, pagesLeft: 200 })
  })

  it('allows the same book one page shorter', () => {
    expect(
      request({ uploads: 1, pages: MONTHLY_PAGE_LIMIT - 200, pagesRequested: 200 }).allowed,
    ).toBe(true)
  })

  it('allows a book that lands exactly on the limit', () => {
    expect(request({ pages: 0, pagesRequested: MONTHLY_PAGE_LIMIT }).allowed).toBe(true)
  })

  it('blocks one page past it', () => {
    expect(request({ pages: 0, pagesRequested: MONTHLY_PAGE_LIMIT + 1 }).allowed).toBe(false)
  })

  it('reports what is left rather than only refusing', () => {
    const used = MONTHLY_PAGE_LIMIT - 500
    const decision = request({ uploads: 1, pages: used, pagesRequested: 600 })
    expect(decision).toMatchObject({ pagesLeft: 500, over: 100 })
  })

  it('counts down what remains on success', () => {
    expect(request({ uploads: 1, pages: 500, pagesRequested: 300 })).toEqual({
      allowed: true,
      uploadsLeft: MONTHLY_UPLOAD_LIMIT - 2,
      pagesLeft: MONTHLY_PAGE_LIMIT - 800,
    })
  })
})

describe('the upload limit', () => {
  it('blocks the sixth conversion however short the book', () => {
    expect(request({ uploads: MONTHLY_UPLOAD_LIMIT, pages: 0, pagesRequested: 1 })).toMatchObject({
      allowed: false,
      reason: 'upload_limit',
    })
  })

  it('allows the fifth', () => {
    expect(request({ uploads: MONTHLY_UPLOAD_LIMIT - 1, pagesRequested: 10 }).allowed).toBe(true)
  })

  it('is checked before the page limit, being the cheaper answer', () => {
    // Both are exceeded; the reader is told the simpler thing.
    expect(
      request({ uploads: MONTHLY_UPLOAD_LIMIT, pages: MONTHLY_PAGE_LIMIT, pagesRequested: 500 }),
    ).toMatchObject({ reason: 'upload_limit' })
  })
})

describe('administrators', () => {
  it('are unlimited on both counts', () => {
    expect(
      checkUploadQuota({ uploads: 500, pages: 900_000, pagesRequested: 5000, isAdmin: true }),
    ).toMatchObject({ allowed: true })
  })
})

describe('an unmeasurable book', () => {
  it('is not a way through the page limit', () => {
    // It costs an upload, which is what catches it.
    const decision = request({ uploads: 0, pages: MONTHLY_PAGE_LIMIT - 1, pagesRequested: 0 })
    expect(decision.allowed).toBe(true)
    expect(request({ uploads: MONTHLY_UPLOAD_LIMIT, pagesRequested: 0 }).allowed).toBe(false)
  })

  it('survives a nonsense page count', () => {
    for (const bad of [NaN, Infinity, -50]) {
      expect(request({ pages: 0, pagesRequested: bad }).allowed).toBe(true)
    }
  })
})

describe('messages', () => {
  it('says nothing when allowed', () => {
    expect(quotaMessage(request())).toBeNull()
  })

  it('explains a refusal and says the draft survives', () => {
    const message = quotaMessage(
      request({ uploads: 1, pages: MONTHLY_PAGE_LIMIT - 200, pagesRequested: 201 }),
    )
    expect(message).toContain('draft')
    expect(message).toContain('200')
  })
})

describe('estimating pages before anything is rendered', () => {
  it('uses the PDF page count when there is one', () => {
    expect(estimatePages({ pdfPageCount: 342 })).toBe(342)
  })

  it('estimates from characters otherwise, rounding up', () => {
    expect(estimatePages({ characters: CHARACTERS_PER_PAGE })).toBe(1)
    expect(estimatePages({ characters: CHARACTERS_PER_PAGE + 1 })).toBe(2)
  })

  it('never estimates a book at zero pages', () => {
    expect(estimatePages({ characters: 5 })).toBe(1)
  })

  it('returns null when there is nothing to go on', () => {
    for (const input of [{}, { pdfPageCount: 0 }, { characters: 0 }, { pdfPageCount: null }]) {
      expect(estimatePages(input)).toBeNull()
    }
  })

  it('prefers a real page count over an estimate', () => {
    expect(estimatePages({ pdfPageCount: 10, characters: 999_999 })).toBe(10)
  })
})

describe('message grammar', () => {
  it('does not say "1 pages"', () => {
    const message = quotaMessage(
      request({ uploads: 1, pages: MONTHLY_PAGE_LIMIT - 200, pagesRequested: 201 }),
    )
    expect(message).toContain('1 page more')
    expect(message).not.toContain('1 pages')
  })
})
