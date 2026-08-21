import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  MAX_UPLOAD_BYTES,
  defaultPlanFor,
  formatsToGenerate,
  needsConverter,
  needsExport,
  originalArtifact,
  originalKey,
  plansFor,
  readSourceKind,
  readingFormat,
  resolvePlan,
  sourceKindOf,
} from './publication'

describe('classifying a source', () => {
  it('trusts the declared type', () => {
    expect(sourceKindOf('anything', 'application/pdf')).toBe('pdf')
    expect(sourceKindOf('anything', 'application/epub+zip')).toBe('epub')
  })

  it('falls back to the extension when the type says nothing', () => {
    // Several browsers send application/octet-stream for an EPUB.
    expect(sourceKindOf('book.epub', 'application/octet-stream')).toBe('epub')
    expect(sourceKindOf('BOOK.PDF ')).toBe('pdf')
  })

  it('treats markdown as text', () => {
    expect(sourceKindOf('notes.md')).toBe('text')
    expect(sourceKindOf('notes.txt')).toBe('text')
  })

  it('refuses what it does not know', () => {
    expect(sourceKindOf('book.mobi')).toBeNull()
    expect(sourceKindOf('book')).toBeNull()
  })
})

describe('what an uploader may choose', () => {
  it('gives a PDF a real choice', () => {
    expect(plansFor('pdf')).toEqual(['convert', 'as_is'])
  })

  it('converts by default, because reading is the point', () => {
    expect(defaultPlanFor('pdf')).toBe('convert')
  })

  it('offers a DOCX nothing to decide — it is already the master', () => {
    expect(plansFor('docx')).toEqual(['convert'])
  })

  it('offers an EPUB nothing to decide — it is already the edition', () => {
    expect(plansFor('epub')).toEqual(['as_is'])
  })

  it('never lets a form value pick a plan the source cannot do', () => {
    // Untrusted input: `as_is` on a DOCX would publish a Word file as
    // though it were a book.
    expect(resolvePlan('docx', 'as_is')).toBe('convert')
    expect(resolvePlan('epub', 'convert')).toBe('as_is')
    expect(resolvePlan('pdf', 'nonsense')).toBe('convert')
    expect(resolvePlan('pdf', 'as_is')).toBe('as_is')
  })
})

describe('the slot the original occupies', () => {
  it('makes a PDF upload its own PDF', () => {
    expect(originalArtifact('pdf')).toBe('pdf')
  })

  it('makes a DOCX upload its own master', () => {
    expect(originalArtifact('docx')).toBe('docx')
  })

  it('makes an EPUB upload its own edition', () => {
    expect(originalArtifact('epub')).toBe('epub')
  })

  it('gives text no slot, because a .txt is not an edition', () => {
    expect(originalArtifact('text')).toBeNull()
  })

  it('keeps every original under its own book, away from the sweep', () => {
    // Not `conversion/`, which the R2 lifecycle rule clears after 30
    // days — a published book's original must outlive that.
    for (const kind of ['pdf', 'docx', 'epub', 'text'] as const) {
      expect(originalKey(7, kind).startsWith('books/7/book/')).toBe(true)
    }
    expect(originalKey(7, 'pdf')).toBe('books/7/book/original.pdf')
    expect(originalKey(7, 'docx')).toBe('books/7/book/master.docx')
  })
})

describe('what still has to be built', () => {
  it('builds only the EPUB for a PDF, whose PDF is the scan itself', () => {
    expect(formatsToGenerate('pdf')).toEqual(['epub'])
  })

  it('builds both for a DOCX, which has neither yet', () => {
    expect(formatsToGenerate('docx')).toEqual(['epub', 'pdf'])
  })

  it('builds nothing for an EPUB', () => {
    expect(formatsToGenerate('epub')).toEqual([])
  })
})

describe('who does the work', () => {
  it('sends only a PDF being converted to Adobe', () => {
    expect(needsExport('pdf', 'convert')).toBe(true)
    expect(needsExport('pdf', 'as_is')).toBe(false)
    expect(needsExport('docx', 'convert')).toBe(false)
    expect(needsExport('epub', 'as_is')).toBe(false)
  })

  it('needs no converter for a book published as it stands', () => {
    // Which is what lets such a book be published on a deployment with
    // no converter running at all.
    expect(needsConverter('pdf', 'as_is')).toBe(false)
    expect(needsConverter('epub', 'as_is')).toBe(false)
  })

  it('needs a converter for everything that has a format to build', () => {
    expect(needsConverter('pdf', 'convert')).toBe(true)
    expect(needsConverter('docx', 'convert')).toBe(true)
    expect(needsConverter('text', 'convert')).toBe(true)
  })
})

describe('reading a book’s source kind back', () => {
  it('prefers the stored field', () => {
    expect(readSourceKind({ sourceKind: 'epub', sourceFilename: 'x.pdf' })).toBe('epub')
  })

  it('falls back to the filename for rows written before the field', () => {
    expect(readSourceKind({ sourceFilename: 'scan.pdf' })).toBe('pdf')
    expect(readSourceKind({ sourceFilename: 'book.docx' })).toBe('docx')
  })

  it('defaults to PDF when nothing answers', () => {
    // The safe end of the wrong guess: it builds only the EPUB, so a
    // misclassified book is missing a PDF rather than having one
    // rendered over an original it should have kept.
    expect(readSourceKind({})).toBe('pdf')
    expect(readSourceKind({ sourceKind: 'nonsense' })).toBe('pdf')
  })
})

describe('the size limit the framework enforces', () => {
  // The regression this guards is invisible in every other test: Next
  // rejects an oversized server action body *before* entering the
  // action, so no amount of testing `uploadBook` can catch a
  // bodySizeLimit that is too low — or absent, which is how the portal
  // shipped refusing every book over the 1 MB default.
  it('is set, and leaves room for the largest file we accept', () => {
    const config = readFileSync(new URL('../../next.config.mjs', import.meta.url), 'utf8')
    const declared = /bodySizeLimit:\s*'(\d+)mb'/.exec(config)

    expect(declared, 'next.config.mjs must set experimental.serverActions.bodySizeLimit').not.toBe(
      null,
    )
    expect(Number(declared![1]) * 1024 * 1024).toBeGreaterThan(MAX_UPLOAD_BYTES)
  })
})

describe('which edition the reader opens', () => {
  it('prefers the EPUB, which is the point', () => {
    expect(readingFormat(['pdf', 'epub', 'docx'])).toBe('epub')
  })

  it('opens the PDF for a book published as it stands', () => {
    // This is the whole regression: such a book has no EPUB and never
    // will, and refusing it left the one reader entitled to it — and
    // the administrator reviewing it — looking at an error while the
    // file sat in storage.
    expect(readingFormat(['pdf'])).toBe('pdf')
  })

  it('never offers the master, whatever else is missing', () => {
    expect(readingFormat(['docx'])).toBe(null)
    expect(readingFormat([])).toBe(null)
  })
})
