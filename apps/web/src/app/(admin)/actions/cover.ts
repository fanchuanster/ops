'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { COVER_MAX_BYTES, checkCoverUpload, coverAltFor } from '../../../domain/cover'
import { currentAdmin } from '../../../lib/adminAuth'
import { logError } from '../../../lib/logError'

/**
 * A book's cover, chosen by an editor.
 *
 * Every book already *has* a cover — page one of itself, rendered by
 * the converter (`domain/cover.ts`). This is the override, and it is
 * the one an editor reaches for when the first page is not the face the
 * book should wear: a scan that opens on a library stamp, or a title
 * page too faint to read at 150px.
 *
 * It lived only in the CMS until 2026-08-24, as an upload field on the
 * Books collection, which meant the cover was the one thing about a
 * book that could not be changed on the screen for changing books. It
 * is a property of the book, so it is edited where the book is edited.
 *
 * Uploading replaces; removing falls back to page one rather than to
 * nothing. That fallback is why the two covers are separate fields and
 * why removing here never touches `generatedCover`.
 */

export type CoverState = { error?: string; ok?: string }

/**
 * The Media document a book's cover points at, if it points at one.
 *
 * `depth: 0` leaves the relationship as an id rather than the populated
 * document, which is all either caller needs and one fewer query.
 */
async function currentCoverId(
  payload: Awaited<ReturnType<typeof getPayload>>,
  bookId: number,
): Promise<number | null> {
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)
  const cover = book?.cover
  return typeof cover === 'number' ? cover : null
}

/**
 * Deletes a cover image nothing points at any more.
 *
 * Guarded by a search rather than assumed, even though this screen only
 * ever attaches an image to the one book it was uploaded for: the CMS
 * could attach one image to two books, and deleting a picture still on
 * another book's page to tidy up after this one would be a bad trade.
 *
 * A failure here is swallowed on purpose. The cover has already been
 * replaced by the time this runs, so the editor's act succeeded; an
 * orphaned image in R2 is a housekeeping cost, not something to report
 * as a failed save.
 */
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
    logError('admin.cover.discard', error)
  }
}

export async function saveBookCover(
  _prev: CoverState,
  formData: FormData,
): Promise<CoverState> {
  const admin = await currentAdmin()
  if (!admin) return { error: 'Administrators only.' }

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

  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!book) return { error: 'No such book.' }

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

    // Only once the new one is actually attached. Deleting first would
    // leave the book with no cover at all if the upload then failed.
    await discardIfUnused(payload, previous)
  } catch (error) {
    logError('admin.cover.save', error)
    return { error: 'That cover could not be saved.' }
  }

  revalidateCover(book.slug)
  return { ok: 'Cover updated.' }
}

export async function removeBookCover(
  _prev: CoverState,
  formData: FormData,
): Promise<CoverState> {
  const admin = await currentAdmin()
  if (!admin) return { error: 'Administrators only.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'No book named.' }

  const payload = await getPayload({ config })
  const previous = await currentCoverId(payload, bookId)

  try {
    await payload.update({
      collection: 'books',
      id: bookId,
      data: { cover: null },
      overrideAccess: true,
    })
    await discardIfUnused(payload, previous)
  } catch (error) {
    logError('admin.cover.remove', error)
    return { error: 'That cover could not be removed.' }
  }

  revalidateCover(String(formData.get('slug') ?? ''))
  // `generatedCover` is deliberately untouched. A book whose page one
  // was never rendered — because an upload made it ineligible — becomes
  // eligible again the moment this clears, with no state to reset.
  return { ok: 'Cover removed. Page one is showing again.' }
}

function revalidateCover(slug: string) {
  revalidatePath('/admin/library')
  revalidatePath('/')
  revalidatePath('/books')
  revalidatePath('/collections')
  if (slug) revalidatePath(`/books/${slug}`)
}
