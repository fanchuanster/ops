/**
 * Review of reader-created books before they reach the public library.
 *
 * A reader may convert their own material and keep it in a private
 * workspace indefinitely — that needs no one's permission and no review.
 * Publishing it to the public library is a different act, and it takes
 * an administrator, because NobleSee is answerable for what it hosts.
 *
 * Two gates, and both must open:
 *
 *   1. an administrator approved the submission, and
 *   2. the rights status permits public distribution (`rights.ts`)
 *
 * The second is not a formality the first can wave through. An admin
 * approving a submission is saying "this belongs in the library"; it is
 * not a finding that the book is legally distributable, and conflating
 * the two is how a preservation project ends up redistributing something
 * it had no right to. `user_owned` is the status for "the uploader owns
 * a copy", and it never clears public distribution — a reader owning a
 * book confers no right to publish it to everyone else.
 *
 * Since 2026-08-23 an administrator does not have to *record* the first
 * gate before walking through it: publishing a book is approving it, by
 * the same person, in the same act, so `canPublishToLibrary` accepts
 * `byAdmin` and the write records the approval it implies. Nothing
 * about the second gate changed, and nothing about it can.
 *
 * There is a third thing, easy to mistake for the first: **the uploader
 * offering the book**. An administrator's approval is theirs to give
 * early; the offer is not theirs at all. A private upload that was
 * never submitted stays private, whoever is asking — unless the
 * administrator is its uploader, in which case they are both parties.
 *
 * Framework-independent, like everything in `src/domain`.
 */

import { type RightsStatus, isPubliclyDistributable } from './rights'

export const REVIEW_STATES = ['unsubmitted', 'submitted', 'approved', 'rejected'] as const

export type ReviewState = (typeof REVIEW_STATES)[number]

/**
 * What each review state is called where a person can see it.
 *
 * `rejected` is labelled "Changes needed", and that is not a
 * euphemism — it is what the state means. `canSubmitForReview` above
 * lets a rejected book be submitted again precisely because rejection
 * here is "this is not ready", not "this is not welcome", and the
 * uploader's own screen has said "Changes requested" since the
 * submission form was written. A reviewer's queue calling the same row
 * "Rejected" would be the two halves of one conversation using
 * different words for the same act.
 *
 * The design carries a fourth chip, a permanent Rejected distinct from
 * Changes needed. There is no such state and one was not invented for
 * it: a fifth review state means a migration, a rule about whether it
 * can be reversed, and an answer to what the uploader is told — none of
 * which the queue screen can decide on its own.
 */
export const REVIEW_LABELS: Record<ReviewState, string> = {
  unsubmitted: 'Draft',
  submitted: 'Pending',
  approved: 'Approved',
  rejected: 'Changes needed',
}

/** The states a submitted book can be sitting in, newest concern first. */
export const REVIEW_QUEUE_STATES: readonly ReviewState[] = [
  'submitted',
  'rejected',
  'approved',
]

export interface SubmissionRequest {
  reviewState: ReviewState
  /** What the uploader declared this material to be. */
  rightsStatus: RightsStatus
  /** Whether the book has any published content to review. */
  hasContent: boolean
}

export type SubmissionDecision =
  | { allowed: true }
  | { allowed: false; reason: SubmissionBlockedReason }

export type SubmissionBlockedReason =
  | 'already_submitted'
  | 'already_approved'
  | 'rights_undeclared'
  | 'no_content'

/**
 * May this book be submitted for review?
 *
 * `unknown` rights block submission on purpose. The uploader is the only
 * person who knows where their material came from, and asking them to
 * say so before a reviewer spends time on it is both cheaper and more
 * honest than having the reviewer guess. It is also the one moment in
 * the flow where the question is easy to answer.
 */
export function canSubmitForReview(request: SubmissionRequest): SubmissionDecision {
  const { reviewState, rightsStatus, hasContent } = request

  if (reviewState === 'submitted') return { allowed: false, reason: 'already_submitted' }
  if (reviewState === 'approved') return { allowed: false, reason: 'already_approved' }
  if (!hasContent) return { allowed: false, reason: 'no_content' }
  if (rightsStatus === 'unknown') return { allowed: false, reason: 'rights_undeclared' }

  // A rejected submission may be resubmitted: rejection is usually a
  // fixable problem with the material, not a permanent verdict.
  return { allowed: true }
}

export interface PublicationRequest {
  reviewState: ReviewState
  /** The book's effective rights status — see `effectiveRightsStatus`. */
  rightsStatus: RightsStatus
  /**
   * Whether the person publishing is an administrator.
   *
   * An administrator does not have to approve a submission before
   * publishing it, because publishing it *is* approving it — the same
   * person making the same editorial judgement. Requiring the approved
   * state first was asking them to record their decision, then take it
   * again.
   */
  byAdmin?: boolean
  /**
   * Whether that administrator is the book's own uploader.
   *
   * The one thing an administrator may not skip. Two gates stand
   * between a private upload and the library, and only one of them is
   * theirs: the uploader offering the book is the *other* one. A book
   * that has never been submitted has never been offered, and CLAUDE.md
   * section 6.2 promises an upload may stay private forever — so
   * publishing someone else's unsubmitted book would break a promise
   * made to the person who uploaded it.
   *
   * An administrator publishing their *own* upload is both parties at
   * once, so nothing is being skipped.
   */
  ownedByRequester?: boolean
}

export type PublicationDecision =
  | { allowed: true }
  | { allowed: false; reason: PublicationBlockedReason }

export type PublicationBlockedReason =
  | 'not_submitted'
  | 'awaiting_review'
  | 'rejected'
  | 'not_offered'
  | 'rights_not_cleared'

/**
 * May this reader-created book be made public?
 *
 * Fails closed at every branch. Call it before flipping `visibility` to
 * `public`, never after.
 *
 * The review gate is waived for an administrator (`byAdmin`), and only
 * the review gate. The rights gate is never waived by anybody — an
 * approval is not a finding that the material is distributable, which
 * is the distinction this whole module exists to keep.
 */
export function canPublishToLibrary(request: PublicationRequest): PublicationDecision {
  const { byAdmin = false, ownedByRequester = false } = request

  if (byAdmin) {
    // Publishing is the approval, so the state it would have left
    // behind is not required to already be there. The uploader's offer
    // is a different gate and is not an administrator's to skip.
    if (request.reviewState === 'unsubmitted' && !ownedByRequester) {
      return { allowed: false, reason: 'not_offered' }
    }
  } else {
    switch (request.reviewState) {
      case 'unsubmitted':
        return { allowed: false, reason: 'not_submitted' }
      case 'submitted':
        return { allowed: false, reason: 'awaiting_review' }
      case 'rejected':
        return { allowed: false, reason: 'rejected' }
      case 'approved':
        break
    }
  }

  if (!isPubliclyDistributable(request.rightsStatus)) {
    return { allowed: false, reason: 'rights_not_cleared' }
  }

  return { allowed: true }
}

/**
 * Does a change to these fields need an administrator?
 *
 * Everything a reader may do to their own book is editorial. Publishing
 * it, clearing its rights, and levelling it are all judgements NobleSee
 * makes rather than the uploader — a reader marking their own upload
 * `public_domain` and `essential` would otherwise walk it straight into
 * the front of the library.
 *
 * `level` stays on this list even though an uploader may now *propose*
 * one when they submit (`review.proposedLevel`, and
 * `parseProposedLevel` in `levels.ts`). A proposal is a sentence
 * addressed to the reviewer, stored beside the submission rather than
 * on the book: nothing reads it when deciding what a reader sees, and
 * approving a submission does not apply it. Someone has to type the
 * level in, and that someone is an administrator — which is the whole
 * distinction between asking and deciding.
 */
/**
 * Fields on a book that only an administrator may write.
 *
 * `collectionOrder` joined the list on 2026-08-25 and is the one that
 * needs explaining, because *filing* a book onto a shelf is not on it.
 * An uploader may choose their book's collection, and the arrival hook
 * gives it the next free number on that shelf — that is a book taking
 * its place at the back of a queue. Choosing the number is a different
 * act: `placeInOrder` shifts the run of books already there, so it
 * moves other people's books, and it is a curator's judgement about
 * what a reader should meet first. Whoever can type a 1 can put
 * themselves at the front of the library.
 */
export const ADMIN_ONLY_BOOK_FIELDS = [
  'visibility',
  'rightsStatus',
  'level',
  'review',
  'collectionOrder',
] as const

export function requiresAdmin(field: string): boolean {
  return (ADMIN_ONLY_BOOK_FIELDS as readonly string[]).includes(field)
}


export interface DeletionRequest {
  /** Is the person asking the book's uploader? */
  isOwner: boolean
  /**
   * Is the person asking an administrator?
   *
   * Separate from `isOwner` rather than folded into it, because the two
   * grant different things: ownership is a claim on the book, and the
   * admin role is the library's own authority to withdraw one. Only the
   * first gate distinguishes them — the second binds both.
   */
  isAdmin: boolean
  /** Do readers other than the uploader hold entitlements to it? */
  boughtByOthers: boolean
  /** Is it currently in the public library? */
  isPublic: boolean
}

export type DeletionDecision =
  | { allowed: true }
  | { allowed: false; reason: DeletionBlockedReason }

export type DeletionBlockedReason = 'not_owner' | 'bought_by_others'

/**
 * May this person delete this upload?
 *
 * For its uploader: yes, almost always. It is their book, it is private
 * by default, and a workspace you cannot clear out is not a workspace.
 *
 * For an administrator: yes to any book, theirs or not. Somebody has to
 * be able to take a book out of the library — material that turns out
 * to be misfiled, mis-scanned, or not distributable after all — and
 * ownership is exactly the thing they will not have.
 *
 * The exception binds both of them, and that is the point of it: a
 * reader has spent credits to have this book delivered. That purchase
 * is permanent by design — an entitlement never expires — and deleting
 * the book underneath it would make the promise false whoever presses
 * the button. An administrator has authority over the library, not over
 * what a reader already bought. Being in the public library is *not*
 * itself a reason to refuse; a book nobody has taken can still be
 * withdrawn.
 */
export function canDeleteUpload(request: DeletionRequest): DeletionDecision {
  if (!request.isOwner && !request.isAdmin) return { allowed: false, reason: 'not_owner' }
  if (request.boughtByOthers) return { allowed: false, reason: 'bought_by_others' }
  return { allowed: true }
}

export const DELETION_ERRORS: Record<DeletionBlockedReason, string> = {
  not_owner: 'That book is not yours to delete.',
  bought_by_others:
    'Other readers have spent credits to have this book sent to them, and what they bought does not expire. It cannot be deleted — ask an administrator to withdraw it from the library instead.',
}

/**
 * The same refusal, said to an administrator.
 *
 * The reader-facing sentence ends by telling them to ask an
 * administrator, which is no help to the administrator reading it.
 */
export const ADMIN_DELETION_ERRORS: Record<DeletionBlockedReason, string> = {
  not_owner: 'Administrators only.',
  bought_by_others:
    'Readers have spent credits to have this book sent to them, and what they bought does not expire. Deleting it would take back something they paid for, so it cannot be deleted — unpublish it instead.',
}
