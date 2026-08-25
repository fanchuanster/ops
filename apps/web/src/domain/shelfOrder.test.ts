/**
 * Shelf ordering.
 *
 * Two things carry weight. `compareSequence` is what a reader actually
 * sees, and its unnumbered-last rule is the only reason a library
 * nobody has ordered still reads sensibly. `placeInOrder` is what keeps
 * order ids unique per shelf while still letting an editor type any
 * number they like — the shifting is the whole of that guarantee, so it
 * is tested against gaps, no-ops and the first slot.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SHELF_SORT,
  FIRST_ORDER_ID,
  compareSequence,
  compareTitles,
  nextOrderId,
  parseShelfSort,
  placeInOrder,
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

describe('nextOrderId', () => {
  it('starts at one on an empty shelf', () => {
    expect(nextOrderId([])).toBe(FIRST_ORDER_ID)
    expect(FIRST_ORDER_ID).toBe(1)
  })

  it('goes past the highest, not into the gap', () => {
    // 2 was deleted. A new book belongs at the end of the sequence, not
    // in the middle of a list it was never part of.
    expect(nextOrderId([item(1, 'A', 1), item(3, 'C', 3)])).toBe(4)
  })

  it('ignores siblings nobody numbered', () => {
    expect(nextOrderId([item(1, 'A'), item(2, 'B', 2)])).toBe(3)
  })
})

describe('placeInOrder', () => {
  const shelf = [item(1, 'A', 1), item(2, 'B', 2), item(3, 'C', 3)]

  it('shifts the run it lands in, so no two share a number', () => {
    const writes = placeInOrder(shelf, { id: 3, desired: 1 })
    expect(writes).toEqual([
      { id: 3, order: 1 },
      { id: 1, order: 2 },
      { id: 2, order: 3 },
    ])
  })

  it('stops shifting at the first free number', () => {
    const gapped = [item(1, 'A', 1), item(2, 'B', 2), item(3, 'C', 7)]
    expect(placeInOrder(gapped, { id: 3, desired: 1 })).toEqual([
      { id: 3, order: 1 },
      { id: 1, order: 2 },
      { id: 2, order: 3 },
    ])
  })

  it('does not treat the moved item as being in its own way', () => {
    expect(placeInOrder(shelf, { id: 2, desired: 2 })).toEqual([])
  })

  it('writes only the arrival when the number is free', () => {
    expect(placeInOrder(shelf, { id: 3, desired: 9 })).toEqual([{ id: 3, order: 9 }])
  })

  it('numbers a book that is not on the shelf yet', () => {
    expect(placeInOrder(shelf, { id: 4, desired: 2 })).toEqual([
      { id: 4, order: 2 },
      { id: 2, order: 3 },
      { id: 3, order: 4 },
    ])
  })

  it('clamps a number below the first slot rather than refusing it', () => {
    expect(placeInOrder(shelf, { id: 3, desired: 0 })[0]).toEqual({ id: 3, order: 1 })
    expect(placeInOrder(shelf, { id: 3, desired: -7 })[0]).toEqual({ id: 3, order: 1 })
  })

  it('never stores a fractional order id', () => {
    expect(placeInOrder(shelf, { id: 3, desired: 2.6 })[0]).toEqual({ id: 3, order: 2 })
  })

  it('matches ids across the number/string boundary', () => {
    // Payload hands ids back as numbers; a form posts them as strings.
    expect(placeInOrder(shelf, { id: '2', desired: 2 })).toEqual([])
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
