import { describe, expect, it } from 'vitest'

import { bookSlug, disambiguated, isGeneratedFrom, renamedSlug, slugify } from './slug'

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

describe('the slug a book is born with', () => {
  it('is the title and nothing else', () => {
    expect(bookSlug('讓生命恢復純淨')).toBe('讓生命恢復純淨')
  })

  it('falls back rather than being empty', () => {
    expect(bookSlug('!!!')).toBe('book')
  })

  it('is counted up only when a second book wants the same name', () => {
    expect(disambiguated('心經', 1)).toBe('心經')
    expect(disambiguated('心經', 2)).toBe('心經-2')
  })
})

describe('telling a generated slug from one an editor wrote', () => {
  it('recognises the title it was built from', () => {
    expect(isGeneratedFrom('心經', '心經')).toBe(true)
    expect(isGeneratedFrom('心經-2', '心經')).toBe(true)
  })

  it('does not claim a slug that says something else', () => {
    expect(isGeneratedFrom('tao-te-ching-ch1', 'Tao Te Ching')).toBe(false)
    expect(isGeneratedFrom('心經-annotated', '心經')).toBe(false)
  })
})

describe('renaming a book renames its link', () => {
  it('rebuilds the slug from the corrected title', () => {
    expect(renamedSlug('參禪日記2024', '參禪日記2024', '參禪日記')).toBe('參禪日記')
  })

  it('leaves a hand-written slug alone, because an editor chose it', () => {
    expect(renamedSlug('tao-te-ching-ch1', 'Tao Te Ching', 'Tao Te Ching 道德經')).toBeNull()
  })

  it('says nothing changed when the title slugifies to what is already there', () => {
    expect(renamedSlug('analects', 'Analects', 'Analects.')).toBeNull()
  })

  it('renames a slug that carries a uniqueness number', () => {
    expect(renamedSlug('心經-2', '心經', '般若心經')).toBe('般若心經')
  })
})
