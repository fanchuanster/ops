import { describe, expect, it } from 'vitest'

import { acceptPageCount } from './conversion'

describe('accepting a reported page count', () => {
  it('takes a plausible count', () => {
    expect(acceptPageCount(6)).toBe(6)
    expect(acceptPageCount('420')).toBe(420)
    expect(acceptPageCount(6.4)).toBe(6)
  })

  it('rejects anything that would produce a nonsense price', () => {
    for (const bad of [0, -5, NaN, Infinity, null, undefined, 'lots', {}, 100_001]) {
      expect(acceptPageCount(bad)).toBeNull()
    }
  })
})
