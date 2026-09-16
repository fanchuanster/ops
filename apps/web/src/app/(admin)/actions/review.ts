'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { canPublishToLibrary } from '../../../domain/moderation'
import type { RightsStatus } from '../../../domain/rights'
import { currentAdmin } from '../../../lib/adminAuth'
import { logError } from '../../../lib/logError'

export type ReviewState = { error?: string; ok?: string }

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
      user: admin,
    })
  } catch (error) {
    logError('admin.review.approve', error)
    return { error: 'That decision could not be saved. Try again.' }
  }

  revalidateReview(bookId)
  return { ok: 'Approved — it is in the public library.' }
}

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
  revalidatePath(`/account/books/${bookId}`)
  revalidatePath('/account/books')
  revalidatePath('/')
  revalidatePath('/books')
}
