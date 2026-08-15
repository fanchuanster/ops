/**
 * Reassembling a book from OCR output.
 *
 * The tests that matter here are the ones about *offsets*. Everything
 * else in this module is tidying; the offset handling is where a bug
 * produces text that looks plausible and is wrong, which is the worst
 * kind of failure in a preservation project.
 */

import { describe, expect, it } from 'vitest'

import {
  type OcrPage,
  characterCount,
  codePoints,
  looksLikeABook,
  offset,
  orderPages,
  pageHasContent,
  sliceSegment,
  tidyParagraph,
} from './ocr'

const page = (number: number, ...paragraphs: string[]): OcrPage => ({ number, paragraphs })

describe('offsets', () => {
  it('reads the strings JSON encodes int64 as', () => {
    expect(offset('1200')).toBe(1200)
  })

  it('treats an absent start offset as zero', () => {
    // Document AI omits startIndex when it is 0 — the proto3
    // default-value rule showing through the JSON mapping.
    expect(offset(undefined)).toBe(0)
  })

  it('does not concatenate when offsets are arithmetic', () => {
    // The bug this guards: '100' + 5 is '1005', and the resulting slice
    // is empty rather than an error.
    expect(offset('100') + 5).toBe(105)
  })

  it('refuses nonsense rather than producing NaN', () => {
    expect(offset('not a number')).toBe(0)
    expect(offset(null)).toBe(0)
  })
})

describe('slicing', () => {
  const text = codePoints('The Analects of Confucius')

  it('takes the named range', () => {
    expect(sliceSegment(text, { start: 4, end: 12 })).toBe('Analects')
  })

  it('yields nothing for an inverted range rather than throwing', () => {
    // One bad range must cost a paragraph, not a book: recovering means
    // re-running OCR that took an hour.
    expect(sliceSegment(text, { start: 12, end: 4 })).toBe('')
  })

  it('clamps a range running past the end', () => {
    expect(sliceSegment(text, { start: 20, end: 9_000 })).toBe('ucius')
  })
})

describe('code points, not UTF-16 units', () => {
  // Document AI counts code points; JavaScript strings count UTF-16
  // units. They agree until a character outside the BMP appears — which
  // in this library means CJK Extension B, where the rare and variant
  // characters of historical texts live.
  const beyondBmp = '𠀀' // U+20000, one code point, two UTF-16 units

  it('counts a beyond-BMP character as one unit', () => {
    expect(codePoints(`${beyondBmp}子曰`)).toHaveLength(3)
    expect(`${beyondBmp}子曰`.length).toBe(4)
  })

  it('slices correctly after a beyond-BMP character', () => {
    // Indexing the raw string would take '子' here and drift by one for
    // every such character in the page.
    const text = codePoints(`${beyondBmp}子曰學而`)
    expect(sliceSegment(text, { start: 1, end: 3 })).toBe('子曰')
  })

  it('keeps a beyond-BMP character whole rather than splitting a surrogate pair', () => {
    const text = codePoints(`${beyondBmp}子`)
    expect(sliceSegment(text, { start: 0, end: 1 })).toBe(beyondBmp)
  })
})

describe('paragraph tidying', () => {
  it('removes the line breaks a scan puts at every typeset line', () => {
    // Left in, these defeat reflow — the reader's font size and margins
    // stop mattering, which is what EPUB is for.
    expect(tidyParagraph('子曰學而時習之\n不亦說乎')).toBe('子曰學而時習之不亦說乎')
  })

  it('joins Chinese without inserting a space', () => {
    expect(tidyParagraph('溫故\n而知新')).not.toContain(' ')
  })

  it('keeps the word boundary in Latin text', () => {
    expect(tidyParagraph('the Master\nsaid')).toBe('the Master said')
  })

  it('rejoins a word hyphenated across a line break', () => {
    expect(tidyParagraph('philo-\nsophy')).toBe('philosophy')
  })

  it('drops blank lines between paragraphs of a page', () => {
    expect(tidyParagraph('  first  \n\n  second  ')).toBe('first second')
  })
})

describe('ordering', () => {
  it('orders by page number, not by how the shards listed', () => {
    // A bucket lists lexicographically, so shard 10 arrives before
    // shard 2 and the book is silently interleaved.
    const ordered = orderPages([page(10, 'ten'), page(2, 'two'), page(1, 'one')])
    expect(ordered.map((p) => p.number)).toEqual([1, 2, 10])
  })

  it('drops blank versos and scan separators', () => {
    const ordered = orderPages([page(1, 'one'), page(2, '   '), page(3, 'three')])
    expect(ordered.map((p) => p.number)).toEqual([1, 3])
  })
})

describe('is this a book', () => {
  it('accepts an ordinary scanned page', () => {
    expect(looksLikeABook([page(1, '子曰：學而時習之，不亦說乎？有朋自遠方來，不亦樂乎？')])).toBe(
      true,
    )
  })

  it('rejects output with nothing on it', () => {
    expect(looksLikeABook([page(1, ''), page(2, '  ')])).toBe(false)
  })

  it('rejects a scattering of garbage from an upside-down scan', () => {
    expect(looksLikeABook([page(1, 'l'), page(2, '/'), page(3, 'x')])).toBe(false)
  })

  it('does not penalise a book for its blank plates', () => {
    // Averaged over pages with content, so twenty blank plates beside
    // one real page still reads as a book.
    const pages = [page(1, '子曰：學而時習之，不亦說乎？有朋自遠方來，不亦樂乎？')]
    for (let i = 2; i < 22; i += 1) pages.push(page(i, ''))
    expect(looksLikeABook(pages)).toBe(true)
  })
})

describe('counting', () => {
  it('sums characters across pages and paragraphs', () => {
    expect(characterCount([page(1, 'abc', 'de'), page(2, 'f')])).toBe(6)
  })

  it('knows an empty page has nothing on it', () => {
    expect(pageHasContent(page(1, '', '   '))).toBe(false)
  })
})
