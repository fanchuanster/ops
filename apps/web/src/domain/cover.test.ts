/**
 * The default cover: page one of the book.
 *
 * Two things are worth holding still here. The containment rule, for
 * the same reason `conversion.test.ts` holds its own: a cover key is
 * streamed out of the bucket by id, so one book must never be able to
 * point at another's files. And the precedence — an uploaded cover is an
 * editor's decision and outranks anything rendered.
 */

import { describe, expect, it } from 'vitest'

import {
  COVER_CANDIDATE_PAGES,
  COVER_MAX_BYTES,
  acceptCoverKey,
  acceptCoverKeys,
  checkCoverUpload,
  chosenCoverPage,
  coverAltFor,
  coverCandidateKeys,
  coverCandidatePages,
  coverImageUrl,
  coverKey,
  coverPageUrl,
  coverSourceFormat,
  needsCover,
} from './cover'

describe('choosing what to render page one from', () => {
  it('prefers the PDF, which for a scan is the book itself', () => {
    expect(coverSourceFormat(['docx', 'epub', 'pdf'])).toBe('pdf')
  })

  it('falls back to the EPUB, and then to the master', () => {
    expect(coverSourceFormat(['docx', 'epub'])).toBe('epub')
    expect(coverSourceFormat(['docx'])).toBe('docx')
  })

  it('has nothing to render from a book with no artifacts yet', () => {
    expect(coverSourceFormat([])).toBeNull()
    expect(coverSourceFormat(['mobi'])).toBeNull()
  })
})

describe('which books need a cover', () => {
  const book = { state: 'pending', hasUploadedCover: false, formats: ['pdf'] }

  it('takes a pending book with something to render', () => {
    expect(needsCover(book)).toBe(true)
  })

  it('treats a missing state as pending, so old books need no backfill', () => {
    expect(needsCover({ ...book, state: undefined })).toBe(true)
    expect(needsCover({ ...book, state: 'nonsense' })).toBe(true)
  })

  it('leaves a book alone once an editor has uploaded a cover', () => {
    expect(needsCover({ ...book, hasUploadedCover: true })).toBe(false)
  })

  it('does not re-offer a rendered or a failed cover', () => {
    expect(needsCover({ ...book, state: 'ready' })).toBe(false)
    expect(needsCover({ ...book, state: 'rendering' })).toBe(false)
    // Terminal on purpose: a cover is cosmetic, and a source the
    // renderer cannot open must not be retried on every poll forever.
    expect(needsCover({ ...book, state: 'failed' })).toBe(false)
  })

  it('waits for a book that has nothing to render yet', () => {
    expect(needsCover({ ...book, formats: [] })).toBe(false)
  })
})

describe('accepting the key a converter reports', () => {
  it('accepts a key under the book’s own prefix', () => {
    expect(acceptCoverKey({ bookId: 42, key: coverKey(42) })).toBe('books/42/cover.jpg')
  })

  it('refuses another book’s prefix', () => {
    expect(acceptCoverKey({ bookId: 42, key: 'books/7/cover.jpg' })).toBeNull()
  })

  it('refuses a key that walks out of the prefix', () => {
    expect(acceptCoverKey({ bookId: 42, key: 'books/42/../7/cover.jpg' })).toBeNull()
  })

  it('refuses anything that is not a string', () => {
    expect(acceptCoverKey({ bookId: 42, key: null })).toBeNull()
    expect(acceptCoverKey({ bookId: 42, key: 7 })).toBeNull()
  })
})

describe('which cover a page shows', () => {
  it('shows an uploaded cover ahead of a rendered one', () => {
    expect(
      coverImageUrl({
        uploadedUrl: '/media/cover.png',
        bookId: 42,
        generated: { state: 'ready', key: 'books/42/cover.jpg' },
      }),
    ).toBe('/media/cover.png')
  })

  it('shows page one when there is no upload', () => {
    expect(
      coverImageUrl({ bookId: 42, generated: { state: 'ready', key: 'books/42/cover.jpg' } }),
    ).toBe('/covers/42')
  })

  it('shows nothing while the cover is unrendered or failed', () => {
    expect(coverImageUrl({ bookId: 42, generated: { state: 'pending' } })).toBeNull()
    expect(coverImageUrl({ bookId: 42, generated: { state: 'failed' } })).toBeNull()
    // A "ready" state with no key is a bug somewhere, and the honest
    // answer is the same as no cover rather than a URL that 404s.
    expect(coverImageUrl({ bookId: 42, generated: { state: 'ready', key: '' } })).toBeNull()
  })
})

describe('the candidate pages', () => {
  it('keeps page one at the name it has always had', () => {
    // Every cover rendered before candidates existed is at this key,
    // and stays readable without a backfill.
    expect(coverKey(7)).toBe(coverKey(7, 1))
    expect(coverKey(7, 1).endsWith('cover.jpg')).toBe(true)
    expect(coverKey(7, 2).endsWith('cover-2.jpg')).toBe(true)
  })

  it('names one key per page, in page order', () => {
    const keys = coverCandidateKeys(7)
    expect(keys).toHaveLength(COVER_CANDIDATE_PAGES)
    expect(keys[0]).toBe(coverKey(7, 1))
    expect(keys[2]).toBe(coverKey(7, 3))
  })

  it('never asks for more pages than are offered', () => {
    expect(coverCandidateKeys(7, 99)).toHaveLength(COVER_CANDIDATE_PAGES)
    expect(coverCandidateKeys(7, 0)).toHaveLength(1)
  })

  it('reads a book with no recorded candidates as having one', () => {
    expect(coverCandidatePages({})).toEqual([1])
    expect(chosenCoverPage({})).toBe(1)
  })

  it('clamps a choice to the pages that exist', () => {
    // The count can shrink under a stored choice when a book is
    // re-rendered. Pointing at a page nobody made is a cover that 404s.
    expect(chosenCoverPage({ page: 3, candidates: 3 })).toBe(3)
    expect(chosenCoverPage({ page: 3, candidates: 2 })).toBe(2)
    expect(chosenCoverPage({ page: 0, candidates: 3 })).toBe(1)
    expect(chosenCoverPage({ page: 'two', candidates: 3 })).toBe(1)
  })

  it('gives each page its own address, so a choice is not cached away', () => {
    expect(coverPageUrl(42, 1)).toBe('/covers/42')
    expect(coverPageUrl(42, 2)).toBe('/covers/42?page=2')
  })

  it('shows the chosen page rather than always the first', () => {
    expect(
      coverImageUrl({
        bookId: 42,
        generated: { state: 'ready', key: 'books/42/cover.jpg', page: 2, candidates: 3 },
      }),
    ).toBe('/covers/42?page=2')
  })
})

describe('accepting the candidate keys a converter reports', () => {
  it('accepts a list under the book’s own prefix', () => {
    expect(
      acceptCoverKeys({ bookId: 42, keys: [coverKey(42, 1), coverKey(42, 2)] }),
    ).toEqual([coverKey(42, 1), coverKey(42, 2)])
  })

  it('stops at the first key it will not accept', () => {
    // Truncated rather than filtered: the position in this list is the
    // page number, so skipping a bad key would silently renumber every
    // page after it.
    expect(
      acceptCoverKeys({ bookId: 42, keys: [coverKey(42, 1), coverKey(9, 2), coverKey(42, 3)] }),
    ).toEqual([coverKey(42, 1)])
  })

  it('refuses anything that is not a list of keys', () => {
    expect(acceptCoverKeys({ bookId: 42, keys: undefined })).toEqual([])
    expect(acceptCoverKeys({ bookId: 42, keys: coverKey(42, 1) })).toEqual([])
    expect(acceptCoverKeys({ bookId: 42, keys: [7] })).toEqual([])
  })

  it('never records more pages than are offered', () => {
    const many = [1, 2, 3, 4, 5].map((page) => coverKey(42, page))
    expect(acceptCoverKeys({ bookId: 42, keys: many })).toHaveLength(COVER_CANDIDATE_PAGES)
  })
})

describe('checkCoverUpload', () => {
  const jpeg = { size: 40_000, type: 'image/jpeg' }

  it('accepts an ordinary image', () => {
    expect(checkCoverUpload(jpeg).ok).toBe(true)
  })

  // The reason the allowlist exists: media is served from our own
  // origin, so an SVG cover would be stored XSS.
  it('refuses SVG, which `image/*` would have accepted', () => {
    expect(checkCoverUpload({ size: 900, type: 'image/svg+xml' })).toEqual({
      ok: false,
      problem: 'wrong_type',
    })
  })

  it('refuses a PDF dropped on the control by mistake', () => {
    expect(checkCoverUpload({ size: 900, type: 'application/pdf' })).toEqual({
      ok: false,
      problem: 'wrong_type',
    })
  })

  it('refuses an empty file before anything else', () => {
    expect(checkCoverUpload({ size: 0, type: 'image/jpeg' })).toEqual({
      ok: false,
      problem: 'empty',
    })
  })

  it('takes an image right up to the limit, and not one byte past it', () => {
    expect(checkCoverUpload({ size: COVER_MAX_BYTES, type: 'image/png' }).ok).toBe(true)
    expect(checkCoverUpload({ size: COVER_MAX_BYTES + 1, type: 'image/png' })).toEqual({
      ok: false,
      problem: 'too_large',
    })
  })
})

describe('coverAltFor', () => {
  it('names the book', () => {
    expect(coverAltFor('道德經')).toBe('Cover of 道德經')
  })

  it('says something rather than nothing for an untitled book', () => {
    expect(coverAltFor('   ')).toBe('Book cover')
  })
})
