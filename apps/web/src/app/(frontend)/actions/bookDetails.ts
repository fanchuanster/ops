'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import {
  type SubmissionBlockedReason,
  canSubmitForReview,
} from '../../../domain/moderation'
import { isUploaderSelectableRights } from '../../../domain/rights'
import { quotaMessage } from '../../../domain/uploadQuota'
import { getCurrentUser } from '../../../lib/auth'
import { objectBucket } from '../../../lib/storage'
import { checkQuotaFor } from '../../../lib/uploadQuota'

/**
 * Confirming the details of an uploaded book.
 *
 * Everything on this form was suggested by reading the file; this is
 * where the reader corrects it. The fields they may set are exactly the
 * bibliographic ones — what the book *is*. Visibility, reading level
 * and the review outcome are administrator fields (CLAUDE.md section
 * 6.1) and are not in this form, because an uploader who could set them
 * would walk their upload into the front of the library.
 *
 * Two ways out, and the difference is only whether the reader is asking
 * for the book to be published:
 *
 *   - **Convert** — the book stays private to them, forever if they
 *     like. This is the normal case and needs nobody's approval.
 *   - **Convert and submit for review** — the same, plus a request that
 *     an administrator consider it for the public library. Blocked when
 *     the rights are `unknown`, because that question is the uploader's
 *     to answer and nobody downstream can answer it for them.
 */

export type DetailsState = { error?: string }

export async function saveBookDetails(
  _prev: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'Nothing to save.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  // Not found and not yours are the same answer. Whether a book exists
  // is not something to leak through an edit form.
  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) {
    return { error: 'That book is not yours to edit.' }
  }

  const title = String(formData.get('title') || '').trim()
  if (!title) return { error: 'Give the book a title.' }

  const rightsStatus = String(formData.get('rightsStatus') || '')
  const submit = String(formData.get('intent') || '') === 'submit'

  // Rights may be left unanswered while a book is a draft — but not
  // while asking for it to be published.
  if (rightsStatus && !isUploaderSelectableRights(rightsStatus)) {
    return { error: 'Say where this book came from.' }
  }
  if (submit && !rightsStatus) {
    return {
      error:
        'Say where this book came from before submitting it. You are the only person who knows.',
    }
  }

  const collectionIds = formData
    .getAll('collections')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)

  const language = String(formData.get('language') || '')

  if (submit) {
    // The domain decides whether a submission is even possible; this
    // action only supplies the state and acts on the answer.
    const decision = canSubmitForReview({
      reviewState: book.review?.state ?? 'unsubmitted',
      rightsStatus: rightsStatus as 'user_owned',
      // There is always a source file — an upload cannot exist without
      // one — and the generated formats do not need to exist yet.
      hasContent: true,
    })
    if (!decision.allowed) return { error: SUBMISSION_ERRORS[decision.reason] }
  }

  // The monthly conversion allowance, checked at the moment conversion
  // would start rather than at upload — a draft costs nothing, and
  // refusing an upload for drafts the reader may never convert would
  // charge them for a decision they have not made.
  //
  // Only for a book that has not already been through the pipeline: a
  // reader correcting the details of a converted book is not asking for
  // it to be converted again.
  const alreadyConverting = book.conversion?.state !== 'draft'
  if (!alreadyConverting) {
    const quota = await checkQuotaFor(payload, {
      userId: user.id,
      pagesRequested: book.estimatedPages ?? 0,
      isAdmin: Boolean(user.roles?.includes('admin')),
    })
    if (!quota.allowed) {
      // The draft survives, deliberately. The book is not the problem;
      // the month is.
      return { error: quotaMessage(quota) ?? 'You have reached this month’s limit.' }
    }
  }

  try {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        title,
        author: String(formData.get('author') || '').trim() || null,
        translator: String(formData.get('translator') || '').trim() || null,
        originalTitle: String(formData.get('originalTitle') || '').trim() || null,
        description: String(formData.get('description') || '').trim() || null,
        ...(language ? { language: language as 'zh-Hant' } : {}),
        ...(rightsStatus ? { rightsStatus: rightsStatus as 'user_owned' } : {}),
        collections: collectionIds,
        status: 'in_production',
        // Queued either way. A reader who is not asking for publication
        // still wants their EPUB.
        conversion: {
          ...book.conversion,
          state: alreadyConverting ? book.conversion?.state : 'queued',
          // Stamped once, when the book first enters the pipeline. This
          // is what the monthly count is scoped by.
          startedAt: book.conversion?.startedAt ?? new Date().toISOString(),
        },
        ...(submit
          ? { review: { ...book.review, state: 'submitted', submittedAt: new Date().toISOString() } }
          : {}),
      },
      overrideAccess: true,
    })
  } catch {
    return { error: 'Could not save those details. Please try again.' }
  }

  revalidatePath('/account/books')
  redirect('/account/books')
}

/** What a blocked submission should tell the uploader. */
const SUBMISSION_ERRORS: Record<SubmissionBlockedReason, string> = {
  already_submitted: 'This book is already waiting to be reviewed.',
  already_approved: 'This book has already been approved.',
  rights_undeclared:
    'Say where this book came from before submitting it. You are the only person who knows.',
  no_content: 'There is nothing to review yet.',
}

/**
 * Replace the DOCX master with an edited one.
 *
 * The other half of what makes a draft a workspace. A conversion from a
 * scan is a first pass — the uploader is the one who can see what the
 * OCR misread — so they download the master, fix it, and send it back.
 *
 * The replacement becomes the new source and the book re-enters
 * conversion, which regenerates the EPUB and the PDFs from it. It does
 * *not* cost another slot against the monthly quota: this is the same
 * book being corrected, and charging for a correction would discourage
 * exactly the proofreading this project exists to do.
 */
export async function replaceMaster(
  _prev: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'Nothing to replace.' }

  const file = formData.get('master')
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a DOCX to upload.' }
  if (file.type !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return { error: 'The master has to be a DOCX.' }
  }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) {
    return { error: 'That book is not yours to edit.' }
  }

  const bucket = await objectBucket()
  if (!bucket) return { error: 'Uploads are not available on this server yet.' }

  // A new key rather than overwriting the old one, so a replacement that
  // turns out worse than the original has not destroyed it.
  const jobId = crypto.randomUUID()
  const sourceKey = `conversion/${jobId}/input/source.docx`
  try {
    await bucket.put(sourceKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    })
    await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        conversion: {
          ...book.conversion,
          state: 'queued',
          sourceKey,
          sourceFilename: file.name,
          jobId,
          message: null,
        },
      },
      overrideAccess: true,
    })
  } catch {
    return { error: 'Could not replace the master. Please try again.' }
  }

  revalidatePath(`/account/books/${bookId}`)
  return {}
}
