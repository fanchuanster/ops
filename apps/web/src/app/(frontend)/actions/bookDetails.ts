'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import {
  type SubmissionBlockedReason,
  canPublishToLibrary,
  canSubmitForReview,
  parseVisibility,
} from '../../../domain/moderation'
import { levelId, parseProposedLevel } from '../../../domain/levels'
import {
  type ConversionState,
  hasMaster,
  isConversionState,
  recoversFromFailure,
  releasedExportHandle,
  retryStateFor,
  stateAfterMasterEdit,
  statusOnQueue,
} from '../../../domain/pipeline'
import { rightsOnOffer, type RightsStatus } from '../../../domain/rights'
import { orderIdFrom } from '../../../domain/shelfOrder'
import { quotaMessage } from '../../../domain/uploadQuota'
import {
  defaultPlanFor,
  needsConverter,
  readPlanChoice,
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

type SignedIn = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>

type Written = { error: string } | { error?: undefined; slugs: string[] }

export async function saveBookDetails(
  _prev: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const written = await writeDetails(user, formData, false)
  if (written.error !== undefined) return { error: written.error }

  const bookId = Number(formData.get('bookId'))
  revalidateDetails(bookId, written.slugs)
  redirect(`/account/books/${bookId}`)
}

export async function submitDraft(
  _prev: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const offered = parseVisibility(formData.get('visibility')) === 'public'
  const written = await writeDetails(user, formData, true)
  if (written.error !== undefined) return { error: written.error }

  const bookId = Number(formData.get('bookId'))
  revalidateDetails(bookId, written.slugs)

  if (offered) await offerToLibrary(user, bookId)
  redirect(`/account/books/${bookId}`)
}

function revalidateDetails(bookId: number, slugs: string[]) {
  revalidatePath('/account/books')
  revalidatePath(`/account/books/${bookId}`)
  if (slugs.length === 0) return
  revalidatePath('/books')
  for (const slug of slugs) revalidatePath(`/books/${slug}`)
}

async function writeDetails(
  user: SignedIn,
  formData: FormData,
  fromDraft: boolean,
): Promise<Written> {
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
  if (fromDraft && book.conversion?.state !== 'draft') {
    return { error: 'This book has already been created. Submit it from its page.' }
  }

  const title = String(formData.get('title') || '').trim()
  if (!title) return { error: 'Give the book a title.' }

  const rawCollection = Number(formData.get('collection'))
  const collectionId = Number.isInteger(rawCollection) && rawCollection > 0 ? rawCollection : null

  const ordersShelves = isAdmin(user)
  const rawOrder = ordersShelves ? String(formData.get('collectionOrder') ?? '').trim() : ''
  const statedOrder = rawOrder === '' ? null : Number(rawOrder)
  if (statedOrder !== null && !Number.isInteger(statedOrder)) {
    return { error: 'An order is a whole number.' }
  }

  const language = String(formData.get('language') || '')

  const reviewState = book.review?.state ?? 'unsubmitted'
  const proposed =
    reviewState === 'unsubmitted' || reviewState === 'rejected'
      ? parseProposedLevel(formData.get('proposedLevel'))
      : null

  const alreadyConverting = book.conversion?.state !== 'draft'

  const sourceKind = readSourceKind(book.conversion ?? {})
  const previousPlan = resolvePlan(sourceKind, book.conversion?.plan)
  const { plan, aiCorrection } = fromDraft
    ? { plan: defaultPlanFor(sourceKind), aiCorrection: false }
    : readPlanChoice(sourceKind, formData.get('planChoice'))

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

  let saved
  try {
    saved = await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        title,
        author: String(formData.get('author') || '').trim() || null,
        ...(language ? { language: language as 'zh-Hant' } : {}),
        collection: collectionId,
        ...(proposed ? { review: { ...book.review, proposedLevel: levelId(proposed) } } : {}),
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
          aiCorrection,
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

  return {
    slugs: saved.slug === book.slug ? [] : [book.slug, saved.slug].filter(Boolean) as string[],
  }
}

export async function submitForReview(
  _prev: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const bookId = Number(formData.get('bookId'))
  const offered = await offerToLibrary(user, bookId)
  if (offered.error) return offered

  if (offered.published) redirect(`/account/books/${bookId}`)
  return {}
}

async function offerToLibrary(
  user: SignedIn,
  bookId: number,
): Promise<DetailsState & { published?: boolean }> {
  if (!Number.isInteger(bookId)) return { error: 'Nothing to submit.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) {
    return { error: 'That book is not yours to submit.' }
  }

  const current = (book.rightsStatus ?? 'unknown') as RightsStatus
  const rightsStatus = rightsOnOffer(current)

  const decision = canSubmitForReview({
    reviewState: book.review?.state ?? 'unsubmitted',
    rightsStatus,
    hasContent: hasMaster(
      isConversionState(book.conversion?.state) ? book.conversion.state : 'none',
    ),
  })
  if (!decision.allowed) return { error: SUBMISSION_ERRORS[decision.reason] }

  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      rightsStatus,
      review: {
        ...book.review,
        state: 'submitted',
        submittedAt: new Date().toISOString(),
      },
    },
    overrideAccess: true,
  })

  let published = false
  if (isAdmin(user)) {
    const publication = canPublishToLibrary({
      reviewState: 'submitted',
      rightsStatus,
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
  revalidatePath('/account/books')
  return { published }
}

const SUBMISSION_ERRORS: Record<SubmissionBlockedReason, string> = {
  already_submitted: 'This book is already waiting to be reviewed.',
  already_approved: 'This book has already been approved.',
  rights_undeclared: 'This book’s rights have not been set.',
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

interface BuildRequest {
  state: ConversionState
  aiCorrection?: boolean
}

async function startBuild(
  formData: FormData,
  requestFor: (hasMasterArtifact: boolean) => BuildRequest,
): Promise<DetailsState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'Nothing to build.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) {
    return { error: 'That book is not yours to convert.' }
  }
  if (!book.conversion?.sourceKey) return { error: 'There is no source file to convert.' }

  const formats = (book.artifacts ?? []).map((artifact) => artifact.format)
  const { state, aiCorrection } = requestFor(formats.includes('docx'))

  const quota = await checkQuotaFor(payload, {
    userId: user.id,
    pagesRequested: book.estimatedPages ?? 0,
    isAdmin: Boolean(user.roles?.includes('admin')),
    excludeBookId: bookId,
  })
  if (!quota.allowed) {
    return { error: quotaMessage(quota) ?? 'You have reached this month’s limit.' }
  }

  try {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        status: statusOnQueue(formats),
        conversion: {
          ...book.conversion,
          state,
          plan: 'convert',
          ...(aiCorrection === undefined ? {} : { aiCorrection }),
          message: null,
          startedAt: new Date().toISOString(),
          ...releasedExportHandle(state),
        },
      },
      overrideAccess: true,
    })
  } catch (error) {
    logError('bookDetails: start build', error)
    return { error: 'Could not start that. Please try again.' }
  }

  await settleQueuedBook(payload, bookId)

  revalidatePath('/account/books')
  revalidatePath(`/account/books/${bookId}`)
  return {}
}

export async function buildMaster(
  _prev: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  return startBuild(formData, () => ({
    state: 'queued',
    aiCorrection: formData.get('aiCorrection') === 'on',
  }))
}

export async function buildEditions(
  _prev: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  return startBuild(formData, (hasMasterArtifact) => ({
    state: retryStateFor({ hasMasterArtifact }),
  }))
}
