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
  reopensForConversion,
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
  it('gives a PDF a real choice, the quick way first', () => {
    expect(plansFor('pdf')).toEqual(['as_is', 'convert'])
  })

  it('publishes a PDF as it stands by default — the path that finishes', () => {
    // Reversed on 2026-08-25. Converting is the expensive path and was
    // being taken on behalf of someone who had only chosen a file; the
    // default is now the one that cannot be regretted, since the
    // original is kept either way and converting later is a button.
    expect(defaultPlanFor('pdf')).toBe('as_is')
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
    expect(resolvePlan('pdf', 'nonsense')).toBe('as_is')
    expect(resolvePlan('pdf', 'convert')).toBe('convert')
  })
})

describe('changing your mind about a settled book', () => {
  it('reopens a PDF published as it stands', () => {
    expect(reopensForConversion('pdf', 'as_is', 'convert')).toBe(true)
  })

  it('never reopens in the other direction', () => {
    // A converted book set back to `as_is` is a preference, not an
    // instruction to delete an EPUB someone may already have been sent.
    expect(reopensForConversion('pdf', 'convert', 'as_is')).toBe(false)
  })

  it('does not reopen a book with nothing to convert', () => {
    // An EPUB upload can only ever be `as_is`, so "convert" here is a
    // form value the source cannot honour — and would queue a book for
    // a converter with no work to do.
    expect(reopensForConversion('epub', 'as_is', 'convert')).toBe(false)
  })

  it('is not triggered by saving the same plan again', () => {
    expect(reopensForConversion('pdf', 'as_is', 'as_is')).toBe(false)
    expect(reopensForConversion('pdf', 'convert', 'convert')).toBe(false)
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

  it('makes a text upload its own txt', () => {
    // Null until 2026-08-26, which meant the original was not kept at
    // all: it stayed at the `conversion/` key the sweep clears.
    expect(originalArtifact('text')).toBe('txt')
  })

  it('keeps every original under books/, away from the sweep', () => {
    // Not `conversion/`, which the R2 lifecycle rule clears after 30
    // days — a published book's original must outlive that.
    for (const kind of ['pdf', 'docx', 'epub', 'text'] as const) {
      expect(originalKey('a-book', kind).startsWith('books/a-book')).toBe(true)
    }
    expect(originalKey('a-book', 'pdf')).toBe('books/a-book.pdf')
    expect(originalKey('a-book', 'docx')).toBe('books/a-book.docx')
    expect(originalKey('a-book', 'text')).toBe('books/a-book.txt')
  })
})

describe('what an uploader may choose', () => {
  it('offers a text file the same choice a PDF gets', () => {
    // Text reflows on its own, so publishing it as it stands gives up
    // structure rather than the reading experience. Converting adds
    // chapters and a contents list, and is worth offering rather than
    // imposing — especially while it means waiting for a converter.
    expect(plansFor('text')).toEqual(['as_is', 'convert'])
    expect(defaultPlanFor('text')).toBe('as_is')
  })

  it('lets a text book be finished without a converter', () => {
    expect(needsConverter('text', 'as_is')).toBe(false)
    expect(needsConverter('text', 'convert')).toBe(true)
  })

  it('reopens a text book that asks to be converted after all', () => {
    expect(reopensForConversion('text', 'as_is', 'convert')).toBe(true)
  })

  it('never sends text to Adobe, whichever plan it takes', () => {
    expect(needsExport('text', 'as_is')).toBe(false)
    expect(needsExport('text', 'convert')).toBe(false)
  })
})

describe('what still has to be built', () => {
  it('builds the EPUB and only the EPUB, whatever the source', () => {
    // A PDF is never generated. It used to be, for a DOCX or text
    // source: our own typography frozen into a fixed layout, which is
    // strictly worse than the EPUB beside it. A PDF artifact now only
    // ever means the uploader uploaded one.
    expect(formatsToGenerate('pdf')).toEqual(['epub'])
    expect(formatsToGenerate('docx')).toEqual(['epub'])
    expect(formatsToGenerate('text')).toEqual(['epub'])
  })

  it('builds nothing for an EPUB, which is already the edition', () => {
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
  // action, so nothing that calls an action can catch a bodySizeLimit
  // that is too low — or absent, which is how the portal once shipped
  // refusing every book over the 1 MB default.
  it('is set at all, so it is never the 1 MB default by accident', () => {
    const config = readFileSync(new URL('../../next.config.mjs', import.meta.url), 'utf8')
    const declared = /bodySizeLimit:\s*'(\d+)mb'/.exec(config)

    expect(declared, 'next.config.mjs must set experimental.serverActions.bodySizeLimit').not.toBe(
      null,
    )
    expect(Number(declared![1])).toBeGreaterThan(1)
  })

  // It used to have to clear MAX_UPLOAD_BYTES, because the book itself
  // travelled through a server action. It must NOT any more: the upload
  // is a raw body on `api/upload/route.ts`, and a bodySizeLimit large
  // enough to hold a book is the signature of that having quietly
  // regressed back into an action.
  it('does not carry a whole book, because uploads no longer use an action', () => {
    const config = readFileSync(new URL('../../next.config.mjs', import.meta.url), 'utf8')
    const declared = /bodySizeLimit:\s*'(\d+)mb'/.exec(config)

    expect(Number(declared![1]) * 1024 * 1024).toBeLessThan(MAX_UPLOAD_BYTES)
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

  it('opens the text of a text upload published as it stands', () => {
    expect(readingFormat(['txt'])).toBe('txt')
  })

  it('prefers the built editions over the text they were built from', () => {
    // A converted text book keeps its source as an artifact, and the
    // EPUB is what that conversion was for.
    expect(readingFormat(['txt', 'pdf', 'epub'])).toBe('epub')
    expect(readingFormat(['txt', 'pdf'])).toBe('pdf')
  })

  it('never offers the master, whatever else is missing', () => {
    expect(readingFormat(['docx'])).toBe(null)
    expect(readingFormat([])).toBe(null)
  })
})
