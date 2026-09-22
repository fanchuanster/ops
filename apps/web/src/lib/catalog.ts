import config from '@payload-config'
import { getPayload, type TypedUser, type Where } from 'payload'

import { subtreeIds } from '../domain/collectionTree'
import { type BookLevel, DEFAULT_BROWSE_LEVEL, levelId } from '../domain/levels'
import { searchNeedle, shelvesNamed } from '../domain/search'
import { slugFromParam } from './slugParam'

export const CATALOG_LIMIT = 1000

export async function getCatalog({
  collectionSlug,
  level = DEFAULT_BROWSE_LEVEL,
  query,
  limit,
}: {
  collectionSlug?: string
  level?: BookLevel
  query?: string
  limit: number
}) {
  const payload = await getPayload({ config })

  const wanted = searchNeedle(query)

  const shelves =
    collectionSlug || wanted
      ? (
          await payload.find({
            collection: 'book-collections',
            limit: 500,
            depth: 0,
            pagination: false,
            overrideAccess: false,
          })
        ).docs
      : []

  let collectionIds: number[] | undefined
  if (collectionSlug) {
    const found = shelves.find((doc) => doc.slug === collectionSlug)
    if (!found) return { books: [], collection: null, level }
    collectionIds = subtreeIds(shelves, found.id)
  }

  const filters: Where[] = [
    { status: { equals: 'published' } },
    { level: { less_than_equal: levelId(level) } },
  ]
  if (collectionIds) filters.push({ collection: { in: collectionIds } })

  if (wanted) {
    const named = shelvesNamed(shelves, wanted)
    const or: Where[] = [{ title: { like: wanted } }, { author: { like: wanted } }]
    if (named.length > 0) or.push({ collection: { in: named } })
    filters.push({ or })
  }

  const books = await payload.find({
    collection: 'books',
    where: { and: filters },
    sort: ['collectionOrder', 'title'],
    limit,
    depth: 1,
    overrideAccess: false,
  })

  return { books: books.docs, collection: collectionSlug ?? null, level }
}

export async function getCollections() {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'book-collections',
    sort: ['sortOrder', 'title'],
    limit: 100,
    depth: 1,
    overrideAccess: false,
  })
  return result.docs
}

export async function getBookBySlug(slug: string, user?: TypedUser | null) {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'books',
    where: { slug: { equals: slugFromParam(slug) } },
    limit: 1,
    depth: 1,
    overrideAccess: false,
    user: user ?? undefined,
  })
  return result.docs[0] ?? null
}

export async function getBooksOwnedBy(userId: string | number, limit = 100) {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'books',
    where: { owner: { equals: userId } },
    sort: '-createdAt',
    limit,
    depth: 1,
    overrideAccess: true,
  })
  return result.docs
}
