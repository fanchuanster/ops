import { describe, expect, it } from 'vitest'

import { acceptPageCount, byDisplayOrder } from './conversion'

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

describe('the order formats are offered in', () => {
  it('puts the page image first and the generated editions after it', () => {
    const shown = [{ format: 'epub' }, { format: 'docx' }, { format: 'txt' }, { format: 'pdf' }]
    expect(shown.sort(byDisplayOrder).map((a) => a.format)).toEqual([
      'pdf',
      'txt',
      'docx',
      'epub',
    ])
  })

  it('leaves a format nobody ranked at the end rather than in front', () => {
    const shown = [{ format: 'mobi' }, { format: 'epub' }]
    expect(shown.sort(byDisplayOrder).map((a) => a.format)).toEqual(['epub', 'mobi'])
  })
})
