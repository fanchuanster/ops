import { describe, expect, it } from 'vitest'

import { isInPublicLibrary, reviewAfterOriginalChange } from './moderation'

const owned = (review: string, visibility: string) => ({
  status: 'published',
  owner: 1,
  review: { state: review },
  visibility,
})

describe('the public library', () => {
  it('needs an owned book to be both reviewed and public', () => {
    expect(isInPublicLibrary(owned('approved', 'public'))).toBe(true)
    expect(isInPublicLibrary(owned('approved', 'private'))).toBe(false)
    expect(isInPublicLibrary(owned('submitted', 'public'))).toBe(false)
    expect(isInPublicLibrary(owned('rejected', 'public'))).toBe(false)
  })

  it('ignores visibility for a book with no owner', () => {
    expect(isInPublicLibrary({ status: 'published', visibility: 'private' })).toBe(true)
  })

  it('never shows an unpublished book', () => {
    expect(isInPublicLibrary({ ...owned('approved', 'public'), status: 'in_production' })).toBe(false)
  })
})

describe('replacing the original file', () => {
  it('sends an approved book back to review', () => {
    expect(reviewAfterOriginalChange({ reviewState: 'approved', byAdmin: false })).toBe('submitted')
  })

  it('leaves books not yet approved, and administrators’ own, alone', () => {
    for (const state of ['unsubmitted', 'submitted', 'rejected'] as const) {
      expect(reviewAfterOriginalChange({ reviewState: state, byAdmin: false })).toBe(state)
    }
    expect(reviewAfterOriginalChange({ reviewState: 'approved', byAdmin: true })).toBe('approved')
  })
})
