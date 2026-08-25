/**
 * Shelf ordering.
 *
 * `compareSequence` is what a reader actually sees, and since order ids
 * need not be unique its title tie-break is the common path rather than
 * a corner: everything nobody has placed shares `UNPLACED_ORDER_ID`, so
 * an uncurated shelf reaches the title comparison for every pair and
 * reads A-Z. The tests below are mostly about that — a shelf nobody
 * curated, one book lifted out of it, and two books at the same
 * number.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SHELF_SORT,
  compareSequence,
  compareTitles,
  FIRST_ORDER_ID,
  MAX_ORDER_ID,
  UNPLACED_ORDER_ID,
  isPlaced,
  orderIdFrom,
  parseShelfSort,
  resequence,
  sortShelfItems,
} from './shelfOrder'

const item = (id: number, title: string, order?: number | null) => ({ id, title, order })

describe('parseShelfSort', () => {
  it('reads the two sorts', () => {
    expect(parseShelfSort('sequence')).toBe('sequence')
    expect(parseShelfSort('alphabetical')).toBe('alphabetical')
  })

  it('falls back to the curated order for anything else', () => {
    expect(parseShelfSort(undefined)).toBe(DEFAULT_SHELF_SORT)
    expect(parseShelfSort('')).toBe(DEFAULT_SHELF_SORT)
    expect(parseShelfSort('by-vibes')).toBe(DEFAULT_SHELF_SORT)
    expect(DEFAULT_SHELF_SORT).toBe('sequence')
  })

  it('takes the first of a repeated query parameter', () => {
    expect(parseShelfSort(['alphabetical', 'sequence'])).toBe('alphabetical')
  })
})

describe('sorting a shelf', () => {
  it('sequences ascending', () => {
    const shelf = [item(1, 'Zhuangzi', 3), item(2, 'Analects', 1), item(3, 'Mencius', 2)]
    expect(sortShelfItems(shelf, 'sequence').map((book) => book.id)).toEqual([2, 3, 1])
  })

  it('puts unnumbered books last, alphabetically among themselves', () => {
    const shelf = [item(1, 'Zhuangzi'), item(2, 'Analects'), item(3, 'Mencius', 9)]
    expect(sortShelfItems(shelf, 'sequence').map((book) => book.id)).toEqual([3, 2, 1])
  })

  it('breaks ties on title, for a list covering more than one shelf', () => {
    // Two shelves in one catalog query: both legitimately hold a book
    // numbered 1, and the order between them must still be stable.
    const mixed = [item(1, 'Zhuangzi', 1), item(2, 'Analects', 1)]
    expect(sortShelfItems(mixed, 'sequence').map((book) => book.id)).toEqual([2, 1])
  })

  it('ignores the numbers entirely when asked for A–Z', () => {
    const shelf = [item(1, 'Zhuangzi', 1), item(2, 'Analects', 2)]
    expect(sortShelfItems(shelf, 'alphabetical').map((book) => book.id)).toEqual([2, 1])
  })

  it('leaves the input alone', () => {
    const shelf = [item(1, 'Zhuangzi', 3), item(2, 'Analects', 1)]
    sortShelfItems(shelf, 'sequence')
    expect(shelf.map((book) => book.id)).toEqual([1, 2])
  })

  it('reads volume numbers as numbers', () => {
    expect(compareTitles(item(1, 'Volume 2'), item(2, 'Volume 10'))).toBeLessThan(0)
  })

  it('treats a non-numeric stored order as no order at all', () => {
    // Null, undefined and NaN all mean "nobody numbered this".
    expect(compareSequence(item(1, 'A', Number.NaN), item(2, 'B', 5))).toBeGreaterThan(0)
  })
})

describe('a place on the shelf', () => {
  it('clamps a typed number to something storable', () => {
    expect(orderIdFrom(3)).toBe(3)
    expect(orderIdFrom(3.7)).toBe(3)
    // 0 and negatives mean "first" rather than being refused.
    expect(orderIdFrom(0)).toBe(FIRST_ORDER_ID)
    expect(orderIdFrom(-3)).toBe(FIRST_ORDER_ID)
    // A slip, not a position — and it must never reach the sentinel.
    expect(orderIdFrom(50_000)).toBe(MAX_ORDER_ID)
    expect(orderIdFrom(UNPLACED_ORDER_ID)).toBe(MAX_ORDER_ID)
  })

  it('keeps what an editor may type clear of the back of the shelf', () => {
    expect(MAX_ORDER_ID).toBeLessThan(UNPLACED_ORDER_ID)
  })

  it('calls a placed item placed and an unplaced one not', () => {
    expect(isPlaced({ id: 1, title: 'a', order: 2 })).toBe(true)
    expect(isPlaced({ id: 2, title: 'b', order: UNPLACED_ORDER_ID })).toBe(false)
    expect(isPlaced({ id: 3, title: 'c', order: null })).toBe(false)
  })
})

describe('a shelf nobody has curated', () => {
  const shelf = [
    { id: 1, title: 'Zhuangzi', order: UNPLACED_ORDER_ID },
    { id: 2, title: 'Analects', order: UNPLACED_ORDER_ID },
    { id: 3, title: 'Mencius', order: UNPLACED_ORDER_ID },
  ]

  it('reads alphabetically', () => {
    // The whole point of a shared sentinel: everything ties, so the
    // title comparison decides, and a shelf nobody ordered is A-Z.
    expect(sortShelfItems(shelf, 'sequence').map((item) => item.title)).toEqual([
      'Analects',
      'Mencius',
      'Zhuangzi',
    ])
  })

  it('lifts one placed book out of that run, leaving the rest alone', () => {
    const withOne = [...shelf, { id: 4, title: 'Zuo Zhuan', order: 1 }]
    expect(sortShelfItems(withOne, 'sequence').map((item) => item.title)).toEqual([
      'Zuo Zhuan',
      'Analects',
      'Mencius',
      'Zhuangzi',
    ])
  })

  it('reads two books at the same number alphabetically between them', () => {
    // Order ids need not be unique since 2026-08-25 — setting one
    // writes one row and moves nobody else.
    const tied = [
      { id: 1, title: 'Mencius', order: 3 },
      { id: 2, title: 'Analects', order: 3 },
      { id: 3, title: 'Zhuangzi', order: 1 },
    ]
    expect(sortShelfItems(tied, 'sequence').map((item) => item.title)).toEqual([
      'Zhuangzi',
      'Analects',
      'Mencius',
    ])
  })
})

describe('resequence', () => {
  it('numbers the group from one, in the order given', () => {
    expect(resequence([item(3, 'C', 9), item(1, 'A'), item(2, 'B', 2)])).toEqual([
      { id: 3, order: 1 },
      { id: 1, order: 2 },
      { id: 2, order: 3 },
    ])
  })
})
