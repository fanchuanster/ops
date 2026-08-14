/**
 * Containment rules for what the converter reports back.
 *
 * The completion payload turns into the files readers are sent, so
 * these are the checks standing between a buggy or tampered converter
 * and one book serving another book's content.
 */

import { describe, expect, it } from 'vitest'

import { acceptArtifacts, acceptPageCount, artifactPrefix } from './conversion'

describe('accepting reported artifacts', () => {
  const good = {
    docx: 'books/42/book/master.docx',
    epub: 'books/42/book/book.epub',
    pdf_standard: 'books/42/book/standard.pdf',
  }

  it('accepts the known formats under the book’s own prefix', () => {
    const accepted = acceptArtifacts({ bookId: 42, artifacts: good })
    expect(accepted.map((a) => a.format).sort()).toEqual(['docx', 'epub', 'pdf_standard'])
    expect(accepted.every((a) => a.storageKey.startsWith(artifactPrefix(42)))).toBe(true)
  })

  it('never marks the DOCX master downloadable', () => {
    const accepted = acceptArtifacts({ bookId: 42, artifacts: good })
    expect(accepted.find((a) => a.format === 'docx')?.downloadable).toBe(false)
    expect(accepted.find((a) => a.format === 'epub')?.downloadable).toBe(true)
  })

  it('refuses a key belonging to another book', () => {
    // The one that matters: a key under someone else's prefix would let
    // this book serve that book's file.
    expect(
      acceptArtifacts({ bookId: 42, artifacts: { epub: 'books/43/book/book.epub' } }),
    ).toEqual([])
  })

  it('refuses a key that only looks like the right prefix', () => {
    // `books/420/...` starts with `books/42` but not with `books/42/`.
    expect(
      acceptArtifacts({ bookId: 42, artifacts: { epub: 'books/420/book/book.epub' } }),
    ).toEqual([])
  })

  it('refuses traversal even under the right prefix', () => {
    expect(
      acceptArtifacts({ bookId: 42, artifacts: { epub: 'books/42/../43/book.epub' } }),
    ).toEqual([])
  })

  it('refuses formats we do not serve', () => {
    expect(
      acceptArtifacts({
        bookId: 42,
        artifacts: { mobi: 'books/42/book/x.mobi', __proto__: 'books/42/y' },
      }),
    ).toEqual([])
  })

  it('keeps the good entries when one is bad', () => {
    // Losing four good formats over one malformed key would mean
    // re-running hours of OCR to recover them.
    const accepted = acceptArtifacts({
      bookId: 42,
      artifacts: { ...good, pdf_large: 'books/99/book/large.pdf' },
    })
    expect(accepted).toHaveLength(3)
  })

  it('survives junk', () => {
    for (const junk of [null, undefined, 'string', 42, [], { epub: 12 }, { epub: null }]) {
      expect(acceptArtifacts({ bookId: 42, artifacts: junk })).toEqual([])
    }
  })
})

describe('accepting a reported page count', () => {
  it('takes a plausible count', () => {
    expect(acceptPageCount(6)).toBe(6)
    expect(acceptPageCount('420')).toBe(420)
    expect(acceptPageCount(6.4)).toBe(6)
  })

  it('rejects anything that would produce a nonsense price', () => {
    // Page count sets the price, so garbage here is a garbage charge.
    for (const bad of [0, -5, NaN, Infinity, null, undefined, 'lots', {}, 100_001]) {
      expect(acceptPageCount(bad)).toBeNull()
    }
  })
})
