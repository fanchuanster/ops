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
  type OcrBox,
  type OcrParagraph,
  bodyFontSize,
  classifyParagraphs,
  codePoints,
  dropRunningHeads,
  looksLikeABook,
  looksLikeFolio,
  runningHeadKey,
  offset,
  orderPages,
  pageHasContent,
  sliceSegment,
  tidyParagraph,
} from './ocr'

const page = (number: number, ...paragraphs: string[]): OcrPage => ({
  number,
  paragraphs: paragraphs.map((text) => ({ text })),
})

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

/*
 * Running heads, feet and folios.
 *
 * The failure that matters here is the false positive. Deleting a
 * running head that was really a chapter title loses text silently, and
 * nobody discovers it until they read the book — so every rule below is
 * built to need evidence, and the tests are mostly about what must
 * *survive*.
 */

const at = (text: string, box: OcrBox, extra: Partial<OcrParagraph> = {}): OcrParagraph => ({
  text,
  box,
  ...extra,
})

const TOP = { x0: 0.1, y0: 0.02, x1: 0.9, y1: 0.05 }
const BOTTOM = { x0: 0.45, y0: 0.95, x1: 0.55, y1: 0.98 }
const MIDDLE = { x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.4 }

describe('recognising a folio', () => {
  it('accepts bare and decorated numbers, in both numeral systems', () => {
    for (const folio of ['12', '— 12 —', '[12]', '（十二）', '十二']) {
      expect(looksLikeFolio(folio)).toBe(true)
    }
  })

  it('rejects anything with real text in it', () => {
    for (const text of ['第十二章 學而', '12 論語', '']) {
      expect(looksLikeFolio(text)).toBe(false)
    }
  })
})

describe('the running-head key', () => {
  it('treats a head as the same when only its folio changes', () => {
    expect(runningHeadKey('論語別裁 12')).toBe(runningHeadKey('論語別裁 87'))
  })

  it('does the same for CJK numerals', () => {
    // 第三十七頁 and 第三十八頁 are one running head, not two.
    expect(runningHeadKey('第三十七頁')).toBe(runningHeadKey('第三十八頁'))
  })

  it('keeps genuinely different heads apart', () => {
    expect(runningHeadKey('學而第一')).not.toBe(runningHeadKey('為政第二'))
  })
})

describe('dropping running heads', () => {
  const book = (count: number): OcrPage[] =>
    Array.from({ length: count }, (_, i) => ({
      number: i + 1,
      paragraphs: [at('論語別裁', TOP), at(`本文第${i + 1}段`, MIDDLE), at(String(i + 1), BOTTOM)],
    }))

  it('removes a head that repeats and a folio that never does', () => {
    const cleaned = dropRunningHeads(book(10))
    for (const page of cleaned) {
      expect(page.paragraphs.map((p) => p.text)).toEqual([`本文第${page.number}段`])
    }
  })

  it('keeps a one-off title that happens to sit high on the page', () => {
    // The whole safety argument: a chapter title is in the margin band
    // on its opening page, but appears once.
    const pages = book(10)
    pages[0]!.paragraphs.push(at('學而第一', { x0: 0.2, y0: 0.03, x1: 0.8, y1: 0.06 }))

    const cleaned = dropRunningHeads(pages)
    expect(cleaned[0]!.paragraphs.map((p) => p.text)).toContain('學而第一')
  })

  it('never touches body text, however often it repeats', () => {
    const pages = Array.from({ length: 8 }, (_, i) => ({
      number: i + 1,
      paragraphs: [at('子曰', MIDDLE)],
    }))
    const cleaned = dropRunningHeads(pages)
    expect(cleaned.every((page) => page.paragraphs.length === 1)).toBe(true)
  })

  it('does nothing at all without geometry', () => {
    // A version 1 handoff, or an engine that reported no boxes. Without
    // position there is no evidence, so nothing may be removed.
    const pages = Array.from({ length: 8 }, (_, i) => ({
      number: i + 1,
      paragraphs: [{ text: '論語別裁' }, { text: '本文' }],
    }))
    expect(dropRunningHeads(pages)).toEqual(pages)
  })

  it('does not run on a document too short to have evidence', () => {
    const pages = [{ number: 1, paragraphs: [at('論語別裁', TOP)] }]
    expect(dropRunningHeads(pages)[0]!.paragraphs).toHaveLength(1)
  })
})

describe('classifying headings', () => {
  const sized = (text: string, fontSize: number, extra: Partial<OcrParagraph> = {}) => ({
    text,
    fontSize,
    ...extra,
  })

  const pages = (...paragraphs: OcrParagraph[]): OcrPage[] => [{ number: 1, paragraphs }]

  it('takes the body size as the median, not the mean', () => {
    // One display line at 40pt must not drag the body size up.
    const size = bodyFontSize(
      pages(sized('a', 10), sized('b', 10), sized('c', 10), sized('title', 40)),
    )
    expect(size).toBe(10)
  })

  it('promotes clearly larger short text to h1', () => {
    const [page] = classifyParagraphs(
      pages(sized('本文一', 10), sized('本文二', 10), sized('學而第一', 16)),
    )
    expect(page!.paragraphs.map((p) => p.role)).toEqual(['body', 'body', 'h1'])
  })

  it('uses h2 for a smaller step up', () => {
    const [page] = classifyParagraphs(pages(sized('本文', 10), sized('本文', 10), sized('小節', 12)))
    expect(page!.paragraphs[2]!.role).toBe('h2')
  })

  it('refuses to promote a long paragraph however it is set', () => {
    // The failure this prevents: a preface set slightly larger becoming
    // a chapter title and breaking the book at the wrong place.
    const long = '子'.repeat(200)
    const [page] = classifyParagraphs(pages(sized('本文', 10), sized(long, 20)))
    expect(page!.paragraphs[1]!.role).toBe('body')
  })

  it('calls everything body when no style information was bought', () => {
    // Honest rather than degraded: with no type sizes there is no
    // evidence for a heading, and guessing from length invents chapters.
    const [page] = classifyParagraphs(pages({ text: '學而第一' }, { text: '子曰' }))
    expect(page!.paragraphs.every((p) => p.role === 'body')).toBe(true)
  })

  it('treats a short bold line as a section head', () => {
    const [page] = classifyParagraphs(
      pages(sized('本文', 10), sized('本文', 10), sized('小節', 10, { bold: true })),
    )
    expect(page!.paragraphs[2]!.role).toBe('h2')
  })

  it('does not promote a long bold paragraph', () => {
    const [page] = classifyParagraphs(
      pages(sized('本文', 10), sized('子'.repeat(50), 10, { bold: true })),
    )
    expect(page!.paragraphs[1]!.role).toBe('body')
  })
})
