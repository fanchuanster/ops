import { type RightsStatus, isPubliclyDistributable } from './rights'

export interface LibraryMembership {
  status: string
  owner?: unknown
  review?: { state?: ReviewState | string | null } | null
}

export function isInPublicLibrary(book: LibraryMembership): boolean {
  if (book.status !== 'published') return false
  if (!book.owner) return true
  return book.review?.state === 'approved'
}

export const REVIEW_STATES = ['unsubmitted', 'submitted', 'approved', 'rejected'] as const

export type ReviewState = (typeof REVIEW_STATES)[number]

export const REVIEW_LABELS: Record<ReviewState, string> = {
  unsubmitted: 'Draft',
  submitted: 'Pending',
  approved: 'Approved',
  rejected: 'Changes needed',
}

export const REVIEW_QUEUE_STATES: readonly ReviewState[] = [
  'submitted',
  'rejected',
  'approved',
]

export interface SubmissionRequest {
  reviewState: ReviewState
  rightsStatus: RightsStatus
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

export function canSubmitForReview(request: SubmissionRequest): SubmissionDecision {
  const { reviewState, rightsStatus, hasContent } = request

  if (reviewState === 'submitted') return { allowed: false, reason: 'already_submitted' }
  if (reviewState === 'approved') return { allowed: false, reason: 'already_approved' }
  if (!hasContent) return { allowed: false, reason: 'no_content' }
  if (rightsStatus === 'unknown') return { allowed: false, reason: 'rights_undeclared' }

  return { allowed: true }
}

export interface PublicationRequest {
  reviewState: ReviewState
  rightsStatus: RightsStatus
  byAdmin?: boolean
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

export function canPublishToLibrary(request: PublicationRequest): PublicationDecision {
  const { byAdmin = false, ownedByRequester = false } = request

  if (byAdmin) {
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

export const ADMIN_ONLY_BOOK_FIELDS = [
  'rightsStatus',
  'level',
  'review',
  'collectionOrder',
] as const

export function requiresAdmin(field: string): boolean {
  return (ADMIN_ONLY_BOOK_FIELDS as readonly string[]).includes(field)
}

export interface DeletionRequest {
  isOwner: boolean
  isAdmin: boolean
}

export type DeletionDecision =
  | { allowed: true }
  | { allowed: false; reason: DeletionBlockedReason }

export type DeletionBlockedReason = 'not_owner'

export function canDeleteUpload(request: DeletionRequest): DeletionDecision {
  if (!request.isOwner && !request.isAdmin) return { allowed: false, reason: 'not_owner' }
  return { allowed: true }
}

export const DELETION_ERRORS: Record<DeletionBlockedReason, string> = {
  not_owner: 'That book is not yours to delete.',
}

export const ADMIN_DELETION_ERRORS: Record<DeletionBlockedReason, string> = {
  not_owner: 'Administrators only.',
}
