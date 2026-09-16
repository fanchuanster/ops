'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import {
  COVER_MAX_BYTES,
  checkCoverUpload,
  coverAltFor,
  coverCandidateCount,
} from '../../../domain/cover'
import { isAdmin } from '../../../lib/adminAuth'
import { getCurrentUser } from '../../../lib/auth'
import { logError } from '../../../lib/logError'
import { revalidateCover } from '../../../lib/revalidateCover'

export type CoverPageState = { error?: string; ok?: string }
export type CoverState = { error?: string; ok?: string }

async function dressableBook(
  payload: Awaited<ReturnType<typeof getPayload>>,
  bookId: number,
) {
  const user = await getCurrentUser()
  if (!user) return null

  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!book) return null

  const ownerId = typeof book.owner === 'object' ? book.owner?.id : book.owner
  const mine = Boolean(ownerId) && String(ownerId) === String(user.id)
  return mine || isAdmin(user) ? book : null
}

export async function chooseCoverPage(
  _prev: CoverPageState,
  formData: FormData,
): Promise<CoverPageState> {
  const bookId = Number(formData.get('bookId'))
  const page = Number(formData.get('page'))
  if (!Number.isInteger(bookId)) return { error: 'No book named.' }
  if (!Number.isInteger(page) || page < 1) return { error: 'No page named.' }

  const payload = await getPayload({ config })
  const book = await dressableBook(payload, bookId)
  if (!book) return { error: 'That book is not yours to change.' }

  const generated = book.generatedCover ?? {}
  if (generated.state !== 'ready' || page > coverCandidateCount(generated)) {
    return { error: 'That page has not been rendered.' }
  }

  try {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: { generatedCover: { ...generated, page } },
      overrideAccess: true,
    })
  } catch (error) {
    logError('cover.choosePage', error)
    return { error: 'That cover could not be changed.' }
  }

  revalidateCover(book.slug)
  revalidatePath(`/account/books/${bookId}`)

  return { ok: page === 1 ? 'Using page one.' : `Using page ${page}.` }
}

async function discardIfUnused(
  payload: Awaited<ReturnType<typeof getPayload>>,
  mediaId: number | null,
): Promise<void> {
  if (mediaId === null) return
  try {
    const stillUsed = await payload.find({
      collection: 'books',
      where: { cover: { equals: mediaId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (stillUsed.docs.length > 0) return
    await payload.delete({ collection: 'media', id: mediaId, overrideAccess: true })
  } catch (error) {
    logError('cover.discard', error)
  }
}

export async function saveBookCover(
  _prev: CoverState,
  formData: FormData,
): Promise<CoverState> {
  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'No book named.' }

  const file = formData.get('cover')
  if (!(file instanceof File)) return { error: 'Choose an image.' }

  const check = checkCoverUpload({ size: file.size, type: file.type })
  if (!check.ok) {
    switch (check.problem) {
      case 'empty':
        return { error: 'That file is empty.' }
      case 'wrong_type':
        return { error: 'Covers must be a JPEG, PNG, WebP or GIF image.' }
      case 'too_large':
        return { error: `Covers must be under ${Math.round(COVER_MAX_BYTES / 1024 / 1024)} MB.` }
    }
  }

  const payload = await getPayload({ config })
  const book = await dressableBook(payload, bookId)
  if (!book) return { error: 'That book is not yours to change.' }

  const previous = typeof book.cover === 'number' ? book.cover : null

  try {
    const media = await payload.create({
      collection: 'media',
      data: { alt: coverAltFor(book.title) },
      file: {
        data: Buffer.from(await file.arrayBuffer()),
        mimetype: file.type,
        name: file.name,
        size: file.size,
      },
      overrideAccess: true,
    })

    await payload.update({
      collection: 'books',
      id: bookId,
      data: { cover: media.id },
      overrideAccess: true,
    })

    await discardIfUnused(payload, previous)
  } catch (error) {
    logError('cover.save', error)
    return { error: 'That cover could not be saved.' }
  }

  revalidateCover(book.slug)
  revalidatePath(`/account/books/${bookId}`)
  return { ok: 'Cover updated.' }
}

export async function removeBookCover(
  _prev: CoverState,
  formData: FormData,
): Promise<CoverState> {
  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'No book named.' }

  const payload = await getPayload({ config })
  const book = await dressableBook(payload, bookId)
  if (!book) return { error: 'That book is not yours to change.' }

  const previous = typeof book.cover === 'number' ? book.cover : null

  try {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: { cover: null },
      overrideAccess: true,
    })
    await discardIfUnused(payload, previous)
  } catch (error) {
    logError('cover.remove', error)
    return { error: 'That cover could not be removed.' }
  }

  revalidateCover(book.slug)
  revalidatePath(`/account/books/${bookId}`)
  return { ok: 'Cover removed. A page of the book is showing again.' }
}
