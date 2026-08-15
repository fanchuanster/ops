'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { DELETION_ERRORS, canDeleteUpload } from '../../../domain/moderation'
import {
  awaitingReview,
  isConversionState,
  isOnDemandFormat,
  retryStateFor,
} from '../../../domain/pipeline'
import { canAccessArtifact } from '../../../domain/rights'
import { getCurrentUser } from '../../../lib/auth'
import { deleteObjects } from '../../../lib/storage'

/**
 * Managing your own uploads: deleting one, and retrying a conversion
 * that failed.
 *
 * Both check ownership against the session, and both answer "not yours"
 * and "not there" identically — whether a book exists is not something
 * to leak through a form.
 */

export type ManageState = { error?: string }

/**
 * Delete an upload and the files behind it.
 *
 * The row goes first and the objects after. That ordering is on
 * purpose: if the object deletion fails the reader still gets what they
 * asked for and we are left with a few unreferenced files, whereas the
 * reverse order can leave a book in the catalog whose content has been
 * destroyed — a listing that 404s when opened.
 */
export async function deleteBook(_prev: ManageState, formData: FormData): Promise<ManageState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'Nothing to delete.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  const isOwner = Boolean(book && ownerId && String(ownerId) === String(user.id))
  if (!book || !isOwner) return { error: DELETION_ERRORS.not_owner }

  // Anyone but the uploader holding an entitlement means someone paid
  // credits for this book, and what they bought does not expire.
  const bought = await payload.find({
    collection: 'entitlements',
    where: { and: [{ book: { equals: bookId } }, { user: { not_equals: user.id } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const decision = canDeleteUpload({
    isOwner,
    boughtByOthers: bought.docs.length > 0,
    isPublic: book.visibility === 'public',
  })
  if (!decision.allowed) return { error: DELETION_ERRORS[decision.reason] }

  // Gathered before the row goes, since afterwards there is nothing to
  // read the keys from.
  const keys = [
    ...(book.artifacts ?? []).map((artifact) => artifact.storageKey),
    book.conversion?.sourceKey,
  ].filter((key): key is string => typeof key === 'string' && key.length > 0)

  try {
    await payload.delete({ collection: 'books', id: bookId, overrideAccess: true })
  } catch {
    return { error: 'Could not delete that book. Please try again.' }
  }

  await deleteObjects(keys)

  revalidatePath('/account/books')
  redirect('/account/books')
}

/**
 * Put a failed conversion back in the queue.
 *
 * The source file is still there — a failure does not discard it — so
 * this needs nothing from the reader. It does not spend another of
 * their monthly conversions: the first attempt already did, and
 * charging twice for our own failure would be wrong.
 */
export async function retryConversion(
  _prev: ManageState,
  formData: FormData,
): Promise<ManageState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'Nothing to retry.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) {
    return { error: 'That book is not yours.' }
  }
  if (!book.conversion?.sourceKey) {
    return { error: 'There is no source file to convert.' }
  }

  // A book with a master got past phase 1, so whatever failed was the
  // format generation. Restarting it from the beginning would ask
  // Google to read pages we have already paid to read, and rebuild a
  // master that is already sitting in storage.
  const hasMasterArtifact = (book.artifacts ?? []).some((artifact) => artifact.format === 'docx')

  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      conversion: {
        ...book.conversion,
        state: retryStateFor({ hasMasterArtifact }),
        message: null,
      },
    },
    overrideAccess: true,
  })

  revalidatePath(`/account/books/${bookId}`)
  revalidatePath('/account/books')
  return {}
}

/**
 * Ask for a PDF variant to be rendered.
 *
 * Phase 2 builds the EPUB on release and nothing else. The three PDF
 * sizes are three renderings of the same book, and rendering all of
 * them for every book spent the slowest stage in the pipeline on files
 * most readers never open. So a reader picks the typography they want
 * and that one is built.
 *
 * The request is recorded on the book and the book is sent back to
 * `master_ready`, where the converter's next poll finds it. Nothing is
 * generated inline: this is a Worker, and WeasyPrint is not.
 *
 * Gated by `canAccessArtifact` — the same rule that will decide whether
 * this reader may have the file once it exists. Building something for
 * someone who could never be given it is work done for nobody, and the
 * check is cheap.
 */
export async function requestFormat(_prev: ManageState, formData: FormData): Promise<ManageState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const bookId = Number(formData.get('bookId'))
  const format = formData.get('format')
  if (!Number.isInteger(bookId)) return { error: 'Nothing to build.' }
  if (!isOnDemandFormat(format)) return { error: 'That is not a format we make on request.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!book) return { error: 'No such book.' }

  const ownerId = typeof book.owner === 'object' ? book.owner?.id : book.owner

  const access = canAccessArtifact({
    book: { rightsStatus: book.rightsStatus, visibility: book.visibility },
    userId: String(user.id),
    ownerId: ownerId === undefined || ownerId === null ? null : String(ownerId),
  })
  // Deliberately the same answer as "no such book": whether a book
  // exists is not something to leak through a build request.
  if (!access.allowed) return { error: 'No such book.' }

  // Already there. Not an error — the reader wanted the file and the
  // file is available, which is the outcome they were asking for.
  if ((book.artifacts ?? []).some((artifact) => artifact.format === format)) return {}

  const conversion = (book.conversion ?? {}) as Record<string, unknown>
  const state = isConversionState(conversion.state) ? conversion.state : 'none'

  if (
    awaitingReview({
      state,
      hasOwner: Boolean(book.owner),
      reviewState: book.review?.state ?? 'unsubmitted',
    })
  ) {
    return { error: 'This book is still waiting to be reviewed. Its formats are built after that.' }
  }

  // Only from a resting state. A request arriving mid-build would be
  // cleared by the completion that is already in flight, and would
  // vanish without ever being built.
  if (state !== 'ready' && state !== 'master_ready') {
    return { error: 'This book is busy. Try again in a few minutes.' }
  }

  const pending = Array.isArray(conversion.pendingFormats)
    ? (conversion.pendingFormats as unknown[]).filter(isOnDemandFormat)
    : []

  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      conversion: {
        ...conversion,
        // Back to the hinge. `master_ready` is where phase 2 is claimed
        // from, and re-entering it is exactly what a master edit does —
        // this is the same rebuild with a narrower list.
        state: 'master_ready',
        pendingFormats: [...new Set([...pending, format])],
      },
    },
    overrideAccess: true,
  })

  revalidatePath(`/books/${book.slug}`)
  revalidatePath(`/account/books/${bookId}`)
  return {}
}
