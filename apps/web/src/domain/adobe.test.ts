import { describe, expect, it } from 'vitest'

import {
  EXPORT_TIMEOUT_MS,
  MAX_SOURCE_BYTES,
  documentTransactions,
  exportHasExpired,
  exportLocaleFor,
  masterKey,
  needsExport,
  readExportStatus,
  withinSizeLimit,
} from './adobe'

describe('choosing an OCR locale', () => {
  it('reads traditional Chinese as traditional Chinese', () => {
    expect(exportLocaleFor('zh-Hant')).toBe('zh-Hant')
  })

  it('maps simplified Chinese to Adobe’s spelling of it', () => {
    // Adobe's Export PDF enum says `zh-CN`, not `zh-Hans`.
    expect(exportLocaleFor('zh-Hans')).toBe('zh-CN')
  })

  it('sends a mixed book to the CJK locale', () => {
    // Latin under a CJK locale reads far better than CJK under a Latin
    // one, so the asymmetric failure decides it.
    expect(exportLocaleFor('zh-en')).toBe('zh-Hant')
  })

  it('falls back to traditional Chinese for anything unknown', () => {
    expect(exportLocaleFor(null)).toBe('zh-Hant')
    expect(exportLocaleFor('ja')).toBe('zh-Hant')
  })

  it('reads an English book in English', () => {
    expect(exportLocaleFor('en')).toBe('en-US')
  })
})

describe('the size limit', () => {
  it('accepts a file at the limit', () => {
    expect(withinSizeLimit(MAX_SOURCE_BYTES)).toBe(true)
  })

  it('refuses one over it', () => {
    expect(withinSizeLimit(MAX_SOURCE_BYTES + 1)).toBe(false)
  })

  it('refuses an empty file', () => {
    expect(withinSizeLimit(0)).toBe(false)
  })
})

describe('counting document transactions', () => {
  it('charges one for a short book', () => {
    expect(documentTransactions(1)).toBe(1)
    expect(documentTransactions(50)).toBe(1)
  })

  it('rounds a part-used block up', () => {
    expect(documentTransactions(51)).toBe(2)
    expect(documentTransactions(400)).toBe(8)
  })

  it('never reports less than one', () => {
    expect(documentTransactions(0)).toBe(1)
    expect(documentTransactions(Number.NaN)).toBe(1)
  })
})

describe('reading a job status', () => {
  it('recognises a finished export', () => {
    expect(
      readExportStatus({ status: 'done', asset: { downloadUri: 'https://example.test/x.docx' } }),
    ).toEqual({ state: 'done', downloadUri: 'https://example.test/x.docx' })
  })

  it('treats a finished export with no file as a failure', () => {
    // Nothing downstream could act on it, and reporting `done` would
    // move the book to `master_ready` with no master.
    expect(readExportStatus({ status: 'done', asset: {} }).state).toBe('failed')
  })

  it('carries Adobe’s own message through a failure', () => {
    expect(readExportStatus({ status: 'failed', error: { message: 'BAD_PDF' } })).toEqual({
      state: 'failed',
      message: 'BAD_PDF',
    })
  })

  it('treats an unrecognised status as still running', () => {
    // Abandoning a job we have already paid for because the vendor added
    // a status word is the expensive way to be wrong.
    expect(readExportStatus({ status: 'in progress' }).state).toBe('running')
    expect(readExportStatus({ status: 'queued somewhere new' }).state).toBe('running')
    expect(readExportStatus(null).state).toBe('running')
  })
})

describe('abandoning a stuck export', () => {
  const started = '2026-08-19T00:00:00.000Z'
  const startedAt = Date.parse(started)

  it('leaves a job inside the window alone', () => {
    expect(exportHasExpired(started, startedAt + EXPORT_TIMEOUT_MS - 1000)).toBe(false)
  })

  it('gives up once Adobe’s assets are about to expire', () => {
    expect(exportHasExpired(started, startedAt + EXPORT_TIMEOUT_MS + 1000)).toBe(true)
  })

  it('never expires a job with no recorded start', () => {
    // Books submitted before the timestamp existed. Failing them on a
    // missing field would fail work that is running perfectly well.
    expect(exportHasExpired(null, Date.now())).toBe(false)
    expect(exportHasExpired('not a date', Date.now())).toBe(false)
  })
})

describe('deciding what needs an export', () => {
  it('sends every PDF, text layer or not', () => {
    expect(needsExport('scan.pdf')).toBe(true)
    expect(needsExport('anything', 'application/pdf')).toBe(true)
  })

  it('keeps text sources out of it', () => {
    expect(needsExport('book.docx')).toBe(false)
    expect(needsExport('book.txt')).toBe(false)
  })

  it('falls back to the extension when the type is unhelpful', () => {
    expect(needsExport('scan.PDF ', 'application/octet-stream')).toBe(true)
    expect(needsExport('notes.txt', 'application/octet-stream')).toBe(false)
  })
})

describe('where the master lives', () => {
  it('sits under its own book’s prefix', () => {
    // The containment rule the download path checks.
    expect(masterKey(7)).toBe('books/7/book/master.docx')
  })
})
