import config from '@payload-config'
import { getPayload } from 'payload'

import { REVIEW_QUEUE_STATES, type ReviewState } from '../domain/moderation'
import type { Book, BookCollection, User } from '../payload-types'

const PAGE_LIMIT = 200

export interface QueueFilter {
  state: ReviewState | null
}

export async function getReviewQueue({ state }: QueueFilter) {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'books',
    where: {
      'review.state': { in: state ? [state] : [...REVIEW_QUEUE_STATES] },
    },
    sort: '-review.submittedAt',
    limit: PAGE_LIMIT,
    depth: 1,
    overrideAccess: true,
  })
  return result.docs
}

export async function countAwaitingReview(): Promise<number> {
  const payload = await getPayload({ config })
  const result = await payload.count({
    collection: 'books',
    where: { 'review.state': { equals: 'submitted' } },
    overrideAccess: true,
  })
  return result.totalDocs
}

export async function getAdminBook(id: number): Promise<Book | null> {
  const payload = await getPayload({ config })
  return payload
    .findByID({ collection: 'books', id, depth: 1, overrideAccess: true })
    .catch(() => null)
}

export interface LibraryFilter {
  query: string
  collectionId: number | null
}

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
  if (collectionId !== null) filters.push({ collection: { equals: collectionId } })

  const result = await payload.find({
    collection: 'books',
    where: filters.length > 0 ? { and: filters } : {},
    sort: ['collectionOrder', 'title'],
    limit: PAGE_LIMIT,
    depth: 1,
    overrideAccess: true,
  })
  return result.docs
}

export async function countDeliveries(bookIds: (number | string)[]): Promise<Map<number, number>> {
  const tally = new Map<number, number>()
  if (bookIds.length === 0) return tally

  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'downloads',
    where: { book: { in: bookIds } },
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
    const entry = book.collection
    const id = typeof entry === 'object' && entry ? entry.id : entry
    if (typeof id !== 'number') continue
    const shelf = tally.get(id)
    if (shelf) shelf.add(book.id)
    else tally.set(id, new Set([book.id]))
  }
  return tally
}

export interface AdminUserRow {
  user: User
  uploads: number
  published: number
}

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
