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
  reopensForConversion,
  requestedReadingFormat,
  resolvePlan,
  sourceKindOf,
} from './publication'

describe('classifying a source', () => {
  it('trusts the declared type', () => {
    expect(sourceKindOf('anything', 'application/pdf')).toBe('pdf')
    expect(sourceKindOf('anything', 'application/epub+zip')).toBe('epub')
  })

  it('falls back to the extension when the type says nothing', () => {
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
    expect(defaultPlanFor('pdf')).toBe('as_is')
  })

  it('offers a DOCX nothing to decide — it is already the master', () => {
    expect(plansFor('docx')).toEqual(['convert'])
  })

  it('offers an EPUB nothing to decide — it is already the edition', () => {
    expect(plansFor('epub')).toEqual(['as_is'])
  })

  it('never lets a form value pick a plan the source cannot do', () => {
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
    expect(reopensForConversion('pdf', 'convert', 'as_is')).toBe(false)
  })

  it('does not reopen a book with nothing to convert', () => {
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
    expect(originalArtifact('text')).toBe('txt')
  })

  it('keeps every original under books/, away from the sweep', () => {
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
    expect(readSourceKind({})).toBe('pdf')
    expect(readSourceKind({ sourceKind: 'nonsense' })).toBe('pdf')
  })
})

describe('the size limit the framework enforces', () => {
  it('is set at all, so it is never the 1 MB default by accident', () => {
    const config = readFileSync(new URL('../../next.config.mjs', import.meta.url), 'utf8')
    const declared = /bodySizeLimit:\s*'(\d+)mb'/.exec(config)

    expect(declared, 'next.config.mjs must set experimental.serverActions.bodySizeLimit').not.toBe(
      null,
    )
    expect(Number(declared![1])).toBeGreaterThan(1)
  })

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
    expect(readingFormat(['pdf'])).toBe('pdf')
  })

  it('opens the text of a text upload published as it stands', () => {
    expect(readingFormat(['txt'])).toBe('txt')
  })

  it('prefers the built editions over the text they were built from', () => {
    expect(readingFormat(['txt', 'pdf', 'epub'])).toBe('epub')
    expect(readingFormat(['txt', 'pdf'])).toBe('pdf')
  })

  it('never offers the master, whatever else is missing', () => {
    expect(readingFormat(['docx'])).toBe(null)
    expect(readingFormat([])).toBe(null)
  })
})

describe('a reader asking for one particular edition', () => {
  it('gets the format they asked for, even when a better one exists', () => {
    expect(requestedReadingFormat(['epub', 'pdf'], 'pdf')).toBe('pdf')
    expect(requestedReadingFormat(['epub', 'pdf', 'txt'], 'txt')).toBe('txt')
  })

  it('falls back to the best edition when that format is not there', () => {
    expect(requestedReadingFormat(['epub'], 'pdf')).toBe('epub')
  })

  it('ignores anything the reader cannot open, including the master', () => {
    expect(requestedReadingFormat(['epub', 'docx'], 'docx')).toBe('epub')
    expect(requestedReadingFormat(['epub'], '../etc/passwd')).toBe('epub')
  })

  it('picks for the reader who asked for nothing', () => {
    expect(requestedReadingFormat(['pdf', 'txt'], undefined)).toBe('pdf')
    expect(requestedReadingFormat([], null)).toBe(null)
  })
})
