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
 * Two acts, kept apart on purpose, because `CLAUDE.md` section 6.1
 * says they are two gates and not one:
 *
 *   decide()   — approve the submission, or ask for changes. This is
 *                the editorial judgement: does this belong here.
 *   publish()  — put it in the public library. This is the *legal*
 *                question, and it consults the rights status.
 *
 * Collapsing them into one button would be the exact mistake the
 * collection hook exists to catch: an approval is not a finding that
 * the material is distributable, and an editor who is offered a single
 * "Approve and publish" is being invited to make a finding they never
 * examined. So approving an unclearable book is allowed and does
 * nothing dangerous — it just never grows a Publish button.
 *
 * Every action re-checks the administrator itself. A server action is a
 * POST endpoint; the layout guard around the page never runs for it.
 */

export type ReviewState = { error?: string; ok?: string }

type Decision = 'approved' | 'rejected'

async function decide(
  formData: FormData,
  state: Decision,
  requireNote: boolean,
): Promise<ReviewState> {
  const admin = await currentAdmin()
  if (!admin) return { error: 'Administrators only.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'No book named.' }

  const note = String(formData.get('note') ?? '').trim()

  // A rejection without a reason is not a review — the uploader is
  // being asked to change something and has not been told what. An
  // approval needs no words; the book appearing is the message.
  if (requireNote && note === '') {
    return { error: 'Say what needs changing. The uploader only sees what you write here.' }
  }

  const payload = await getPayload({ config })

  try {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        review: {
          state,
          reviewedBy: admin.id,
          note: note === '' ? null : note,
        },
      },
      overrideAccess: true,
    })
  } catch (error) {
    logError('admin.review.decide', error)
    return { error: 'That decision could not be saved. Try again.' }
  }

  revalidateReview(bookId)
  return { ok: state === 'approved' ? 'Approved.' : 'Changes requested.' }
}

export async function approveSubmission(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  return decide(formData, 'approved', false)
}

export async function requestChanges(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  return decide(formData, 'rejected', true)
}

/**
 * Put an approved book into the public library.
 *
 * The gate is checked here *and* again by `enforcePublicationReview` on
 * the write itself. That is deliberate duplication: this call answers
 * with a sentence a person can read, and the hook is what makes the
 * rule true for every writer, including the CMS and a future script
 * that has never heard of this file.
 *
 */
export async function publishToLibrary(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const admin = await currentAdmin()
  if (!admin) return { error: 'Administrators only.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'No book named.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!book) return { error: 'That book is no longer there.' }

  const decision = canPublishToLibrary({
    reviewState: book.review?.state ?? 'unsubmitted',
    rightsStatus: (book.rightsStatus ?? 'unknown') as RightsStatus,
  })

  if (!decision.allowed) {
    return { error: PUBLISH_REFUSALS[decision.reason] }
  }

  try {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: { visibility: 'public' },
      overrideAccess: true,
    })
  } catch (error) {
    logError('admin.review.publish', error)
    return { error: 'That book could not be published. Try again.' }
  }

  revalidateReview(bookId)
  // The catalog is what just changed for everybody else.
  revalidatePath('/')
  revalidatePath('/books')
  return { ok: 'It is in the public library.' }
}

const PUBLISH_REFUSALS: Record<string, string> = {
  not_submitted: 'It has not been submitted for review.',
  awaiting_review: 'Approve the submission first.',
  rejected: 'Changes were requested. It has to be submitted again.',
  rights_not_cleared:
    'Its rights do not permit public distribution. Approval says a book belongs in the library; it does not clear the rights, and nothing here can.',
}

function revalidateReview(bookId: number) {
  revalidatePath('/admin')
  revalidatePath('/admin/books')
  // The uploader's own screens are where the decision is read.
  revalidatePath(`/account/books/${bookId}`)
  revalidatePath('/account/books')
}
