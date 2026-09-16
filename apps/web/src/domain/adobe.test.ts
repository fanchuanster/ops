import { describe, expect, it } from 'vitest'

import {
  EXPORT_TIMEOUT_MS,
  MAX_SOURCE_BYTES,
  documentTransactions,
  MAX_EXPORT_RETRIES,
  exportHasExpired,
  exportLocaleFor,
  isTransientExportFailure,
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
    expect(exportLocaleFor('zh-Hans')).toBe('zh-CN')
  })

  it('sends a mixed book to the CJK locale', () => {
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
    expect(readExportStatus({ status: 'done', asset: {} }).state).toBe('failed')
  })

  it('carries Adobe’s own message through a failure', () => {
    expect(readExportStatus({ status: 'failed', error: { message: 'BAD_PDF' } })).toEqual({
      state: 'failed',
      message: 'BAD_PDF',
      retryable: false,
    })
  })

  it('marks a busy service as worth sending again', () => {
    expect(
      readExportStatus({
        status: 'failed',
        error: {
          message: 'The operation has timed out, please try after some time.; requestId=neN0EWBJ',
        },
      }).retryable,
    ).toBe(true)
  })

  it('does not retry an export that finished without a file', () => {
    expect(readExportStatus({ status: 'done', asset: {} }).retryable).toBe(false)
  })

  it('treats an unrecognised status as still running', () => {
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
    expect(masterKey(7)).toBe('books/7/book/master.docx')
  })
})

describe('telling a busy service from an unreadable file', () => {
  it('recognises the ways Adobe says it was busy', () => {
    expect(isTransientExportFailure('The operation has timed out, please try after some time.')).toBe(
      true,
    )
    expect(isTransientExportFailure('Request timeout')).toBe(true)
    expect(isTransientExportFailure('429: Too Many Requests')).toBe(true)
    expect(isTransientExportFailure('Service Unavailable, please retry')).toBe(true)
    expect(isTransientExportFailure('500: Internal Server Error')).toBe(true)
  })

  it('treats a fault in the file as permanent', () => {
    expect(isTransientExportFailure('BAD_PDF')).toBe(false)
    expect(isTransientExportFailure('The input file is password protected.')).toBe(false)
    expect(isTransientExportFailure('DISQUALIFIED_PAGE_LIMIT')).toBe(false)
  })

  it('treats an unfamiliar message as permanent', () => {
    expect(isTransientExportFailure('Something entirely new went wrong')).toBe(false)
    expect(isTransientExportFailure('')).toBe(false)
    expect(isTransientExportFailure(null)).toBe(false)
  })

  it('leaves room for more than one attempt and not many', () => {
    expect(MAX_EXPORT_RETRIES).toBeGreaterThanOrEqual(1)
    expect(MAX_EXPORT_RETRIES).toBeLessThanOrEqual(3)
  })
})
