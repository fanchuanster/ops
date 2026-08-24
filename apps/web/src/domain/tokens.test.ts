import { describe, expect, it } from 'vitest'

import { TOKEN_PREFIX, maskToken, newToken } from './tokens'

describe('newToken', () => {
  it('carries the prefix and 48 hex characters', () => {
    const token = newToken()
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true)
    expect(token.slice(TOKEN_PREFIX.length)).toMatch(/^[0-9a-f]{48}$/)
  })

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newToken()))
    expect(seen.size).toBe(200)
  })
})

describe('maskToken', () => {
  it('keeps the prefix and both ends of the body', () => {
    const masked = maskToken(`${TOKEN_PREFIX}0123456789abcdef0123456789abcdef`)
    expect(masked).toBe(`${TOKEN_PREFIX}0123…cdef`)
  })

  it('tells two tokens apart', () => {
    expect(maskToken(newToken())).not.toBe(maskToken(newToken()))
  })

  // A key minted in the CMS before this screen existed is a bare UUID.
  it('masks a token that carries no prefix of ours', () => {
    const masked = maskToken('4f1c2b8e-2a77-4c1e-9e3a-0d6b5f8a1c22')
    expect(masked).toBe('4f1c…1c22')
    expect(masked).not.toContain(TOKEN_PREFIX)
  })

  it('never prints a short secret back', () => {
    expect(maskToken('short')).toBe('•••••')
    expect(maskToken('ab')).toBe('••••')
  })
})
