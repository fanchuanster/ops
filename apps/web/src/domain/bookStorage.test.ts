/**
 * Where a book's objects live.
 *
 * The property these exist to hold is the one that decided the design:
 * **renaming a book must not move a single object.** The layout was
 * keyed on the book id, then briefly on the slug — and the slug was
 * wrong precisely because `adminApi.ts` lets an editor correct one.
 *
 * So the stem comes from the uploaded file, is fixed by the first object
 * written, and is read back off that object thereafter rather than
 * recomputed.
 */

import { describe, expect, it } from 'vitest'

import {
  FALLBACK_STEM,
  artifactKey,
  bookStem,
  coverCandidateKey,
  coverKey,
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
    // The point of naming an object after the file is that somebody
    // looking in the bucket recognises it. A slug would not.
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
    // books/{id}/book/ was the layout until 2026-08-26. Its next
    // artifact is filed beside the ones it has rather than moving house.
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

  it('names the cover and the correction pair from it too', () => {
    expect(coverKey(stem)).toBe('books/參禪日記-cover.jpg')
    expect(coverKey(stem, 2)).toBe('books/參禪日記-cover-2.jpg')
    expect(suggestionsKey(stem)).toBe('books/參禪日記-suggestions.json')
    expect(decisionsKey(stem)).toBe('books/參禪日記-decisions.json')
  })

  it('files an upload exactly where its artifact slot is', () => {
    // The original *is* one of the book's artifacts — a DOCX upload is
    // its master — so the two rules must not disagree.
    expect(originalKey(stem, 'docx')).toBe(artifactKey(stem, 'docx'))
    expect(originalKey(stem, 'pdf')).toBe(artifactKey(stem, 'pdf'))
    expect(originalKey(stem, 'epub')).toBe(artifactKey(stem, 'epub'))
    expect(originalKey(stem, 'text')).toBe(artifactKey(stem, 'txt'))
  })
})

describe('numbering a name that is already taken', () => {
  it('counts up, and puts the number on the stem', () => {
    // Two readers both uploading scan.pdf is ordinary, not an error —
    // and the number goes before the extension so every variation of
    // one book still shares a name.
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
    expect(coverKey(stem)).toBe('books/scan-2-cover.jpg')
  })

  it('belongs to the book, so one taken type takes the whole name', () => {
    // Otherwise a book ends up as scan.docx beside scan-2.epub, which
    // is exactly what naming variations after one original rules out.
    expect(stemFootprint('scan')).toContain('books/scan.docx')
    expect(stemFootprint('scan')).toContain('books/scan.epub')
    expect(stemFootprint('scan')).toContain('books/scan-cover.jpg')
    expect(stemFootprint('scan')).toContain('books/scan-suggestions.json')
  })

  it('does not list cover candidates past the first', () => {
    // They are suffixes of a key already listed, so an unused stem
    // cannot have them without having the cover itself.
    expect(stemFootprint('scan')).not.toContain('books/scan-cover-2.jpg')
  })
})

describe('cover candidates', () => {
  it('finds a candidate from the key the book already records', () => {
    // This is what lets a cover rendered under the old books/{id}/
    // layout keep answering with nothing migrated.
    expect(coverCandidateKey('books/4/cover.jpg', 2)).toBe('books/4/cover-2.jpg')
    expect(coverCandidateKey('books/4/cover.jpg', 1)).toBe('books/4/cover.jpg')
  })

  it('leaves page one at the unsuffixed name it has always had', () => {
    expect(coverCandidateKey('books/scan-cover.jpg', 1)).toBe('books/scan-cover.jpg')
  })
})
