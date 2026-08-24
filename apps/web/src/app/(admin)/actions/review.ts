'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { canPublishToLibrary } from '../../../domain/moderation'
import type { RightsStatus } from '../../../domain/rights'
import { currentAdmin } from '../../../lib/adminAuth'
import { logError } from '../../../lib/logError'

/**
 * An editor's decision on a submitted book.
 *
 * Two outcomes, and only two:
 *
 *   approve()        — this belongs in the library. The book becomes
 *                      public in the same act.
 *   requestChanges() — not yet, and here is why.
 *
 * Approving and publishing were two buttons until 2026-08-24, on the
 * argument that they answer two different questions — "does this belong
 * here" and "may we legally distribute it". The second question is real
 * and is still enforced; what was wrong was making a person answer it
 * twice. There is no such thing as an approved book that stays out of
 * the library: approving one and leaving it private produced a state
 * nobody could explain to its uploader, and an "Approved" chip that
 * meant nothing had happened.
 *
 * So approval *is* publication, and the rights gate moves in front of
 * it rather than behind it: a book whose rights do not permit
 * distribution cannot be approved at all, and the queue says so instead
 * of offering a button that leads nowhere. That is also what the design
 * draws — its Approve control is disabled outright on a submission
 * declared as "owns a copy".
 *
 * What did NOT change is the gate itself. `isPubliclyDistributable` is
 * consulted here, again by `canPublishToLibrary`, and a third time by
 * `enforcePublicationReview` on the write. An approval is not a finding
 * that material may be redistributed, and no amount of administrator
 * gets past it.
 *
 * Every action re-checks the administrator itself. A server action is a
 * POST endpoint; the layout guard around the page never runs for it.
 */

export type ReviewState = { error?: string; ok?: string }

/**
 * Approve a submission, and publish it.
 *
 * The publication check reads the review state **as stored**, not the
 * `approved` this call is about to write. That distinction is the whole
 * of the `not_offered` gate: an administrator may give their approval
 * early, but the uploader offering the book is a different gate and not
 * theirs to walk through. Checking against the value we are writing
 * would make every book look offered.
 */
export async function approveSubmission(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const admin = await currentAdmin()
  if (!admin) return { error: 'Administrators only.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'No book named.' }

  const note = String(formData.get('note') ?? '').trim()

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!book) return { error: 'That book is no longer there.' }

  const ownerId = typeof book.owner === 'object' && book.owner ? book.owner.id : book.owner
  const decision = canPublishToLibrary({
    reviewState: book.review?.state ?? 'unsubmitted',
    rightsStatus: (book.rightsStatus ?? 'unknown') as RightsStatus,
    byAdmin: true,
    ownedByRequester: String(ownerId) === String(admin.id),
  })

  if (!decision.allowed) return { error: APPROVAL_REFUSALS[decision.reason] }

  try {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        review: { state: 'approved', reviewedBy: admin.id, note: note === '' ? null : note },
        visibility: 'public',
      },
      overrideAccess: true,
      // Passed so `enforcePublicationReview` knows whose act this is.
      // Access is overridden either way; this is what identifies the
      // administrator to the hook.
      user: admin,
    })
  } catch (error) {
    logError('admin.review.approve', error)
    return { error: 'That decision could not be saved. Try again.' }
  }

  revalidateReview(bookId)
  return { ok: 'Approved — it is in the public library.' }
}

/**
 * Send it back with a reason.
 *
 * The note is required here and optional on approval, and the asymmetry
 * is the point: an uploader being asked to change something has to be
 * told what, while an approval explains itself by the book appearing.
 *
 * This never touches visibility. A book already in the library that is
 * sent back stays where it is — withdrawing a published book is a
 * different act with different consequences for the readers who have
 * spent credits on it, and it is not something a review note should do
 * as a side effect.
 */
export async function requestChanges(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const admin = await currentAdmin()
  if (!admin) return { error: 'Administrators only.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'No book named.' }

  const note = String(formData.get('note') ?? '').trim()
  if (note === '') {
    return { error: 'Say what needs changing. The uploader only sees what you write here.' }
  }

  const payload = await getPayload({ config })
  try {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: { review: { state: 'rejected', reviewedBy: admin.id, note } },
      overrideAccess: true,
    })
  } catch (error) {
    logError('admin.review.requestChanges', error)
    return { error: 'That decision could not be saved. Try again.' }
  }

  revalidateReview(bookId)
  return { ok: 'Changes requested.' }
}

const APPROVAL_REFUSALS: Record<string, string> = {
  not_submitted: 'It has not been submitted for review.',
  awaiting_review: 'Approve the submission first.',
  rejected: 'Changes were requested. It has to be submitted again.',
  not_offered:
    'Its uploader has not offered it to the library. You can approve a submission early; you cannot make one for somebody else.',
  rights_not_cleared:
    'Its rights do not permit public distribution, and approving now means publishing. Nothing on this screen can clear that — the rights status has to change first.',
}

function revalidateReview(bookId: number) {
  revalidatePath('/admin')
  revalidatePath('/admin/library')
  // The uploader's own screens are where the decision is read.
  revalidatePath(`/account/books/${bookId}`)
  revalidatePath('/account/books')
  // Approving now publishes, so the catalog is what just changed for
  // everybody else.
  revalidatePath('/')
  revalidatePath('/books')
}
