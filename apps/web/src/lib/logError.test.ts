import { afterEach, describe, expect, it, vi } from 'vitest'

import { describeError, logError } from './logError'

afterEach(() => vi.restoreAllMocks())

describe('describing what was thrown', () => {
  it('names an Error and keeps its message', () => {
    expect(describeError(new TypeError('nope'))).toBe('TypeError: nope')
  })

  it('follows the cause chain', () => {
    // The interesting half of an Adobe or D1 failure is usually one
    // level down, so a description that stops at the top is the same as
    // no description.
    const inner = new Error('403 from /operation/exportpdf')
    expect(describeError(new Error('export failed', { cause: inner }))).toBe(
      'Error: export failed <- Error: 403 from /operation/exportpdf',
    )
  })

  it('handles what is thrown that is not an Error', () => {
    // Payload rejects with validation objects and fetch with strings.
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
