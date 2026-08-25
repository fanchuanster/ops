'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { coverCandidatePages, coverKey } from '../../../domain/cover'
import { UNPLACED_ORDER_ID, orderIdFrom } from '../../../domain/shelfOrder'
import { isBookLevel, levelId } from '../../../domain/levels'
import { ADMIN_DELETION_ERRORS, canDeleteUpload } from '../../../domain/moderation'
import { currentAdmin } from '../../../lib/adminAuth'
import { logError } from '../../../lib/logError'
import { deleteObjects } from '../../../lib/storage'

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

  // Where the book sits among the books on that shelf. Blank means the
  // editor said nothing about the order — not zero, and not "back to
  // the end" — so the book keeps the number it has. A book moving to
  // another shelf and given no number lands at the end of the new one,
  // which is the collection hook's doing rather than this screen's.
  const rawOrder = String(formData.get('collectionOrder') ?? '').trim()
  const collectionOrder = rawOrder === '' ? null : Number(rawOrder)
  if (collectionOrder !== null && !Number.isInteger(collectionOrder)) {
    return { error: 'An order is a whole number.' }
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
        // Written with the shelf rather than after it, since 2026-08-25.
        // It used to be a second pass because the number had to be made
        // unique — whatever stood at it was shifted along — and that
        // shift had to happen against the shelf the book was on *now*.
        // Numbers may repeat now, so a place is one field on one row
        // and there is nothing to sequence.
        //
        // Null means the editor cleared the box: back of the shelf,
        // where everything nobody has placed reads alphabetically
        // (`domain/shelfOrder.ts`). The hook only fills in a number for
        // a book that has just arrived, so it would leave a cleared one
        // alone.
        collectionOrder:
          collectionId === null
            ? null
            : collectionOrder === null
              ? UNPLACED_ORDER_ID
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
  // Level and shelf are both things a reader browsing the catalog sees.
  revalidatePath('/')
  revalidatePath('/books')
  revalidatePath('/collections')
}

/**
 * Delete a book, and the files behind it.
 *
 * The library's own withdrawal. `canDeleteUpload` decides it, the same
 * function the reader's own delete goes through — an administrator is
 * excused the ownership gate and is not excused the entitlement one,
 * because that gate protects a reader who paid rather than the
 * uploader.
 *
 * Everything else mirrors `actions/manageBook.ts` deliberately: the
 * keys are read before the row goes, since afterwards there is nothing
 * left to read them from, and the row goes before the objects. A failed
 * object delete leaves a few unreferenced files; the other order can
 * leave a book in the catalog whose content has been destroyed.
 */
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

  // Anyone other than the uploader holding an entitlement means credits
  // were spent on this book. An administrator deleting their own upload
  // is asked the same question as any other uploader, which is why the
  // owner is excluded from the query rather than the whole ledger being
  // counted.
  const bought = await payload.find({
    collection: 'entitlements',
    where: ownerId
      ? { and: [{ book: { equals: bookId } }, { user: { not_equals: ownerId } }] }
      : { book: { equals: bookId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const decision = canDeleteUpload({
    isOwner,
    isAdmin: true,
    boughtByOthers: bought.docs.length > 0,
    isPublic: book.visibility === 'public',
  })
  if (!decision.allowed) return { error: ADMIN_DELETION_ERRORS[decision.reason] }

  // A Set because the chosen candidate is named twice — once as the
  // stored key, once as page N of the render.
  const keys = new Set([
    ...(book.artifacts ?? []).map((artifact) => artifact.storageKey),
    book.conversion?.sourceKey,
    // Not artifacts, but under the book's prefix and outliving the row
    // exactly as they would (`domain/cover.ts`). Every rendered
    // candidate goes, not only the one the book wears: they are all
    // real objects, and the stored `key` names just the chosen one.
    book.generatedCover?.key,
    ...coverCandidatePages(book.generatedCover ?? {}).map((page) => coverKey(book.id, page)),
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
  // Back to the library with nothing selected: the panel's `?book=`
  // now names a book that does not exist, and leaving it there would
  // reopen a panel over an empty read.
  redirect('/admin/library')
}
