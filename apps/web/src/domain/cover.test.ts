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
  COVER_MAX_BYTES,
  acceptCoverKey,
  checkCoverUpload,
  coverAltFor,
  coverImageUrl,
  coverKey,
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
