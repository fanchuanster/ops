/**
 * Parity tests for the domain rules.
 *
 * These mirror the behaviours asserted by the previous implementation's
 * smoke test (`tools/smoke-test.sh`), which was the only executable
 * specification of how NobleSee actually behaves. Porting them here
 * first means the rebuild is measured against real behaviour rather
 * than against a fresh set of assumptions.
 */

import { describe, expect, it } from 'vitest'

import { checkDownloadLimit, type DownloadRecord } from './downloadLimit'
import { canAccessArtifact, effectiveRightsStatus, isPubliclyDistributable } from './rights'
import { releaseState } from './stagedRelease'

const NOW = new Date('2026-08-12T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000)

describe('rights', () => {
  it('fails closed on unknown status', () => {
    expect(isPubliclyDistributable('unknown')).toBe(false)
    expect(isPubliclyDistributable('restricted')).toBe(false)
  })

  it('permits distribution only for cleared statuses', () => {
    expect(isPubliclyDistributable('public_domain')).toBe(true)
    expect(isPubliclyDistributable('licensed')).toBe(true)
    expect(isPubliclyDistributable('permission_granted')).toBe(true)
  })

  it('lets a part be more restricted than its book, never less', () => {
    expect(effectiveRightsStatus('public_domain', 'restricted')).toBe('restricted')
    // The permissive override is ignored — this is the direction that matters.
    expect(effectiveRightsStatus('restricted', 'public_domain')).toBe('restricted')
    expect(effectiveRightsStatus('licensed', undefined)).toBe('licensed')
  })

  it('requires an account even for public-domain downloads', () => {
    const decision = canAccessArtifact({
      book: { rightsStatus: 'public_domain', visibility: 'public' },
      userId: null,
    })
    expect(decision).toEqual({ allowed: false, reason: 'authentication_required' })
  })

  it('never exposes a private workspace book to another user', () => {
    const book = { rightsStatus: 'public_domain', visibility: 'private' } as const
    expect(canAccessArtifact({ book, userId: 'u2', ownerId: 'u1' })).toEqual({
      allowed: false,
      reason: 'not_owner',
    })
    expect(canAccessArtifact({ book, userId: 'u1', ownerId: 'u1' })).toEqual({ allowed: true })
  })

  it('refuses an uncleared book to a logged-in reader', () => {
    expect(
      canAccessArtifact({
        book: { rightsStatus: 'unknown', visibility: 'public' },
        userId: 'u1',
      }),
    ).toEqual({ allowed: false, reason: 'rights_not_cleared' })
  })
})

describe('download limit', () => {
  const policy = { maxBooksPerWindow: 2, windowHours: 24 }

  it('counts four formats of one book as a single slot', () => {
    const history: DownloadRecord[] = ['epub', 'docx', 'pdf_standard', 'pdf_large'].map(() => ({
      bookId: 'book-1',
      at: hoursAgo(1),
    }))
    const decision = checkDownloadLimit('book-1', history, NOW, policy)
    expect(decision.allowed).toBe(true)
    // One distinct book consumed, so one slot remains of two.
    expect(decision.remaining).toBe(1)
  })

  it('blocks a second distinct book once the limit is reached', () => {
    const history: DownloadRecord[] = [
      { bookId: 'book-1', at: hoursAgo(2) },
      { bookId: 'book-2', at: hoursAgo(1) },
    ]
    const decision = checkDownloadLimit('book-3', history, NOW, policy)
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      // The slot frees when the oldest book ages out, not 24h from now.
      expect(decision.retryAfter.toISOString()).toBe(
        new Date(hoursAgo(2).getTime() + 24 * 60 * 60 * 1000).toISOString(),
      )
    }
  })

  it('still allows a book already counted in the window, even at the limit', () => {
    const history: DownloadRecord[] = [
      { bookId: 'book-1', at: hoursAgo(2) },
      { bookId: 'book-2', at: hoursAgo(1) },
    ]
    const decision = checkDownloadLimit('book-1', history, NOW, policy)
    expect(decision.allowed).toBe(true)
    if (decision.allowed) expect(decision.alreadyCounted).toBe(true)
  })

  it('rolls old downloads out of the window', () => {
    const history: DownloadRecord[] = [
      { bookId: 'book-1', at: hoursAgo(25) },
      { bookId: 'book-2', at: hoursAgo(30) },
    ]
    expect(checkDownloadLimit('book-3', history, NOW, policy).allowed).toBe(true)
  })
})

describe('staged release', () => {
  const config = { enabled: true, unlockDelayHours: 24 }
  const progress = (entries: [number, Date][]) => ({ startedAt: new Map(entries) })

  it('always opens the first part', () => {
    expect(releaseState(1, progress([]), config, NOW)).toEqual({ state: 'open' })
  })

  it('opens everything when staging is disabled', () => {
    expect(
      releaseState(5, progress([]), { enabled: false, unlockDelayHours: 24 }, NOW),
    ).toEqual({ state: 'open' })
  })

  it('makes the next part wait, and says when it opens', () => {
    const state = releaseState(2, progress([[1, hoursAgo(6)]]), config, NOW)
    expect(state.state).toBe('waiting')
    if (state.state === 'waiting') {
      expect(state.opensAt.toISOString()).toBe(
        new Date(hoursAgo(6).getTime() + 24 * 60 * 60 * 1000).toISOString(),
      )
    }
  })

  it('opens the next part once the delay has elapsed', () => {
    expect(releaseState(2, progress([[1, hoursAgo(25)]]), config, NOW)).toEqual({ state: 'open' })
  })

  it('locks a part whose predecessor was never started', () => {
    expect(releaseState(3, progress([[1, hoursAgo(48)]]), config, NOW)).toEqual({
      state: 'locked',
      reason: 'previous_part_not_started',
    })
  })

  it('keeps a part open once the reader has started it', () => {
    expect(releaseState(2, progress([[2, hoursAgo(1)]]), config, NOW)).toEqual({ state: 'open' })
  })
})
