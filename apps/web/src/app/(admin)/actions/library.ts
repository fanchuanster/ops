'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { coverCandidateKey, coverCandidatePages } from '../../../domain/cover'
import { orderIdFrom } from '../../../domain/shelfOrder'
import { isBookLevel, levelId } from '../../../domain/levels'
import { ADMIN_DELETION_ERRORS, canDeleteUpload } from '../../../domain/moderation'
import { currentAdmin } from '../../../lib/adminAuth'
import { logError } from '../../../lib/logError'
import { deleteObjects } from '../../../lib/storage'

export type LibraryState = { error?: string; ok?: string }

export async function saveBookDetails(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const admin = await currentAdmin()
  if (!admin) return { error: 'Administrators only.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'No book named.' }

  const title = String(formData.get('title') ?? '').trim()
  if (title === '') return { error: 'A book needs a title.' }

  const level = formData.get('level')
  if (!isBookLevel(level)) return { error: 'That is not a level.' }

  const raw = String(formData.get('collectionId') ?? '')
  const collectionId = raw === '' ? null : Number(raw)
  if (collectionId !== null && !Number.isInteger(collectionId)) {
    return { error: 'That is not a collection.' }
  }

  const rawOrder = String(formData.get('collectionOrder') ?? '').trim()
  const collectionOrder = rawOrder === '' ? null : Number(rawOrder)
  if (collectionOrder !== null && !Number.isInteger(collectionOrder)) {
    return { error: 'An order is a whole number.' }
  }

  const optional = (name: string) => {
    const value = String(formData.get(name) ?? '').trim()
    return value === '' ? null : value
  }

  const payload = await getPayload({ config })

  const clash = await payload.find({
    collection: 'books',
    where: { and: [{ title: { equals: title } }, { id: { not_equals: bookId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (clash.docs.length > 0) {
    return { error: `Another book is already called “${title}”. Titles have to be unique.` }
  }

  try {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: {
        title,
        originalTitle: optional('originalTitle'),
        author: optional('author'),
        description: optional('description'),
        level: levelId(level),
        collection: collectionId,
        collectionOrder:
          collectionId === null
            ? null
            : collectionOrder === null
              ? undefined
              : orderIdFrom(collectionOrder),
      },
      overrideAccess: true,
    })
  } catch (error) {
    logError('admin.library.saveBook', error)
    return { error: 'Those changes could not be saved.' }
  }

  revalidateLibrary()
  revalidatePath(`/books/${String(formData.get('slug') ?? '')}`)
  return { ok: 'Saved.' }
}

function revalidateLibrary() {
  revalidatePath('/admin/library')
  revalidatePath('/')
  revalidatePath('/books')
  revalidatePath('/collections')
}

export async function deleteLibraryBook(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const admin = await currentAdmin()
  if (!admin) return { error: ADMIN_DELETION_ERRORS.not_owner }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'No book named.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!book) return { error: 'That book is already gone.' }

  const ownerId = typeof book.owner === 'object' && book.owner ? book.owner.id : book.owner
  const isOwner = Boolean(ownerId && String(ownerId) === String(admin.id))

  const decision = canDeleteUpload({ isOwner, isAdmin: true })
  if (!decision.allowed) return { error: ADMIN_DELETION_ERRORS[decision.reason] }

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
    logError('admin.library.deleteBook', error)
    return { error: 'That book could not be deleted.' }
  }

  await deleteObjects([...keys])

  revalidateLibrary()
  revalidatePath(`/books/${book.slug}`)
  redirect('/admin/library')
}
