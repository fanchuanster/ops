/**
 * Containment rules for what the converter reports back.
 *
 * The completion payload turns into the files readers are sent, so
 * these are the checks standing between a buggy or tampered converter
 * and one book serving another book's content.
 */

import { describe, expect, it } from 'vitest'

import { acceptPageCount } from './conversion'

/*
 * The containment suite stood here until 2026-08-26. It checked that a
 * converter could not report a key naming another book's directory.
 * There is no converter and no reported keys — `domain/bookStorage.ts`
 * mints them in the Worker — so the function it tested is gone and so
 * is the test. What replaced it is `bookStorage.test.ts`, which pins
 * the property that matters now: a key is derived from a unique name,
 * and an object a book already records is never handed to another.
 */

describe('accepting a reported page count', () => {
  it('takes a plausible count', () => {
    expect(acceptPageCount(6)).toBe(6)
    expect(acceptPageCount('420')).toBe(420)
    expect(acceptPageCount(6.4)).toBe(6)
  })

  it('rejects anything that would produce a nonsense price', () => {
    // Page count sets the price, so garbage here is a garbage charge.
    for (const bad of [0, -5, NaN, Infinity, null, undefined, 'lots', {}, 100_001]) {
      expect(acceptPageCount(bad)).toBeNull()
    }
  })
})
