import { describe, expect, it } from 'vitest'

import {
  FALLBACK_STEM,
  artifactKey,
  bookStem,
  coverCandidateKey,
  decisionsKey,
  numbered,
  numberedStem,
  stemFootprint,
  stemFromFilename,
  stemFromKey,
  suggestionsKey,
} from './bookStorage'
import { originalKey } from './publication'

describe('the stem of a fresh upload', () => {
  it('is the uploaded name without its extension', () => {
    expect(stemFromFilename('參禪日記.pdf')).toBe('參禪日記')
    expect(stemFromFilename('analects.docx')).toBe('analects')
  })

  it('keeps the reader own characters, because this is a name', () => {
    expect(stemFromFilename('南懷瑾選集 第二卷.pdf')).toBe('南懷瑾選集-第二卷')
  })

  it('drops a directory a browser may have sent', () => {
    expect(stemFromFilename('C:\\scans\\book.pdf')).toBe('book')
    expect(stemFromFilename('/home/me/book.pdf')).toBe('book')
  })

  it('keeps a dot that is part of the title rather than an extension', () => {
    expect(stemFromFilename('vol.2.epub')).toBe('vol.2')
  })

  it('removes what a key cannot carry', () => {
    expect(stemFromFilename('a?b#c%d.pdf')).toBe('abcd')
    expect(stemFromFilename('  spaced  out .txt')).toBe('spaced-out')
  })

  it('falls back rather than producing an empty key', () => {
    expect(stemFromFilename('###.pdf')).toBe(FALLBACK_STEM)
    expect(stemFromFilename(undefined)).toBe(FALLBACK_STEM)
  })
})

describe('the stem of a book that has already filed something', () => {
  it('comes from the object it filed, not from anything renameable', () => {
    const stem = bookStem({
      artifacts: [{ format: 'pdf', storageKey: 'books/參禪日記-2.pdf' }],
      sourceFilename: 'anything-else.pdf',
      preferred: 'pdf',
    })
    expect(stem).toBe('參禪日記-2')
  })

  it('keeps a book written under the old layout where it already is', () => {
    const stem = bookStem({
      artifacts: [{ format: 'docx', storageKey: 'books/4/book/master.docx' }],
      sourceFilename: 'tao.pdf',
    })
    expect(stem).toBe('4/book/master')
    expect(artifactKey(stem, 'epub')).toBe('books/4/book/master.epub')
  })

  it('mints from the filename only when nothing is filed yet', () => {
    expect(bookStem({ artifacts: [], sourceFilename: 'scan.pdf' })).toBe('scan')
  })

  it('reads a stem back off a key exactly as it was written', () => {
    expect(stemFromKey('books/scan-3.epub')).toBe('scan-3')
    expect(stemFromKey('books/vol.2.epub')).toBe('vol.2')
  })
})

describe('every variation shares the stem', () => {
  const stem = '參禪日記'

  it('differs only in the type suffix', () => {
    expect(artifactKey(stem, 'pdf')).toBe('books/參禪日記.pdf')
    expect(artifactKey(stem, 'docx')).toBe('books/參禪日記.docx')
    expect(artifactKey(stem, 'epub')).toBe('books/參禪日記.epub')
    expect(artifactKey(stem, 'txt')).toBe('books/參禪日記.txt')
  })

  it('names the correction pair from it too', () => {
    expect(suggestionsKey(stem)).toBe('books/參禪日記-suggestions.json')
    expect(decisionsKey(stem)).toBe('books/參禪日記-decisions.json')
  })

  it('files an upload exactly where its artifact slot is', () => {
    expect(originalKey(stem, 'docx')).toBe(artifactKey(stem, 'docx'))
    expect(originalKey(stem, 'pdf')).toBe(artifactKey(stem, 'pdf'))
    expect(originalKey(stem, 'epub')).toBe(artifactKey(stem, 'epub'))
    expect(originalKey(stem, 'text')).toBe(artifactKey(stem, 'txt'))
  })
})

describe('numbering a name that is already taken', () => {
  it('counts up, and puts the number on the stem', () => {
    expect(numbered('books/scan.pdf', 0)).toBe('books/scan.pdf')
    expect(numbered('books/scan.pdf', 1)).toBe('books/scan-2.pdf')
    expect(numbered('books/scan.pdf', 2)).toBe('books/scan-3.pdf')
  })

  it('is not confused by a dot in a directory name', () => {
    expect(numbered('books/v1.0/master', 1)).toBe('books/v1.0/master-2')
  })

  it('carries through to every other variation of that book', () => {
    const stem = numberedStem('scan', 1)
    expect(stem).toBe('scan-2')
    expect(artifactKey(stem, 'epub')).toBe('books/scan-2.epub')
  })

  it('belongs to the book, so one taken type takes the whole name', () => {
    expect(stemFootprint('scan')).toContain('books/scan.docx')
    expect(stemFootprint('scan')).toContain('books/scan.epub')
    expect(stemFootprint('scan')).toContain('books/scan-suggestions.json')
  })

  it('leaves the cover out, because a cover is named after the book', () => {
    expect(stemFootprint('scan').some((key) => key.startsWith('covers/'))).toBe(false)
  })
})

describe('cover candidates', () => {
  it('finds a candidate from the key the book already records', () => {
    expect(coverCandidateKey('books/4/cover.jpg', 2)).toBe('books/4/cover-2.jpg')
    expect(coverCandidateKey('books/4/cover.jpg', 1)).toBe('books/4/cover.jpg')
  })

  it('leaves page one at the unsuffixed name it has always had', () => {
    expect(coverCandidateKey('books/scan-cover.jpg', 1)).toBe('books/scan-cover.jpg')
  })
})
