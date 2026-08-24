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
 * `domain/moderation.ts`) and this is one of the two places it is set.
 * It is never inherited from the uploader's suggestion, however
 * sensible that suggestion was — someone has to type it in, and that is
 * the whole distinction between asking and deciding.
 *
 * One writer for a single book, and it is this one. `setBookLevel` and
 * `setBookCollection` both lived here — a three-button level pill and a
 * shelf select, each saving on click from inside a table row — and both
 * are gone with the merged Library screen. The panel edits a book
 * explicitly; `applyShelfLevel` in `actions/collections.ts` levels a
 * whole subtree at once. Controls that wrote a field on click from a
 * dense list were a third way to change the same thing, under the
 * cursor, with no Save to think twice about.
 */

export type LibraryState = { error?: string; ok?: string }

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

  // Titles are unique (`collections/Books.ts`), and the database is what
  // guarantees it. This is here for the sentence: the constraint surfaces
  // as a raw failed-query message with no reliable marker in it — the
  // adapter does not raise a field-level validation error — so an editor
  // who retypes a title that already exists would otherwise be told
  // "those changes could not be saved" and left to guess which field.
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
  // Level and shelf are both things a reader browsing the catalog sees.
  revalidatePath('/')
  revalidatePath('/books')
  revalidatePath('/collections')
}
