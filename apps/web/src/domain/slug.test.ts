import { describe, expect, it } from 'vitest'

import { autoSlugSuffix, bookSlug, renamedSlug, slugify } from './slug'

describe('slugify', () => {
  it('keeps the reader own characters, because a book name is the point', () => {
    expect(slugify('參禪日記')).toBe('參禪日記')
  })

  it('collapses everything that is not a letter or a number', () => {
    expect(slugify('Tao Te Ching — Chapter 1')).toBe('tao-te-ching-chapter-1')
  })

  it('leaves no separator hanging off either end', () => {
    expect(slugify('  ...Analects...  ')).toBe('analects')
    expect(slugify('a'.repeat(59) + ' tail')).toBe('a'.repeat(59))
  })
})

describe('the suffix that marks a generated slug', () => {
  it('is the eight hex characters an upload appends', () => {
    expect(autoSlugSuffix('參禪日記-a9da0a77')).toBe('a9da0a77')
  })

  it('is absent from a slug somebody wrote by hand', () => {
    expect(autoSlugSuffix('tao-te-ching-ch1')).toBeNull()
  })
})

describe('renaming a book renames its link', () => {
  it('rebuilds the slug from the corrected title, keeping the suffix', () => {
    expect(renamedSlug('746400367-參禪日記2024-a9da0a77', '參禪日記')).toBe('參禪日記-a9da0a77')
  })

  it('leaves a hand-written slug alone, because an editor chose it', () => {
    expect(renamedSlug('tao-te-ching-ch1', 'Tao Te Ching')).toBeNull()
  })

  it('says nothing changed when the title slugifies to what is already there', () => {
    expect(renamedSlug('analects-a9da0a77', 'Analects')).toBeNull()
  })

  it('falls back rather than producing a slug that is only a suffix', () => {
    expect(bookSlug('!!!', 'a9da0a77')).toBe('book-a9da0a77')
  })
})
