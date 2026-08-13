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
import {
  KINDLE_SENDER_ADDRESS,
  checkKindleAddress,
  checkKindleDelivery,
  isEmailableSize,
  isKindleDeliverableFormat,
} from './kindle'
import {
  BOOK_LEVELS,
  DEFAULT_BROWSE_LEVEL,
  LEVEL_IDS,
  isVisibleAtLevel,
  levelFromId,
  levelId,
  levelsVisibleAt,
  parseBrowseLevel,
} from './levels'
import { canPublishToLibrary, canSubmitForReview, requiresAdmin } from './moderation'
import { MIN_PASSWORD_LENGTH, checkPassword } from './password'
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

describe('password policy', () => {
  it('accepts a password at the minimum length', () => {
    expect(checkPassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull()
  })

  it('rejects one character short of it', () => {
    expect(checkPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toEqual({
      message: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    })
  })

  it('rejects an empty or missing password', () => {
    expect(checkPassword('')).toEqual({ message: 'Enter a password.' })
    expect(checkPassword(undefined)).toEqual({ message: 'Enter a password.' })
  })

  it('imposes no upper bound, so a passphrase is fine', () => {
    expect(checkPassword('a long quiet room and a good book')).toBeNull()
  })
})

describe('kindle delivery', () => {
  it('accepts both addresses Amazon issues, normalised', () => {
    expect(checkKindleAddress('  Reader_ABC@Kindle.com ')).toEqual({
      valid: true,
      address: 'reader_abc@kindle.com',
    })
    expect(checkKindleAddress('reader@free.kindle.com')).toEqual({
      valid: true,
      address: 'reader@free.kindle.com',
    })
  })

  it('refuses an ordinary email address, which would vanish silently', () => {
    expect(checkKindleAddress('reader@gmail.com')).toEqual({
      valid: false,
      problem: 'wrong_domain',
    })
  })

  it('leaves the local part alone rather than "helpfully" stripping it', () => {
    // Amazon assigns these; dot- and plus-stripping would break real addresses.
    expect(checkKindleAddress('a.b+c@kindle.com')).toEqual({
      valid: true,
      address: 'a.b+c@kindle.com',
    })
  })

  it('never offers the DOCX master to a Kindle', () => {
    expect(isKindleDeliverableFormat('epub')).toBe(true)
    expect(isKindleDeliverableFormat('pdf_xl')).toBe(true)
    expect(isKindleDeliverableFormat('docx')).toBe(false)
  })

  it('measures the encoded size, since base64 is what gets mailed', () => {
    // 18 MB of raw bytes becomes ~24 MB encoded, over the limit.
    expect(isEmailableSize(18 * 1024 * 1024)).toBe(false)
    expect(isEmailableSize(10 * 1024 * 1024)).toBe(true)
    expect(isEmailableSize(0)).toBe(false)
  })

  it('refuses delivery when no transport is configured', () => {
    expect(
      checkKindleDelivery({
        kindleAddress: 'reader@kindle.com',
        format: 'epub',
        transportConfigured: false,
      }),
    ).toEqual({ ok: false, refusal: 'delivery_unavailable' })
  })

  it('refuses delivery before an address is set', () => {
    expect(
      checkKindleDelivery({ kindleAddress: null, format: 'epub', transportConfigured: true }),
    ).toEqual({ ok: false, refusal: 'no_address' })
  })

  it('allows a configured reader and hands back the normalised address', () => {
    expect(
      checkKindleDelivery({
        kindleAddress: ' Reader@Kindle.com ',
        format: 'epub',
        bytes: 3409,
        transportConfigured: true,
      }),
    ).toEqual({ ok: true, address: 'reader@kindle.com' })
  })

  it('names one sender, so the UI reminder and the From header cannot drift', () => {
    expect(KINDLE_SENDER_ADDRESS).toBe('kindle@noblesee.com')
  })
})

describe('reading levels', () => {
  it('nests: each level contains the ones before it', () => {
    expect(levelsVisibleAt('essential')).toEqual(['essential'])
    expect(levelsVisibleAt('normal')).toEqual(['essential', 'normal'])
    expect(levelsVisibleAt('extensive')).toEqual(['essential', 'normal', 'extensive'])
  })

  it('hides deeper books from a shallower reader', () => {
    expect(isVisibleAtLevel('extensive', 'normal')).toBe(false)
    expect(isVisibleAtLevel('normal', 'essential')).toBe(false)
  })

  it('shows an essential book at every level', () => {
    for (const level of BOOK_LEVELS) {
      expect(isVisibleAtLevel('essential', level)).toBe(true)
    }
  })

  it('keeps the id comparison and the level list in agreement', () => {
    // The catalog queries `level <= id`; the UI uses levelsVisibleAt. If
    // the two disagreed, the catalog would show what the rule hides.
    for (const browse of BOOK_LEVELS) {
      const allowed = new Set(levelsVisibleAt(browse))
      for (const book of BOOK_LEVELS) {
        expect(allowed.has(book)).toBe(levelId(book) <= levelId(browse))
        expect(allowed.has(book)).toBe(isVisibleAtLevel(book, browse))
      }
    }
  })

  it('orders the ids so a greater id sees everything below it', () => {
    expect(LEVEL_IDS.essential).toBeLessThan(LEVEL_IDS.normal)
    expect(LEVEL_IDS.normal).toBeLessThan(LEVEL_IDS.extensive)
  })

  it('round-trips a level through its stored id', () => {
    for (const level of BOOK_LEVELS) {
      expect(levelFromId(levelId(level))).toBe(level)
    }
  })

  it('degrades an unrecognised stored id to the default, not to everything', () => {
    // An id written by a later schema must not widen the catalog.
    expect(levelFromId(999)).toBe('normal')
    expect(levelId(levelFromId(999))).toBeLessThan(LEVEL_IDS.extensive)
  })

  it('falls back to the default rather than widening on a bad level', () => {
    // A stale bookmark must not become "show me everything".
    expect(parseBrowseLevel('extenzive')).toBe(DEFAULT_BROWSE_LEVEL)
    expect(parseBrowseLevel(undefined)).toBe(DEFAULT_BROWSE_LEVEL)
    expect(parseBrowseLevel('')).toBe(DEFAULT_BROWSE_LEVEL)
    expect(DEFAULT_BROWSE_LEVEL).not.toBe('extensive')
  })

  it('reads a valid level from the query string', () => {
    expect(parseBrowseLevel('essential')).toBe('essential')
    expect(parseBrowseLevel('extensive')).toBe('extensive')
  })
})

describe('publication review', () => {
  it('will not publish a reader-created book that was never submitted', () => {
    expect(
      canPublishToLibrary({ reviewState: 'unsubmitted', rightsStatus: 'public_domain' }),
    ).toEqual({ allowed: false, reason: 'not_submitted' })
  })

  it('will not publish while review is pending or after rejection', () => {
    expect(
      canPublishToLibrary({ reviewState: 'submitted', rightsStatus: 'public_domain' }),
    ).toEqual({ allowed: false, reason: 'awaiting_review' })
    expect(
      canPublishToLibrary({ reviewState: 'rejected', rightsStatus: 'public_domain' }),
    ).toEqual({ allowed: false, reason: 'rejected' })
  })

  it('does not let approval stand in for rights clearance', () => {
    // An admin saying "this belongs in the library" is not a finding
    // that it is legally distributable. Both gates, independently.
    for (const rightsStatus of ['unknown', 'restricted', 'user_owned'] as const) {
      expect(canPublishToLibrary({ reviewState: 'approved', rightsStatus })).toEqual({
        allowed: false,
        reason: 'rights_not_cleared',
      })
    }
  })

  it('publishes only on approval plus cleared rights', () => {
    expect(
      canPublishToLibrary({ reviewState: 'approved', rightsStatus: 'public_domain' }),
    ).toEqual({ allowed: true })
  })

  it('requires the uploader to declare rights before review', () => {
    expect(
      canSubmitForReview({ reviewState: 'unsubmitted', rightsStatus: 'unknown', hasContent: true }),
    ).toEqual({ allowed: false, reason: 'rights_undeclared' })
  })

  it('will not review an empty book', () => {
    expect(
      canSubmitForReview({
        reviewState: 'unsubmitted',
        rightsStatus: 'public_domain',
        hasContent: false,
      }),
    ).toEqual({ allowed: false, reason: 'no_content' })
  })

  it('refuses a second submission while one is in flight', () => {
    expect(
      canSubmitForReview({ reviewState: 'submitted', rightsStatus: 'public_domain', hasContent: true }),
    ).toEqual({ allowed: false, reason: 'already_submitted' })
  })

  it('lets a rejected submission be fixed and resubmitted', () => {
    expect(
      canSubmitForReview({ reviewState: 'rejected', rightsStatus: 'user_owned', hasContent: true }),
    ).toEqual({ allowed: true })
  })

  it('keeps rights, visibility and level out of the uploader’s hands', () => {
    expect(requiresAdmin('rightsStatus')).toBe(true)
    expect(requiresAdmin('visibility')).toBe(true)
    expect(requiresAdmin('level')).toBe(true)
    expect(requiresAdmin('title')).toBe(false)
  })
})
