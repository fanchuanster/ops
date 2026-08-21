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

/**
 * The same set in array form, for database queries.
 *
 * Derived rather than restated: a collection that filters on a
 * hand-written list would silently disagree with `isPubliclyDistributable`
 * the first time this vocabulary changes, and disagreement here means
 * publishing something we should not have.
 */
export const DISTRIBUTABLE_STATUSES: readonly RightsStatus[] = RIGHTS_STATUSES.filter((status) =>
  PUBLICLY_DISTRIBUTABLE.has(status),
)

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

/**
 * The rights an uploader may claim for their own material.
 *
 * A deliberate subset, and the omissions are the point. `unknown` is
 * missing because the uploader is the one person who knows where their
 * file came from, and this is the single moment in the flow when the
 * question is easy to answer — accepting "don't know" here just defers
 * it to someone with less information. `restricted` is missing because
 * nobody uploads a book in order to declare it undistributable.
 *
 * `user_owned` is safe to offer precisely because it never clears
 * public distribution: a reader owning a copy confers no right to
 * publish it to everyone else (CLAUDE.md section 6.1).
 *
 * Lives here rather than beside the upload action because a `'use
 * server'` module may only export async functions — Next rewrites every
 * other export into an action reference, and a client component that
 * imports one gets a function where it expected data.
 */
/*
 * The answers an uploader may give, in the design's order: the ones
 * that can lead to publication first, the dead ends last.
 *
 * The order is the point, and it was inverted until 2026-08-21 —
 * `user_owned` led the list, which is the one answer here that can
 * never clear public distribution. Putting the dead end first invites
 * it, and this is the single question in the flow where a careless
 * answer costs the uploader the library.
 *
 * `licensed` is phrased from the uploader's side, like its neighbours,
 * and names writing it yourself — which is the common case for that
 * status and the one `uploaderShare.ts` already prices at 66%.
 */
export const UPLOADER_RIGHTS = [
  { value: 'public_domain', label: 'It is in the public domain' },
  { value: 'licensed', label: 'I wrote it, or I hold a licence to publish it' },
  { value: 'permission_granted', label: 'I have the rights holder’s permission' },
  { value: 'user_owned', label: 'I own a copy of it' },
] as const satisfies readonly { value: RightsStatus; label: string }[]

export function isUploaderSelectableRights(value: unknown): value is RightsStatus {
  return UPLOADER_RIGHTS.some((option) => option.value === value)
}

export function isPubliclyDistributable(status: RightsStatus): boolean {
  return PUBLICLY_DISTRIBUTABLE.has(status)
}

/**
 * The short name for a rights status, for a reviewer reading a list.
 *
 * Deliberately not `UPLOADER_RIGHTS`' labels, which are sentences in
 * the uploader's own voice ("I own a copy of it") because that is how
 * the question was put to them. A reviewer is scanning a column, not
 * answering a question, and wants the noun.
 */
export const RIGHTS_LABELS: Record<RightsStatus, string> = {
  public_domain: 'Public domain',
  licensed: 'Wrote it, or licensed',
  permission_granted: 'Rights holder’s permission',
  user_owned: 'Owns a copy',
  restricted: 'Restricted',
  unknown: 'Not sure',
}

/**
 * What a rights status means for the reviewer about to decide.
 *
 * Three answers, and only one of them is a warning about the
 * *reviewer's* judgement:
 *
 *   ok     — publication is possible; the decision is editorial.
 *   block  — publication is impossible whatever the reviewer thinks.
 *            Owning a copy is not the right to publish it, and
 *            `restricted` says so outright.
 *   warn   — nobody knows yet. `unknown` is not a refusal, it is an
 *            unanswered question, and the person who can answer it is
 *            the uploader rather than the reviewer.
 *
 * Derived from `isPubliclyDistributable` rather than restated, so the
 * badge in the queue cannot come to disagree with the gate that
 * actually refuses the publish.
 */
export type RightsRisk = 'ok' | 'warn' | 'block'

export function rightsRisk(status: RightsStatus): RightsRisk {
  if (isPubliclyDistributable(status)) return 'ok'
  return status === 'unknown' ? 'warn' : 'block'
}

/**
 * Whether a book may be *read online*, by whoever is asking.
 *
 * The same rights and ownership rules as `canAccessArtifact`, minus its
 * final one: reading does not require an account. That difference is
 * the whole point and is deliberate rather than an oversight —
 * NobleSee exists to make these books pleasant to read, credits pay
 * only for taking one away, and a reader with no account and no balance
 * must still get every word.
 *
 * A private upload is still only its owner's, and uncleared rights
 * still block everyone. Free does not mean unguarded.
 */
export function canReadOnline(request: AccessRequest): AccessDecision {
  const { book, part, userId, ownerId } = request
  const status = effectiveRightsStatus(book.rightsStatus, part?.rightsStatus)

  if (book.visibility === 'private') {
    if (!userId) return { allowed: false, reason: 'authentication_required' }
    if (!ownerId || ownerId !== userId) return { allowed: false, reason: 'not_owner' }
    return { allowed: true }
  }

  if (!isPubliclyDistributable(status)) {
    if (status === 'user_owned' && userId && ownerId === userId) return { allowed: true }
    return { allowed: false, reason: 'rights_not_cleared' }
  }

  return { allowed: true }
}

/**
 * Server-side access decision for a book *leaving* the site.
 *
 * Requires an account, unlike `canReadOnline`: a delivery is charged to
 * a balance, and a balance needs somebody to belong to.
 *
 * Never call this from a UI component and never mirror it client-side
 * as the only check — MODERNIZATION.md section 31, "never trust
 * client-side access decisions".
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
