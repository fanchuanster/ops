'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { isBookLevel, levelId } from '../../../domain/levels'
import { currentAdmin } from '../../../lib/adminAuth'
import { logError } from '../../../lib/logError'

/**
 * Curating the library: where a book sits, and which shelf it is on.
 *
 * Both are administrator fields (`ADMIN_ONLY_BOOK_FIELDS` in
 * `domain/moderation.ts`) and this is the screen they are set from. The
 * level in particular is never inherited from the uploader's
 * suggestion, however sensible that suggestion was — someone has to
 * type it in, and that is the whole distinction between asking and
 * deciding.
 */

export type LibraryState = { error?: string }

/**
 * Move a book to a different reading level.
 *
 * The name comes in, the id goes to the database. Nothing anywhere
 * compares level names, because names have no order — `domain/levels.ts`
 * owns the table that does.
 */
export async function setBookLevel(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const admin = await currentAdmin()
  if (!admin) return { error: 'Administrators only.' }

  const bookId = Number(formData.get('bookId'))
  const level = formData.get('level')
  if (!Number.isInteger(bookId)) return { error: 'No book named.' }
  if (!isBookLevel(level)) return { error: 'That is not a level.' }

  const payload = await getPayload({ config })
  try {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: { level: levelId(level) },
      overrideAccess: true,
    })
  } catch (error) {
    logError('admin.library.setLevel', error)
    return { error: 'That level could not be saved.' }
  }

  revalidateLibrary()
  return {}
}

/**
 * Put a book on a shelf, or take it off every shelf.
 *
 * One collection at a time, which is what the design's select offers
 * and less than the data model allows — `collections` is `hasMany`. A
 * book can still belong to several through the CMS; this control
 * replaces the whole list rather than appending to it, so an editor
 * using it on a multi-shelf book would flatten it to one. That is why
 * the screen shows the current value in the control: the select says
 * what it is about to become, not what it will add.
 */
export async function setBookCollection(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const admin = await currentAdmin()
  if (!admin) return { error: 'Administrators only.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'No book named.' }

  const raw = String(formData.get('collectionId') ?? '')
  // An empty value is a real instruction — "no shelf" — and not a
  // missing one, so it clears rather than being ignored.
  const collectionId = raw === '' ? null : Number(raw)
  if (collectionId !== null && !Number.isInteger(collectionId)) {
    return { error: 'That is not a collection.' }
  }

  const payload = await getPayload({ config })
  try {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: { collections: collectionId === null ? [] : [collectionId] },
      overrideAccess: true,
    })
  } catch (error) {
    logError('admin.library.setCollection', error)
    return { error: 'That collection could not be saved.' }
  }

  revalidateLibrary()
  return {}
}

function revalidateLibrary() {
  revalidatePath('/admin/books')
  revalidatePath('/admin/collections')
  // Level and shelf are both things a reader browsing the catalog sees.
  revalidatePath('/')
  revalidatePath('/books')
  revalidatePath('/collections')
}
