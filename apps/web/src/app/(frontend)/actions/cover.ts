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

/**
 * A book's face: which page of itself it wears, and the image an
 * uploaded cover overrides it with.
 *
 * All three actions here answer to the same rule — **the owner or an
 * administrator** — which is why they are one file and not two.
 * Uploading lived in `(admin)/actions/cover.ts` and was administrators
 * only until 2026-08-25. That was the wrong side of the same boundary
 * the page choice already sat on: a cover is not a claim about the
 * book, it is which photograph of it looks right, and the person
 * holding the physical copy is the one who can photograph the cover the
 * publisher actually printed. An uploader who could see their book's
 * face but not change it had the one control that mattered withheld for
 * no reason the design could state.
 *
 * What stays asymmetric is everything that *is* a claim: rights,
 * visibility and level are the administrator's (CLAUDE.md section 6.1).
 */

export type CoverPageState = { error?: string; ok?: string }
export type CoverState = { error?: string; ok?: string }

/**
 * The book, if this reader may change its face — otherwise null.
 *
 * Not found and not yours are the same answer, as everywhere else a
 * book is addressed by id: whether a book exists is not something to
 * leak through a form.
 */
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

/**
 * Which page of itself a book wears.
 *
 * The first few pages of every book are rendered when a cover is made
 * for it, because the page the publisher printed the cover on is
 * frequently not the first leaf a scanner fed — a blank verso, a
 * library stamp, a half-title. This is the choice between them, and
 * page one remains what a book wears until someone makes it.
 *
 * Not a replacement for an uploaded cover, which always wins
 * (`domain/cover.ts`). Choosing a page while such an upload exists is
 * allowed and simply changes what the book would fall back to.
 */
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
  // Against what was actually rendered, not against the ceiling: asking
  // for a page nobody made would leave the book pointing at a key with
  // no object behind it, which is a cover that 404s.
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
  // The owner's own page, which is where this is usually pressed from
  // and is not in the shared set — nothing else in the library links to
  // a private workspace.
  revalidatePath(`/account/books/${bookId}`)

  return { ok: page === 1 ? 'Using page one.' : `Using page ${page}.` }
}

/**
 * Deletes a cover image nothing points at any more.
 *
 * Guarded by a search rather than assumed, even though a cover is only
 * ever attached to the one book it was uploaded for: the REST API could
 * attach one image to two books, and deleting a picture still on
 * another book's page to tidy up after this one would be a bad trade.
 *
 * A failure here is swallowed on purpose. The cover has already been
 * replaced by the time this runs, so the act succeeded; an orphaned
 * image in R2 is a housekeeping cost, not a failed save to report.
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
    logError('cover.discard', error)
  }
}

/**
 * Upload an image and make it the book's cover.
 *
 * Every book already *has* a cover — a page of itself. This is the
 * override, for when no page of the book is the face it should wear: a
 * scan that opens on a library stamp, a title page too faint to read at
 * 150px, or a photograph of the physical jacket that no scan contains.
 *
 * Uploading replaces. The image it replaces is discarded only once the
 * new one is attached, so a failed upload leaves the book with the
 * cover it had rather than with none.
 */
export async function saveBookCover(
  _prev: CoverState,
  formData: FormData,
): Promise<CoverState> {
  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'No book named.' }

  const file = formData.get('cover')
  if (!(file instanceof File)) return { error: 'Choose an image.' }

  // Checked before the book is read, because these answers are about
  // the file the person chose and are worth giving whoever asked.
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

    // Only once the new one is actually attached. Deleting first would
    // leave the book with no cover at all if the upload then failed.
    await discardIfUnused(payload, previous)
  } catch (error) {
    logError('cover.save', error)
    return { error: 'That cover could not be saved.' }
  }

  revalidateCover(book.slug)
  revalidatePath(`/account/books/${bookId}`)
  return { ok: 'Cover updated.' }
}

/**
 * Drop the uploaded image and fall back to a page of the book.
 *
 * Not a way to have no cover: `generatedCover` is deliberately
 * untouched, so a book whose pages were never rendered — because an
 * upload made it ineligible — becomes eligible again the moment this
 * clears, with no state to reset.
 */
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
