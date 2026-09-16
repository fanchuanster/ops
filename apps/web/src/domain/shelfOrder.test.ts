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
  resequence,
  sortShelfItems,
} from './shelfOrder'

const item = (id: number, title: string, order?: number | null) => ({ id, title, order })

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
    expect(compareSequence(item(1, 'A', Number.NaN), item(2, 'B', 5))).toBeGreaterThan(0)
  })
})

describe('who decides how a shelf reads', () => {
  it('lets the shelf decide', () => {
    expect(shelfSortFor({ childOrder: 'sequence' })).toBe('sequence')
    expect(shelfSortFor({ childOrder: 'alphabetical' })).toBe('alphabetical')
  })

  it('is A–Z for a shelf that has said nothing', () => {
    expect(shelfSortFor({ childOrder: undefined })).toBe('alphabetical')
    expect(shelfSortFor({ childOrder: 'nonsense' })).toBe('alphabetical')
    expect(DEFAULT_CHILD_ORDER).toBe('alphabetical')
  })

  it('takes no reader override, because there is no longer one to take', () => {
    expect(shelfSortFor({ readerSort: 'sequence', childOrder: 'alphabetical' } as never)).toBe(
      'alphabetical',
    )
  })
})

describe('a place on the shelf', () => {
  it('hands an arrival the number after the highest', () => {
    expect(nextOrderId([])).toBe(FIRST_ORDER_ID)
    expect(nextOrderId([item(1, 'A', 1), item(2, 'B', 4)])).toBe(5)
    expect(nextOrderId([item(1, 'A', 1), item(2, 'B', 9)])).toBe(10)
    expect(nextOrderId([item(1, 'A')])).toBe(FIRST_ORDER_ID)
  })

  it('clamps a typed number to something storable', () => {
    expect(orderIdFrom(3)).toBe(3)
    expect(orderIdFrom(3.7)).toBe(3)
    expect(orderIdFrom(0)).toBe(FIRST_ORDER_ID)
    expect(orderIdFrom(-3)).toBe(FIRST_ORDER_ID)
    expect(orderIdFrom(50_000)).toBe(MAX_ORDER_ID)
  })

  it('reads two books at the same number alphabetically between them', () => {
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
