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

export type ManageState = { error?: string }

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
    isAdmin: false,
  })
  if (!decision.allowed) return { error: DELETION_ERRORS[decision.reason] }

  const keys = new Set([
    ...(book.artifacts ?? []).map((artifact) => artifact.storageKey),
    book.conversion?.sourceKey,
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
        ...releasedExportHandle(state),
      },
    },
    overrideAccess: true,
  })

  await settleQueuedBook(payload, bookId)

  revalidatePath(`/account/books/${bookId}`)
  revalidatePath('/account/books')
  return {}
}
