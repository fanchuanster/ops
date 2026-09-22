import { describe, expect, it } from 'vitest'

import { matchesNeedle, searchNeedle, shelvesNamed } from './search'

const shelf = (id: number, title: string, parent?: number) => ({ id, title, parent })

describe('reading a query', () => {
  it('trims what the reader typed', () => {
    expect(searchNeedle('  Zhuangzi  ')).toBe('Zhuangzi')
  })

  it('reads a missing query as no query', () => {
    expect(searchNeedle(undefined)).toBe('')
    expect(searchNeedle(null)).toBe('')
  })
})

describe('matching a field', () => {
  it('ignores case', () => {
    expect(matchesNeedle('The Analects', 'analects')).toBe(true)
  })

  it('matches a fragment', () => {
    expect(matchesNeedle('南怀瑾选集', '怀瑾')).toBe(true)
  })

  it('excludes nothing when nothing was asked', () => {
    expect(matchesNeedle('The Analects', '   ')).toBe(true)
  })

  it('treats a missing field as no match', () => {
    expect(matchesNeedle(null, 'analects')).toBe(false)
  })
})

describe('shelves a query names', () => {
  const collections = [
    shelf(1, 'Chinese Classics'),
    shelf(2, 'Confucian', 1),
    shelf(3, 'Daoist', 1),
    shelf(4, 'Modern Essays'),
  ]

  it('names a shelf and everything filed beneath it', () => {
    expect(shelvesNamed(collections, 'chinese').sort()).toEqual([1, 2, 3])
  })

  it('names a child without naming its parent', () => {
    expect(shelvesNamed(collections, 'daoist')).toEqual([3])
  })

  it('names nothing when nothing was asked', () => {
    expect(shelvesNamed(collections, '  ')).toEqual([])
  })

  it('names nothing when no shelf carries the word', () => {
    expect(shelvesNamed(collections, 'zhuangzi')).toEqual([])
  })

  it('counts a shelf once when two matches share a subtree', () => {
    expect(shelvesNamed(collections, 'c').sort()).toEqual([1, 2, 3])
  })
})
