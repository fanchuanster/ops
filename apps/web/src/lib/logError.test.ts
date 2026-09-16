import { afterEach, describe, expect, it, vi } from 'vitest'

import { describeError, logError } from './logError'

afterEach(() => vi.restoreAllMocks())

describe('describing what was thrown', () => {
  it('names an Error and keeps its message', () => {
    expect(describeError(new TypeError('nope'))).toBe('TypeError: nope')
  })

  it('follows the cause chain', () => {
    const inner = new Error('403 from /operation/exportpdf')
    expect(describeError(new Error('export failed', { cause: inner }))).toBe(
      'Error: export failed <- Error: 403 from /operation/exportpdf',
    )
  })

  it('handles what is thrown that is not an Error', () => {
    expect(describeError('plain string')).toBe('plain string')
    expect(describeError({ status: 413 })).toBe('{"status":413}')
  })

  it('never throws, whatever it is handed', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => describeError(circular)).not.toThrow()
    expect(describeError(undefined)).toBeTypeOf('string')
  })
})

describe('logging', () => {
  it('writes one greppable line naming the operation', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('upload: store source in R2', new Error('boom'))
    expect(spy.mock.calls[0][0]).toBe('[noblesee] upload: store source in R2 — Error: boom')
  })
})
