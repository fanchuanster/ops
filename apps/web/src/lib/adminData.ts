import config from '@payload-config'
import { getPayload } from 'payload'

import { REVIEW_QUEUE_STATES, type ReviewState } from '../domain/moderation'
import type { Book, BookCollection, User } from '../payload-types'

/**
 * Reads for the editorial admin.
 *
 * Every query here runs with `overrideAccess: true`, which is the one
 * thing that makes this module dangerous and the reason it is a module
 * rather than inline queries: nothing in it may be called from a page
 * that has not already passed `requireAdmin`. Collected in one file so
 * that rule has one place to be checked rather than fifteen.
 *
 * The admin is deliberately allowed to see private uploads — reviewing
 * a submission means reading a book that is, by definition, not public
 * yet. `readBooks` in `collections/Books.ts` grants an administrator
 * exactly that, so these overrides are a shortcut past a rule that
 * would have said yes, not a way around one that would have said no.
 */

/** How many rows any one admin screen will load. Bounded on purpose. */
const PAGE_LIMIT = 200

export interface QueueFilter {
  /** Null means every state that has ever been submitted. */
  state: ReviewState | null
}

/**
 * Books that have been submitted for the public library.
 *
 * `unsubmitted` is excluded whatever the filter says. A draft nobody
 * has offered is not a queue item — it is somebody's private
 * workspace, and putting it in front of a reviewer would both waste
 * their time and quietly turn "you may keep this private forever" into
 * "we are looking at it anyway".
 */
export async function getReviewQueue({ state }: QueueFilter) {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'books',
    where: {
      'review.state': { in: state ? [state] : [...REVIEW_QUEUE_STATES] },
    },
    // Newest submission first: the queue is worked from the top and a
    // book that has waited longest is the one at the bottom.
    sort: '-review.submittedAt',
    limit: PAGE_LIMIT,
    // The owner is who submitted it, and the queue names them.
    depth: 1,
    overrideAccess: true,
  })
  return result.docs
}

/** How many submissions are actually waiting on a decision. */
export async function countAwaitingReview(): Promise<number> {
  const payload = await getPayload({ config })
  const result = await payload.count({
    collection: 'books',
    where: { 'review.state': { equals: 'submitted' } },
    overrideAccess: true,
  })
  return result.totalDocs
}

/**
 * One book, whole, for a detail panel.
 *
 * Shared by the review queue and the Books screen — they show different
 * things about it, but neither wants a different read. `depth: 1` so
 * the owner and the collections arrive populated; `catch` rather than
 * a throw because a stale `?book=` in somebody's URL should close the
 * panel, not break the page around it.
 */
export async function getAdminBook(id: number): Promise<Book | null> {
  const payload = await getPayload({ config })
  return payload
    .findByID({ collection: 'books', id, depth: 1, overrideAccess: true })
    .catch(() => null)
}

export interface LibraryFilter {
  /** Free text over title, original title and author. */
  query: string
  /** A collection id, or null for all of them. */
  collectionId: number | null
}

/**
 * The whole library, as an editor sees it.
 *
 * Every book, public and private, published and draft — this is the
 * screen for finding one and changing where it sits, so hiding any of
 * them would only mean the editor goes to the CMS instead.
 */
export async function getLibrary({ query, collectionId }: LibraryFilter) {
  const payload = await getPayload({ config })
  const filters = []

  if (query) {
    filters.push({
      or: [
        { title: { like: query } },
        { originalTitle: { like: query } },
        { author: { like: query } },
      ],
    })
  }
  if (collectionId !== null) filters.push({ collections: { equals: collectionId } })

  const result = await payload.find({
    collection: 'books',
    where: filters.length > 0 ? { and: filters } : {},
    sort: 'title',
    limit: PAGE_LIMIT,
    depth: 1,
    overrideAccess: true,
  })
  return result.docs
}

/**
 * How many times each of these books has actually been sent to a
 * device, keyed by book id.
 *
 * One query for the whole page rather than a count per row: the books
 * on screen are already bounded by `PAGE_LIMIT`, so this is a single
 * `in` over an indexed column instead of two hundred round trips to
 * D1 — which on a Worker is the difference between one wait and two
 * hundred.
 *
 * It is a delivery count, not a download count. NobleSee does not hand
 * a reader a file to collect (`CLAUDE.md` section 1); the ledger this
 * reads is the record of books sent to e-readers, which is the number
 * an editor actually wants when asking whether anyone is reading this.
 */
export async function countDeliveries(bookIds: (number | string)[]): Promise<Map<number, number>> {
  const tally = new Map<number, number>()
  if (bookIds.length === 0) return tally

  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'downloads',
    where: { book: { in: bookIds } },
    // Bounded rather than unlimited. A ledger longer than this means
    // the count shown is a floor, which is a far better failure than a
    // page that will not load.
    limit: 5000,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  for (const row of result.docs) {
    const bookId = typeof row.book === 'object' && row.book ? row.book.id : row.book
    if (typeof bookId !== 'number') continue
    tally.set(bookId, (tally.get(bookId) ?? 0) + 1)
  }
  return tally
}

/** Collections in the order they are shown, for the admin's own screen. */
export async function getAdminCollections(): Promise<BookCollection[]> {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'book-collections',
    sort: ['sortOrder', 'title'],
    limit: PAGE_LIMIT,
    depth: 0,
    overrideAccess: true,
  })
  return result.docs
}

/**
 * Which books sit in each collection, keyed by collection id.
 *
 * Book *ids* rather than a count, because collections nest: a parent
 * shelf's total is the union of its subtree, and a book filed on both a
 * parent and one of its children must be counted once. Summing counts
 * would count it twice.
 */
export async function booksPerCollection(): Promise<Map<number, Set<number>>> {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'books',
    limit: 2000,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const tally = new Map<number, Set<number>>()
  for (const book of result.docs) {
    for (const entry of book.collections ?? []) {
      const id = typeof entry === 'object' && entry ? entry.id : entry
      if (typeof id !== 'number') continue
      const shelf = tally.get(id)
      if (shelf) shelf.add(book.id)
      else tally.set(id, new Set([book.id]))
    }
  }
  return tally
}

export interface AdminUserRow {
  user: User
  uploads: number
  published: number
}

/**
 * Readers, with what each of them has contributed.
 *
 * The two counts come from one pass over the owned books rather than
 * two queries per reader, for the same reason `countDeliveries` does:
 * a per-row query on a list screen is how a Worker page becomes slow
 * without anyone noticing which line did it.
 */
export async function getAdminUsers(query: string): Promise<AdminUserRow[]> {
  const payload = await getPayload({ config })

  const users = await payload.find({
    collection: 'users',
    where: query ? { or: [{ email: { like: query } }, { displayName: { like: query } }] } : {},
    sort: '-createdAt',
    limit: PAGE_LIMIT,
    depth: 0,
    overrideAccess: true,
  })

  const owned = await payload.find({
    collection: 'books',
    where: { owner: { exists: true } },
    limit: 2000,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const uploads = new Map<number, number>()
  const published = new Map<number, number>()
  for (const book of owned.docs) {
    const ownerId = typeof book.owner === 'object' && book.owner ? book.owner.id : book.owner
    if (typeof ownerId !== 'number') continue
    uploads.set(ownerId, (uploads.get(ownerId) ?? 0) + 1)
    if (book.visibility === 'public') {
      published.set(ownerId, (published.get(ownerId) ?? 0) + 1)
    }
  }

  return users.docs.map((user) => ({
    user,
    uploads: uploads.get(user.id) ?? 0,
    published: published.get(user.id) ?? 0,
  }))
}
