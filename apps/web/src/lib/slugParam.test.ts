import { describe, expect, it } from 'vitest'

import { slugFromParam } from './slugParam'

describe('slugFromParam', () => {
  it('leaves an ordinary slug alone', () => {
    expect(slugFromParam('tao-te-ching')).toBe('tao-te-ching')
  })

  it('decodes a Chinese title, which is the case that was broken', () => {
    expect(slugFromParam('%E5%A3%BD%E5%BA%B7%E5%AF%B6%E9%91%92%E7%8F%BE%E4%BB%A3%E5%85%A8%E8%AD%AF-80120299')).toBe(
      '壽康寶鑒現代全譯-80120299',
    )
  })

  it('is a no-op on a segment Next already normalized', () => {
    expect(slugFromParam('analects')).toBe('analects')
  })

  it('falls back to the raw value rather than throwing on a malformed segment', () => {
    expect(slugFromParam('%E5%A3')).toBe('%E5%A3')
    expect(slugFromParam('100%-cotton')).toBe('100%-cotton')
  })
})
