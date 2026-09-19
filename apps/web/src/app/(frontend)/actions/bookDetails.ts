'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import {
  type SubmissionBlockedReason,
  canPublishToLibrary,
  canSubmitForReview,
} from '../../../domain/moderation'
import { levelId, parseProposedLevel } from '../../../domain/levels'
import {
  type ConversionState,
  hasMaster,
  isConversionState,
  recoversFromFailure,
  releasedExportHandle,
  stateAfterMasterEdit,
  statusOnQueue,
} from '../../../domain/pipeline'
import { isUploaderSelectableRights, type RightsStatus } from '../../../domain/rights'
import { orderIdFrom } from '../../../domain/shelfOrder'
import { renamedSlug } from '../../../domain/slug'
import { quotaMessage } from '../../../domain/uploadQuota'
import {
  needsConverter,
  readSourceKind,
  reopensForConversion,
  resolvePlan,
} from '../../../domain/publication'
import { isAdmin } from '../../../lib/adminAuth'
import { getCurrentUser } from '../../../lib/auth'
import { objectBucket } from '../../../lib/storage'
import { checkQuotaFor } from '../../../lib/uploadQuota'
import { logError } from '../../../lib/logError'
import { settleQueuedBook } from '../../../lib/masterPipeline'

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

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) {
    return { error: 'That book is not yours to edit.' }
  }

  const title = String(formData.get('title') || '').trim()
  if (!title) return { error: 'Give the book a title.' }

  const nextSlug = title === book.title ? null : renamedSlug(book.slug ?? '', title)

  const rightsStatus = String(formData.get('rightsStatus') || '')

  if (rightsStatus && !isUploaderSelectableRights(rightsStatus)) {
    return { error: 'Say where this book came from.' }
  }

  const rawCollection = Number(formData.get('collection'))
  const collectionId = Number.isInteger(rawCollection) && rawCollection > 0 ? rawCollection : null

  const ordersShelves = isAdmin(user)
  const rawOrder = ordersShelves ? String(formData.get('collectionOrder') ?? '').trim() : ''
  const statedOrder = rawOrder === '' ? null : Number(rawOrder)
  if (statedOrder !== null && !Number.isInteger(statedOrder)) {
    return { error: 'An order is a whole number.' }
  }

  const language = String(formData.get('language') || '')

  const alreadyConverting = book.conversion?.state !== 'draft'

  const sourceKind = readSourceKind(book.conversion ?? {})
  const previousPlan = resolvePlan(sourceKind, book.conversion?.plan)
  const plan = resolvePlan(sourceKind, formData.get('plan'))

  const startsConverting =
    alreadyConverting && reopensForConversion(sourceKind, previousPlan, plan)

  const rescuesFromFailure = recoversFromFailure({
    state: isConversionState(book.conversion?.state) ? book.conversion.state : 'none',
    sourceKind,
    plan,
  })

  const staysPut = alreadyConverting && !startsConverting && !rescuesFromFailure
  const nextState: ConversionState = staysPut
    ? isConversionState(book.conversion?.state)
      ? book.conversion.state
      : 'none'
    : 'queued'

  if ((!alreadyConverting || startsConverting) && needsConverter(sourceKind, plan)) {
    const quota = await checkQuotaFor(payload, {
      userId: user.id,
      pagesRequested: book.estimatedPages ?? 0,
      isAdmin: Boolean(user.roles?.includes('admin')),
      excludeBookId: bookId,
    })
    if (!quota.allowed) {
      return { error: quotaMessage(quota) ?? 'You have reached this month’s limit.' }
    }
  }

  try {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        title,
        ...(nextSlug ? { slug: nextSlug } : {}),
        author: String(formData.get('author') || '').trim() || null,
        ...(language ? { language: language as 'zh-Hant' } : {}),
        ...(rightsStatus ? { rightsStatus: rightsStatus as 'user_owned' } : {}),
        collection: collectionId,
        ...(ordersShelves
          ? {
              collectionOrder:
                collectionId === null
                  ? null
                  : statedOrder === null
                    ? undefined
                    : orderIdFrom(statedOrder),
            }
          : {}),
        ...(staysPut
          ? {}
          : { status: statusOnQueue((book.artifacts ?? []).map((a) => a.format)) }),
        conversion: {
          ...book.conversion,
          state: nextState,
          ...releasedExportHandle(nextState),
          plan,
          aiCorrection: formData.get('aiCorrection') === 'on',
          startedAt: startsConverting
            ? new Date().toISOString()
            : (book.conversion?.startedAt ?? new Date().toISOString()),
        },
      },
      overrideAccess: true,
    })
  } catch (error) {
    logError('bookDetails: save details', error)
    return { error: 'Could not save those details. Please try again.' }
  }

  await settleQueuedBook(payload, bookId)

  revalidatePath('/account/books')
  revalidatePath(`/account/books/${bookId}`)
  if (nextSlug) {
    revalidatePath('/books')
    revalidatePath(`/books/${book.slug}`)
    revalidatePath(`/books/${nextSlug}`)
  }
  redirect(`/account/books/${bookId}`)
}

export async function submitForReview(
  _prev: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'Nothing to submit.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) {
    return { error: 'That book is not yours to submit.' }
  }

  const rightsStatus = String(formData.get('rightsStatus') || '')
  if (rightsStatus && !isUploaderSelectableRights(rightsStatus)) {
    return { error: 'Say where this book came from.' }
  }

  if (rightsStatus && rightsStatus !== book.rightsStatus) {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: { rightsStatus: rightsStatus as 'user_owned' },
      overrideAccess: true,
    })
  }

  const decision = canSubmitForReview({
    reviewState: book.review?.state ?? 'unsubmitted',
    rightsStatus: (rightsStatus || book.rightsStatus) as typeof book.rightsStatus,
    hasContent: hasMaster(
      isConversionState(book.conversion?.state) ? book.conversion.state : 'none',
    ),
  })
  if (!decision.allowed) return { error: SUBMISSION_ERRORS[decision.reason] }

  const proposed = parseProposedLevel(formData.get('proposedLevel'))

  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      review: {
        ...book.review,
        state: 'submitted',
        submittedAt: new Date().toISOString(),
        proposedLevel: proposed ? levelId(proposed) : null,
      },
    },
    overrideAccess: true,
  })

  let published = false
  if (isAdmin(user)) {
    const publication = canPublishToLibrary({
      reviewState: 'submitted',
      rightsStatus: (rightsStatus || book.rightsStatus || 'unknown') as RightsStatus,
      byAdmin: true,
      ownedByRequester: true,
    })

    if (publication.allowed) {
      try {
        await payload.update({
          collection: 'books',
          id: bookId,
          data: {
            review: {
              state: 'approved',
              reviewedBy: user.id,
              note: book.review?.note ?? null,
            },
          },
          overrideAccess: true,
          user,
        })
        published = true
        revalidatePath('/')
        revalidatePath('/books')
      } catch (error) {
        logError('bookDetails.submit.publishAsAdmin', error)
      }
    }
  }

  revalidatePath(`/account/books/${bookId}`)

  if (published) {
    revalidatePath('/account/books')
    redirect('/account/books')
  }

  return {}
}

const SUBMISSION_ERRORS: Record<SubmissionBlockedReason, string> = {
  already_submitted: 'This book is already waiting to be reviewed.',
  already_approved: 'This book has already been approved.',
  rights_undeclared:
    'Say where this book came from before submitting it. You are the only person who knows.',
  no_content: 'There is nothing to review yet.',
}

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

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) {
    return { error: 'That book is not yours to edit.' }
  }

  const state = book.conversion?.state
  const next = isConversionState(state) ? stateAfterMasterEdit(state) : null
  if (!next) {
    return { error: 'There is no master to replace yet. Wait for the conversion to finish.' }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  if (bytes.length < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return { error: 'That does not look like a Word document.' }
  }

  const bucket = await objectBucket()
  if (!bucket) return { error: 'Uploads are not available on this server yet.' }

  const storageKey = `books/${bookId}/book/master-${crypto.randomUUID()}.docx`

  try {
    await bucket.put(storageKey, bytes, {
      httpMetadata: {
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    })

    await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        artifacts: [
          ...(book.artifacts ?? []).filter((artifact) => artifact.format !== 'docx'),
          { format: 'docx' as const, storageKey, downloadable: false },
        ],
        conversion: { ...book.conversion, state: next, message: null },
      },
      overrideAccess: true,
    })
  } catch (error) {
    logError('bookDetails: replace master', error)
    return { error: 'Could not replace the master. Please try again.' }
  }

  revalidatePath(`/account/books/${bookId}`)
  return {}
}
