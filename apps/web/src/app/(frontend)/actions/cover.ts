'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { coverCandidateCount } from '../../../domain/cover'
import { isAdmin } from '../../../lib/adminAuth'
import { getCurrentUser } from '../../../lib/auth'
import { logError } from '../../../lib/logError'
import { revalidateCover } from '../../../lib/revalidateCover'

/**
 * Which page of itself a book wears.
 *
 * The converter renders the first few pages of every book it makes a
 * cover for, because the page the publisher printed the cover on is
 * frequently not the first leaf a scanner fed — a blank verso, a
 * library stamp, a half-title. This is the choice between them, and
 * page one remains what a book wears until someone makes it.
 *
 * **The owner or an administrator**, which is the one place a book's
 * uploader and its editors have the same power over it. Everything else
 * on that boundary is asymmetric — rights, visibility and level are the
 * administrator's (CLAUDE.md section 6.1), the bibliographic fields are
 * the uploader's. A cover is neither: it is not a claim about the book,
 * it is which photograph of it looks right, and the person who has the
 * physical book open is at least as well placed to say.
 *
 * Not a replacement for an uploaded cover, which is an editor's own
 * image and always wins (`domain/cover.ts`). Choosing a page while such
 * an upload exists is allowed and simply changes what the book would
 * fall back to.
 */

export type CoverPageState = { error?: string; ok?: string }

export async function chooseCoverPage(
  _prev: CoverPageState,
  formData: FormData,
): Promise<CoverPageState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const bookId = Number(formData.get('bookId'))
  const page = Number(formData.get('page'))
  if (!Number.isInteger(bookId)) return { error: 'No book named.' }
  if (!Number.isInteger(page) || page < 1) return { error: 'No page named.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  // Not found and not yours are the same answer, as everywhere else a
  // book is addressed by id.
  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  const mine = Boolean(ownerId) && String(ownerId) === String(user.id)
  if (!book || (!mine && !isAdmin(user))) {
    return { error: 'That book is not yours to change.' }
  }

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
