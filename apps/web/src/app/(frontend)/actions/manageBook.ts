'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { coverCandidateKey, coverCandidatePages } from '../../../domain/cover'
import { DELETION_ERRORS, canDeleteUpload } from '../../../domain/moderation'
import { isConversionState, releasedExportHandle, retryStateFor } from '../../../domain/pipeline'
import { canAccessArtifact } from '../../../domain/rights'
import { getCurrentUser } from '../../../lib/auth'
import { settleQueuedBook } from '../../../lib/masterPipeline'
import { deleteObjects } from '../../../lib/storage'
import { logError } from '../../../lib/logError'

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

  const decision = canDeleteUpload({
    isOwner,
    // Not the admin path: this action answers the reader's own screen,
    // and an administrator deleting somebody else's book does it from
    // `/admin/library`, where the refusals are worded for them.
    isAdmin: false,
  })
  if (!decision.allowed) return { error: DELETION_ERRORS[decision.reason] }

  // Gathered before the row goes, since afterwards there is nothing to
  // read the keys from.
  const keys = new Set([
    ...(book.artifacts ?? []).map((artifact) => artifact.storageKey),
    book.conversion?.sourceKey,
    // Not artifacts, but under the book's prefix and outliving the row
    // exactly as they would (`domain/cover.ts`). Every rendered
    // candidate, not only the one the book wears — the stored key names
    // the chosen page, and the pages not chosen are objects too.
    book.generatedCover?.key,
    ...coverCandidatePages(book.generatedCover ?? {}).map((page) =>
      coverCandidateKey(book.generatedCover?.key ?? '', page),
    ),
  ].filter((key): key is string => typeof key === 'string' && key.length > 0))

  try {
    await payload.delete({ collection: 'books', id: bookId, overrideAccess: true })
  } catch (error) {
    logError('manageBook: delete book', error)
    return { error: 'Could not delete that book. Please try again.' }
  }

  await deleteObjects([...keys])

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
 *
 * For a book that needs no converter at all — published as it stands —
 * "the queue" is this request: `settleQueuedBook` files the original and
 * finishes the book before the action returns, so Try again does not
 * mean waiting for a worker that has nothing to do. For a book that does
 * need one, the same call still files the original, so the book is
 * readable while it waits its turn.
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

  const state = retryStateFor({ hasMasterArtifact })

  await payload.update({
    collection: 'books',
    id: bookId,
    data: {
      conversion: {
        ...book.conversion,
        state,
        message: null,
        // The handle from the export that failed, which the spread above
        // would otherwise carry into the new attempt — where
        // `needsMasterRun` reads it as a job already running and never
        // starts one. Try again meant nothing at all for exactly the
        // books it exists for (`releasedExportHandle`).
        ...releasedExportHandle(state),
      },
    },
    overrideAccess: true,
  })

  // Same call the details form makes: it files the original so the book
  // is readable while it waits, and finishes it outright when there is
  // nothing to convert. It never throws, and a book it declines to
  // settle is still queued for the pipeline tick.
  await settleQueuedBook(payload, bookId)

  revalidatePath(`/account/books/${bookId}`)
  revalidatePath('/account/books')
  return {}
}
