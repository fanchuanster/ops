import { describe, expect, it } from 'vitest'

import { SOURCE_TAIL_BYTES, looksTruncated } from './intake'

const pad = (length: number) => 'x'.repeat(length)

const EOCD = 'PK'

describe('looksTruncated', () => {
  it('accepts a PDF that ends with its end-of-file marker', () => {
    expect(looksTruncated('pdf', 'trailer<</Size 9>>\nstartxref\n42\n%%EOF\n')).toBe(false)
  })

  it('rejects a PDF cut off mid-stream', () => {
    expect(looksTruncated('pdf', pad(SOURCE_TAIL_BYTES))).toBe(true)
  })

  it('rejects a PDF whose only end marker belongs to an earlier revision', () => {
    expect(looksTruncated('pdf', `%%EOF${pad(4096)}`)).toBe(true)
  })

  it('accepts a zip-based book that still carries its central directory', () => {
    expect(looksTruncated('epub', `${pad(1000)}${EOCD}${pad(20)}`)).toBe(false)
  })

  it('finds the central directory behind a long archive comment', () => {
    expect(looksTruncated('docx', `${EOCD}${pad(60_000)}`)).toBe(false)
  })

  it('rejects a zip-based book cut off before its central directory', () => {
    expect(looksTruncated('docx', pad(SOURCE_TAIL_BYTES))).toBe(true)
  })

  it('passes plain text through, because any part of it still reads', () => {
    expect(looksTruncated('text', pad(10))).toBe(false)
  })
})
