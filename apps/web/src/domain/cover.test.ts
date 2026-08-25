/**
 * The default cover: a page of the book.
 *
 * Two things are worth holding still here. The page numbering, because
 * the key a page is stored under is derived from it — page one keeps
 * the unsuffixed name every cover rendered before candidates existed
 * still lives at. And the precedence: an uploaded cover is an editor's
 * decision and outranks anything rendered.
 *
 * The containment rules that used to be here went with the converter on
 * 2026-08-25. Nothing reports a key from outside any more — the browser
 * posts images and this side names every key — so there is no longer a
 * door to check.
 */

import { describe, expect, it } from 'vitest'

import {
  COVER_CANDIDATE_PAGES,
  COVER_MAX_BYTES,
  checkCoverUpload,
  chosenCoverPage,
  coverAltFor,
  coverCandidatePages,
  coverImageUrl,
  coverKey,
  coverPageUrl,
  coverSourceFormat,
} from './cover'

describe('choosing what to render the opening pages from', () => {
  it('prefers the PDF, which for a scan is the book itself', () => {
    expect(coverSourceFormat(['docx', 'epub', 'pdf'])).toBe('pdf')
  })

  it('falls back to the EPUB, which declares a cover of its own', () => {
    expect(coverSourceFormat(['docx', 'epub'])).toBe('epub')
  })

  it('will not take a master: a browser has no DOCX renderer', () => {
    // It waits for the PDF phase 2 builds anyway. This is the one thing
    // the browser cannot do that the converter could, and what it
    // produced — the first typeset page — was the unhappy case even
    // when it worked.
    expect(coverSourceFormat(['docx'])).toBeNull()
  })

  it('has nothing to render from a book with no artifacts yet', () => {
    expect(coverSourceFormat([])).toBeNull()
    expect(coverSourceFormat(['mobi'])).toBeNull()
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

  it('never counts more pages than are offered', () => {
    expect(coverCandidatePages({ candidates: 99 })).toHaveLength(COVER_CANDIDATE_PAGES)
    expect(coverCandidatePages({ candidates: 0 })).toEqual([1])
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
