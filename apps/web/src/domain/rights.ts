/**
 * Rights vocabulary and access rules.
 *
 * This module is deliberately framework-independent: no Payload, no
 * Next, no database imports. MODERNIZATION.md sections 3 and 7 require
 * the NobleSee domain to be able to exist without Payload, and the only
 * way that stays true is if the domain never imports it. Payload hooks
 * and route handlers call *into* this module; it never calls out.
 */

export const RIGHTS_STATUSES = [
  'public_domain',
  'licensed',
  'permission_granted',
  'user_owned',
  'restricted',
  'unknown',
] as const

export type RightsStatus = (typeof RIGHTS_STATUSES)[number]

/**
 * Statuses that permit public distribution.
 *
 * `unknown` is deliberately absent: an unreviewed book must fail
 * closed. MODERNIZATION.md section 11 — "do not assume uploaded books
 * can legally be redistributed".
 */
const PUBLICLY_DISTRIBUTABLE: ReadonlySet<RightsStatus> = new Set<RightsStatus>([
  'public_domain',
  'licensed',
  'permission_granted',
])

export type Visibility = 'public' | 'private'

export interface RightsBearing {
  rightsStatus: RightsStatus
  /** Public library content vs. a private user conversion workspace. */
  visibility: Visibility
}

export interface AccessRequest {
  book: RightsBearing
  /** A Part may override its Book — see `effectiveRightsStatus`. */
  part?: Pick<RightsBearing, 'rightsStatus'> & { rightsStatus?: RightsStatus }
  /** Null for anonymous visitors. */
  userId?: string | null
  /** Owner of a private workspace item, when applicable. */
  ownerId?: string | null
}

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: AccessDenialReason }

export type AccessDenialReason =
  | 'authentication_required'
  | 'not_owner'
  | 'rights_not_cleared'

/**
 * A Part may be *more* restricted than its Book, never less.
 *
 * The WordPress implementation could not express this at all (rights
 * lived only on the Book); it is fixed here rather than reproduced.
 */
export function effectiveRightsStatus(
  bookStatus: RightsStatus,
  partStatus?: RightsStatus,
): RightsStatus {
  if (!partStatus) return bookStatus
  return restrictiveness(partStatus) > restrictiveness(bookStatus) ? partStatus : bookStatus
}

function restrictiveness(status: RightsStatus): number {
  switch (status) {
    case 'public_domain':
      return 0
    case 'licensed':
    case 'permission_granted':
      return 1
    case 'user_owned':
      return 2
    case 'unknown':
      return 3
    case 'restricted':
      return 4
  }
}

export function isPubliclyDistributable(status: RightsStatus): boolean {
  return PUBLICLY_DISTRIBUTABLE.has(status)
}

/**
 * Server-side access decision. Never call this from a UI component and
 * never mirror it client-side as the only check — MODERNIZATION.md
 * section 31, "never trust client-side access decisions".
 */
export function canAccessArtifact(request: AccessRequest): AccessDecision {
  const { book, part, userId, ownerId } = request
  const status = effectiveRightsStatus(book.rightsStatus, part?.rightsStatus)

  // Private workspace content is visible only to its owner, whatever
  // its rights status says.
  if (book.visibility === 'private') {
    if (!userId) return { allowed: false, reason: 'authentication_required' }
    if (!ownerId || ownerId !== userId) return { allowed: false, reason: 'not_owner' }
    return { allowed: true }
  }

  if (!isPubliclyDistributable(status)) {
    // `user_owned` material in the public library is still only for its
    // owner; everything else simply is not cleared.
    if (status === 'user_owned' && userId && ownerId === userId) return { allowed: true }
    return { allowed: false, reason: 'rights_not_cleared' }
  }

  // Cleared for distribution, but downloads still require an account —
  // that is what makes per-user limits meaningful.
  if (!userId) return { allowed: false, reason: 'authentication_required' }

  return { allowed: true }
}
