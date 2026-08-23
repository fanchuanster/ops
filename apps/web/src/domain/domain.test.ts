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

import {
  KINDLE_SENDER_ADDRESS,
  checkKindleAddress,
  checkKindleDelivery,
  isEmailableSize,
  isKindleDeliverableFormat,
} from './kindle'
import {
  SIGN_IN_REFUSAL_MESSAGES,
  decideGoogleSignIn,
  verifyGoogleClaims,
} from './googleIdentity'
import { readerAvatarHue, readerInitials, readerName } from './avatar'
import {
  BOOK_LEVELS,
  DEFAULT_BROWSE_LEVEL,
  LEVEL_IDS,
  isVisibleAtLevel,
  levelFromId,
  levelId,
  levelsVisibleAt,
  parseBrowseLevel,
  parseProposedLevel,
} from './levels'
import {
  DELETION_ERRORS,
  REVIEW_LABELS,
  REVIEW_QUEUE_STATES,
  REVIEW_STATES,
  canDeleteUpload,
  canPublishToLibrary,
  canSubmitForReview,
  requiresAdmin,
} from './moderation'
import { MIN_PASSWORD_LENGTH, checkPassword } from './password'
import {
  RIGHTS_LABELS,
  RIGHTS_STATUSES,
  UPLOADER_RIGHTS,
  canAccessArtifact,
  canReadOnline,
  effectiveRightsStatus,
  isPubliclyDistributable,
  isUploaderSelectableRights,
  rightsRisk,
} from './rights'

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
    expect(isKindleDeliverableFormat('pdf')).toBe(true)
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
})

describe('an administrator publishing directly', () => {
  it('does not have to approve a submission first', () => {
    // Publishing *is* the approval — one person, one judgement — so
    // requiring the recorded state beforehand was asking them to take
    // the same decision twice.
    expect(
      canPublishToLibrary({
        reviewState: 'submitted',
        rightsStatus: 'public_domain',
        byAdmin: true,
      }),
    ).toEqual({ allowed: true })
  })

  it('may publish a book it had previously asked for changes on', () => {
    expect(
      canPublishToLibrary({
        reviewState: 'rejected',
        rightsStatus: 'public_domain',
        byAdmin: true,
      }),
    ).toEqual({ allowed: true })
  })

  it('may not publish somebody else’s book that was never offered', () => {
    // The other gate, and it is not an administrator's. CLAUDE.md
    // section 6.2 promises an upload may stay private forever, and an
    // unsubmitted book has never been offered to anyone.
    expect(
      canPublishToLibrary({
        reviewState: 'unsubmitted',
        rightsStatus: 'public_domain',
        byAdmin: true,
      }),
    ).toEqual({ allowed: false, reason: 'not_offered' })
  })

  it('may publish its own upload without submitting it to itself', () => {
    expect(
      canPublishToLibrary({
        reviewState: 'unsubmitted',
        rightsStatus: 'public_domain',
        byAdmin: true,
        ownedByRequester: true,
      }),
    ).toEqual({ allowed: true })
  })

  it('never gets past the rights gate, on its own book or anyone’s', () => {
    for (const rightsStatus of ['unknown', 'restricted', 'user_owned'] as const) {
      expect(
        canPublishToLibrary({
          reviewState: 'approved',
          rightsStatus,
          byAdmin: true,
          ownedByRequester: true,
        }),
      ).toEqual({ allowed: false, reason: 'rights_not_cleared' })
    }
  })

  it('changes nothing for a reader', () => {
    expect(
      canPublishToLibrary({
        reviewState: 'submitted',
        rightsStatus: 'public_domain',
        ownedByRequester: true,
      }),
    ).toEqual({ allowed: false, reason: 'awaiting_review' })
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
    expect(requiresAdmin('title')).toBe(false)
  })

  it('leaves level an administrator field even though it can be proposed', () => {
    // The uploader may suggest one with their submission; nothing in
    // the flow applies it. Asking and deciding are different acts.
    expect(requiresAdmin('level')).toBe(true)
  })
})

describe('proposing a level with a submission', () => {
  it('takes the three levels by name', () => {
    for (const level of BOOK_LEVELS) {
      expect(parseProposedLevel(level)).toBe(level)
    }
  })

  it('reads anything else as no preference', () => {
    // No preference is the ordinary answer, so it must be storable as
    // one: a fallback to the default would put a suggestion in the
    // uploader's mouth that a reviewer would then read as theirs.
    expect(parseProposedLevel('')).toBe(null)
    expect(parseProposedLevel(null)).toBe(null)
    expect(parseProposedLevel('ESSENTIAL')).toBe(null)
    expect(parseProposedLevel(20)).toBe(null)
  })

  it('does not fall back the way the browse control does', () => {
    expect(parseBrowseLevel('nonsense')).toBe(DEFAULT_BROWSE_LEVEL)
    expect(parseProposedLevel('nonsense')).toBe(null)
  })
})

describe('google sign-in', () => {
  const CLIENT = '681003907883-example.apps.googleusercontent.com'
  const NONCE = 'nonce-abc'
  const future = Math.floor(NOW.getTime() / 1000) + 600

  const claims = (over: Record<string, unknown> = {}) => ({
    iss: 'https://accounts.google.com',
    aud: CLIENT,
    exp: future,
    sub: 'google-sub-1',
    nonce: NONCE,
    email: 'Reader@Example.com',
    email_verified: true,
    name: 'A Reader',
    ...over,
  })

  const verify = (over: Record<string, unknown> = {}) =>
    verifyGoogleClaims({ claims: claims(over), clientId: CLIENT, nonce: NONCE, now: NOW })

  it('accepts a well-formed token and normalises the address', () => {
    const result = verify()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.profile).toEqual({
        googleId: 'google-sub-1',
        email: 'reader@example.com',
        emailVerified: true,
        displayName: 'A Reader',
      })
    }
  })

  it('accepts both issuer spellings Google uses', () => {
    expect(verify({ iss: 'accounts.google.com' }).ok).toBe(true)
    expect(verify({ iss: 'https://accounts.google.com' }).ok).toBe(true)
  })

  it('rejects a token minted for another OAuth client', () => {
    // A perfectly valid Google token that must not sign anyone in here.
    expect(verify({ aud: 'someone-else.apps.googleusercontent.com' })).toEqual({
      ok: false,
      reason: 'wrong_audience',
    })
  })

  it('rejects a token from somewhere that is not Google', () => {
    expect(verify({ iss: 'https://evil.example' })).toEqual({ ok: false, reason: 'wrong_issuer' })
  })

  it('rejects an expired token', () => {
    expect(verify({ exp: Math.floor(NOW.getTime() / 1000) - 3600 })).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('rejects a token bound to a different login attempt', () => {
    expect(verify({ nonce: 'someone-elses-nonce' })).toEqual({
      ok: false,
      reason: 'nonce_mismatch',
    })
    expect(verify({ nonce: undefined })).toEqual({ ok: false, reason: 'nonce_mismatch' })
  })

  it('treats anything but a literal true as unverified', () => {
    // Google sends a boolean; a string "true" from anywhere else must
    // not be read as verification.
    const result = verify({ email_verified: 'true' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.profile.emailVerified).toBe(false)
  })

  const profile = {
    googleId: 'google-sub-1',
    email: 'reader@example.com',
    emailVerified: true,
  }

  it('creates an account when the identity is new', () => {
    expect(decideGoogleSignIn({ profile })).toEqual({ action: 'create', profile })
  })

  it('signs in the account already linked to this Google id', () => {
    expect(
      decideGoogleSignIn({
        profile,
        byGoogleId: { id: 7, email: 'moved@example.com', googleId: 'google-sub-1' },
      }),
    ).toEqual({ action: 'sign_in', accountId: 7 })
  })

  it('links to an existing password account with the same verified address', () => {
    expect(
      decideGoogleSignIn({ profile, byEmail: { id: 3, email: 'reader@example.com' } }),
    ).toEqual({ action: 'link_and_sign_in', accountId: 3 })
  })

  it('refuses to link an unverified address, which would be account takeover', () => {
    // Without this, anyone could register a Google account claiming
    // someone else's address and click their way into that account.
    expect(
      decideGoogleSignIn({
        profile: { ...profile, emailVerified: false },
        byEmail: { id: 3, email: 'reader@example.com' },
      }),
    ).toEqual({ action: 'refuse', reason: 'email_unverified' })
  })

  it('refuses an unverified address even when nothing exists to take over', () => {
    expect(decideGoogleSignIn({ profile: { ...profile, emailVerified: false } })).toEqual({
      action: 'refuse',
      reason: 'email_unverified',
    })
  })

  it('will not re-point an address already linked to another Google account', () => {
    expect(
      decideGoogleSignIn({
        profile,
        byEmail: { id: 3, email: 'reader@example.com', googleId: 'a-different-sub' },
      }),
    ).toEqual({ action: 'refuse', reason: 'linked_to_other_account' })
  })

  it('takes the profile picture when Google sends a usable one', () => {
    const result = verify({ picture: 'https://lh3.googleusercontent.com/a/abc123=s96-c' })
    expect(result.ok && result.profile.avatarUrl).toBe(
      'https://lh3.googleusercontent.com/a/abc123=s96-c',
    )
  })

  it('refuses a picture that is not plainly an https URL', () => {
    // The token is signed, so this is defence in depth rather than the
    // load-bearing check — but nothing that is not https should ever
    // reach an <img src>.
    for (const picture of [
      'javascript:alert(1)',
      'data:image/svg+xml,<svg onload="alert(1)"/>',
      'http://lh3.googleusercontent.com/a/abc',
      'not a url',
      '',
      42,
      null,
    ]) {
      const result = verify({ picture })
      expect(result.ok && result.profile.avatarUrl).toBeUndefined()
    }
  })

  it('signs in fine when Google sends no picture at all', () => {
    const result = verify({ picture: undefined })
    expect(result.ok).toBe(true)
    expect(result.ok && result.profile.avatarUrl).toBeUndefined()
  })

  it('has a reader-facing message for every refusal', () => {
    for (const key of [
      'email_unverified',
      'linked_to_other_account',
      'wrong_issuer',
      'wrong_audience',
      'expired',
      'nonce_mismatch',
      'no_subject',
      'no_email',
    ] as const) {
      expect(SIGN_IN_REFUSAL_MESSAGES[key]).toBeTruthy()
    }
  })
})

describe('reader name and initials', () => {
  it('prefers the display name', () => {
    expect(readerName({ email: 'reader@example.com', displayName: 'Wen Dong' })).toBe('Wen Dong')
  })

  it('falls back to the local part rather than the whole address', () => {
    // The header is on screen constantly; the full address is not for it.
    expect(readerName({ email: 'reader@example.com' })).toBe('reader')
    expect(readerName({ email: 'reader@example.com', displayName: '   ' })).toBe('reader')
    expect(readerName({ email: 'reader@example.com', displayName: null })).toBe('reader')
  })

  it('takes two initials from a two-part name and one otherwise', () => {
    expect(readerInitials({ email: 'a@b.com', displayName: 'Wen Dong' })).toBe('WD')
    expect(readerInitials({ email: 'a@b.com', displayName: 'Ada' })).toBe('A')
    // First and last, so a middle name does not displace the surname.
    expect(readerInitials({ email: 'a@b.com', displayName: 'Ada King Lovelace' })).toBe('AL')
  })

  it('keeps a whole CJK character rather than splitting one', () => {
    expect(readerInitials({ email: 'a@b.com', displayName: '王守仁' })).toBe('王')
  })

  it('does not return half a surrogate pair', () => {
    // string[0] on an astral character yields a lone surrogate, which
    // renders as a replacement box.
    const initials = readerInitials({ email: 'a@b.com', displayName: '𠮷田' })
    expect([...initials]).toHaveLength(1)
    expect(initials).toBe('𠮷')
  })

  it('falls back to the address when there is no name', () => {
    expect(readerInitials({ email: 'reader@example.com' })).toBe('R')
  })

  it('gives the same colour for the same reader every time', () => {
    const identity = { email: 'reader@example.com' }
    expect(readerAvatarHue(identity)).toBe(readerAvatarHue({ email: ' Reader@Example.COM ' }))
  })

  it('does not change colour when the display name changes', () => {
    const hue = readerAvatarHue({ email: 'reader@example.com', displayName: 'Before' })
    expect(readerAvatarHue({ email: 'reader@example.com', displayName: 'After' })).toBe(hue)
  })

  it('keeps the hue clear of the site accent', () => {
    for (const email of ['a@b.com', 'reader@example.com', 'x@y.z', '\u738b@example.com']) {
      const hue = readerAvatarHue({ email })
      expect(hue).toBeGreaterThanOrEqual(80)
      expect(hue).toBeLessThan(360)
    }
  })
})

describe('reading online is free of the account requirement', () => {
  const publicDomain = { rightsStatus: 'public_domain' as const, visibility: 'public' as const }

  it('lets a signed-out visitor read a cleared public book', () => {
    // The difference that matters between the two rules, and the reason
    // canReadOnline exists at all.
    expect(canReadOnline({ book: publicDomain, userId: null })).toEqual({ allowed: true })
    expect(canAccessArtifact({ book: publicDomain, userId: null })).toEqual({
      allowed: false,
      reason: 'authentication_required',
    })
  })

  it('still refuses uncleared rights to everyone', () => {
    expect(
      canReadOnline({
        book: { rightsStatus: 'restricted', visibility: 'public' },
        userId: 'reader-1',
      }),
    ).toEqual({ allowed: false, reason: 'rights_not_cleared' })
  })

  it('still keeps a private upload to its owner', () => {
    const book = { rightsStatus: 'user_owned' as const, visibility: 'private' as const }
    expect(canReadOnline({ book, userId: null })).toEqual({
      allowed: false,
      reason: 'authentication_required',
    })
    expect(canReadOnline({ book, userId: 'someone-else', ownerId: 'owner-1' })).toEqual({
      allowed: false,
      reason: 'not_owner',
    })
    expect(canReadOnline({ book, userId: 'owner-1', ownerId: 'owner-1' })).toEqual({
      allowed: true,
    })
  })
})

describe('what an uploader may claim about their own file', () => {
  it('offers only statuses that are safe for an uploader to pick', () => {
    expect(UPLOADER_RIGHTS.map((o) => o.value).sort()).toEqual([
      'licensed',
      'permission_granted',
      'public_domain',
      'user_owned',
    ])
  })

  it('never offers unknown or restricted', () => {
    // `unknown` is excluded because the uploader is the one person who
    // can answer, and accepting "don't know" defers it to someone with
    // less information. `restricted` because nobody uploads a book in
    // order to declare it undistributable.
    for (const value of ['unknown', 'restricted']) {
      expect(isUploaderSelectableRights(value)).toBe(false)
    }
  })

  it('rejects anything that is not one of the offered values', () => {
    for (const junk of ['', 'admin', null, undefined, 42, {}]) {
      expect(isUploaderSelectableRights(junk)).toBe(false)
    }
  })

  it('offers user_owned, which can never clear public distribution', () => {
    // Safe to offer precisely because owning a copy is not a right to
    // publish it to everyone else.
    expect(isUploaderSelectableRights('user_owned')).toBe(true)
    expect(isPubliclyDistributable('user_owned')).toBe(false)
  })
})

describe('deleting your own upload', () => {
  const request = (over: Partial<Parameters<typeof canDeleteUpload>[0]> = {}) =>
    canDeleteUpload({ isOwner: true, boughtByOthers: false, isPublic: false, ...over })

  it('lets an uploader delete their own private book', () => {
    expect(request()).toEqual({ allowed: true })
  })

  it('lets them delete a public book nobody has taken', () => {
    // Being in the library is not itself a reason to keep it.
    expect(request({ isPublic: true })).toEqual({ allowed: true })
  })

  it('refuses when other readers have bought it', () => {
    // An entitlement never expires; deleting the book underneath one
    // would make that promise false.
    expect(request({ boughtByOthers: true })).toEqual({
      allowed: false,
      reason: 'bought_by_others',
    })
  })

  it('refuses anyone who is not the uploader', () => {
    expect(request({ isOwner: false })).toEqual({ allowed: false, reason: 'not_owner' })
  })

  it('has a message for every refusal', () => {
    for (const reason of ['not_owner', 'bought_by_others'] as const) {
      expect(DELETION_ERRORS[reason]).toBeTruthy()
    }
  })
})

describe('what a reviewer is shown about a submission', () => {
  it('names every rights status and every review state', () => {
    // A missing key here is a blank cell in the queue, which reads as
    // "no rights declared" rather than as a gap in this table.
    for (const status of RIGHTS_STATUSES) {
      expect(RIGHTS_LABELS[status]).toBeTruthy()
    }
    for (const state of REVIEW_STATES) {
      expect(REVIEW_LABELS[state]).toBeTruthy()
    }
  })

  it('marks a status as blocking exactly when publication is impossible', () => {
    for (const status of RIGHTS_STATUSES) {
      const risk = rightsRisk(status)
      // The badge and the gate must never disagree: an "ok" badge on a
      // book the publish hook would refuse is the one failure that
      // wastes a reviewer's decision.
      expect(risk === 'ok').toBe(isPubliclyDistributable(status))
    }
  })

  it('separates "we know it cannot be published" from "nobody has said"', () => {
    expect(rightsRisk('user_owned')).toBe('block')
    expect(rightsRisk('restricted')).toBe('block')
    // Unknown is an unanswered question, not a refusal, and only the
    // uploader can answer it.
    expect(rightsRisk('unknown')).toBe('warn')
  })

  it('keeps drafts out of the review queue', () => {
    // A private upload nobody has offered is a workspace, not a queue
    // item — reviewing one would quietly undo "you may keep this
    // private forever".
    expect(REVIEW_QUEUE_STATES).not.toContain('unsubmitted')
    expect(REVIEW_QUEUE_STATES).toContain('submitted')
  })

  it('calls a rejection what the uploader was told it was', () => {
    // canSubmitForReview lets a rejected book be submitted again, so
    // the state means "not yet", and the uploader's own screen says
    // "Changes requested". The queue must not call the same row
    // something harsher.
    expect(canSubmitForReview({
      reviewState: 'rejected',
      rightsStatus: 'public_domain',
      hasContent: true,
    })).toEqual({ allowed: true })
    expect(REVIEW_LABELS.rejected).toBe('Changes needed')
  })
})
