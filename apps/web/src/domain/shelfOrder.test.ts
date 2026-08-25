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
  DEFAULT_CHILD_ORDER,
  compareSequence,
  compareTitles,
  FIRST_ORDER_ID,
  MAX_ORDER_ID,
  nextOrderId,
  orderIdFrom,
  shelfSortFor,
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

  it('says null when the reader did not ask, so the shelf decides', () => {
    expect(parseShelfSort(undefined)).toBeNull()
    expect(parseShelfSort('')).toBeNull()
    expect(parseShelfSort('by-vibes')).toBeNull()
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

describe('who decides how a shelf reads', () => {
  it('lets each shelf decide when the reader has not asked', () => {
    expect(shelfSortFor({ readerSort: null, childOrder: 'sequence' })).toBe('sequence')
    expect(shelfSortFor({ readerSort: null, childOrder: 'alphabetical' })).toBe('alphabetical')
  })

  it('is A–Z for a shelf that has said nothing', () => {
    expect(shelfSortFor({ readerSort: null, childOrder: undefined })).toBe('alphabetical')
    expect(shelfSortFor({ readerSort: null, childOrder: 'nonsense' })).toBe('alphabetical')
    expect(DEFAULT_CHILD_ORDER).toBe('alphabetical')
  })

  it('lets a reader who asked override every shelf', () => {
    // The toggle is an override, not a preference the shelf can veto.
    expect(shelfSortFor({ readerSort: 'alphabetical', childOrder: 'sequence' })).toBe(
      'alphabetical',
    )
    expect(shelfSortFor({ readerSort: 'sequence', childOrder: 'alphabetical' })).toBe('sequence')
  })
})

describe('a place on the shelf', () => {
  it('hands an arrival the number after the highest', () => {
    expect(nextOrderId([])).toBe(FIRST_ORDER_ID)
    expect(nextOrderId([item(1, 'A', 1), item(2, 'B', 4)])).toBe(5)
    // Past the highest, not into the gap a deleted book left.
    expect(nextOrderId([item(1, 'A', 1), item(2, 'B', 9)])).toBe(10)
    expect(nextOrderId([item(1, 'A')])).toBe(FIRST_ORDER_ID)
  })

  it('clamps a typed number to something storable', () => {
    expect(orderIdFrom(3)).toBe(3)
    expect(orderIdFrom(3.7)).toBe(3)
    // 0 and negatives mean "first" rather than being refused.
    expect(orderIdFrom(0)).toBe(FIRST_ORDER_ID)
    expect(orderIdFrom(-3)).toBe(FIRST_ORDER_ID)
    // A slip, not a position.
    expect(orderIdFrom(50_000)).toBe(MAX_ORDER_ID)
  })

  it('reads two books at the same number alphabetically between them', () => {
    // Order ids need not be unique — setting one writes one row and
    // moves nobody else.
    const tied = [item(1, 'Mencius', 3), item(2, 'Analects', 3), item(3, 'Zhuangzi', 1)]
    expect(sortShelfItems(tied, 'sequence').map((book) => book.title)).toEqual([
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
