'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { isBookLevel, levelId } from '../../../domain/levels'
import { currentAdmin } from '../../../lib/adminAuth'
import { logError } from '../../../lib/logError'

/**
 * Curating the library: how a book reads, where it sits, and which
 * shelf it is on.
 *
 * The level is an administrator field (`ADMIN_ONLY_BOOK_FIELDS` in
 * `domain/moderation.ts`) and this is the screen it is set from. It is
 * never inherited from the uploader's suggestion, however sensible that
 * suggestion was — someone has to type it in, and that is the whole
 * distinction between asking and deciding.
 *
 * Two ways in, on purpose. `setBookLevel` saves on click from a row,
 * because levelling is comparative and is done by reading down a list;
 * `saveBookDetails` is the panel's explicit Save, where the level is
 * one field among several and nothing should store itself while an
 * editor is still typing.
 *
 * `setBookCollection` lived here until 2026-08-24, saving a shelf from
 * a select in every row. The panel sets the shelf now, alongside the
 * title it usually needs fixing with, and a second control that wrote
 * the same field on change was one more way to flatten a multi-shelf
 * book by brushing past it.
 */

export type LibraryState = { error?: string; ok?: string }

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
 * Everything the Books screen's panel edits, in one write.
 *
 * The screen used to change two things in place — level and shelf — and
 * send an editor to the CMS for the rest, on the argument that a
 * shelf-arranging screen stops being scannable the moment it also edits
 * titles. The list still is scannable; what changed is that the editing
 * happens in a panel beside it rather than in the rows, so the argument
 * no longer applies and the design's panel is adopted as drawn.
 *
 * What is deliberately *not* here is anything the reader-facing rules
 * turn on: rights status, visibility, ownership, review state, the
 * conversion group. Those are not fields an editor tidies while looking
 * at a shelf — rights is a legal finding, visibility now follows
 * approval (`actions/review.ts`), and the rest are the pipeline's. They
 * stay in the CMS, where each has a real form and an audit trail.
 *
 * One write for all of it rather than a save per field: the panel has
 * an explicit Save, so an editor who mistypes a title and moves on has
 * not already stored it.
 */
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

  // Empty means "cleared", not "unchanged" — the panel always posts
  // every field, so a blank box is an instruction. Stored as null
  // rather than as an empty string so the absence reads the same way
  // however it got there.
  const optional = (name: string) => {
    const value = String(formData.get(name) ?? '').trim()
    return value === '' ? null : value
  }

  const payload = await getPayload({ config })
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
        collections: collectionId === null ? [] : [collectionId],
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
  revalidatePath('/admin/books')
  revalidatePath('/admin/collections')
  // Level and shelf are both things a reader browsing the catalog sees.
  revalidatePath('/')
  revalidatePath('/books')
  revalidatePath('/collections')
}
