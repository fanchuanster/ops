/**
 * Catalog queries for the public site.
 *
 * Every read here passes `overrideAccess: false`, so Payload applies
 * the Books collection's access rule and an uncleared, private or
 * unpublished book cannot reach a page even if a query here is wrong.
 * That is deliberate: the frontend is not permitted to be the thing
 * standing between a reader and restricted content.
 *
 * This module may import Payload. `src/domain` may not — see
 * scripts/check-domain-boundary.sh.
 */

import config from '@payload-config'
import { getPayload, type Where } from 'payload'

import { type BookLevel, DEFAULT_BROWSE_LEVEL, levelId } from '../domain/levels'

export async function getCatalog({
  collectionSlug,
  level = DEFAULT_BROWSE_LEVEL,
  limit = 48,
}: {
  collectionSlug?: string
  level?: BookLevel
  limit?: number
} = {}) {
  const payload = await getPayload({ config })

  let collectionId: string | number | undefined
  if (collectionSlug) {
    const found = await payload.find({
      collection: 'book-collections',
      where: { slug: { equals: collectionSlug } },
      limit: 1,
      overrideAccess: false,
    })
    // An unknown slug must yield an empty catalog, never the whole
    // catalog — otherwise a typo silently defeats the filter.
    if (found.docs.length === 0) return { books: [], collection: null, level }
    collectionId = found.docs[0].id
  }

  // One indexed comparison: a reader at this id sees every book at or
  // below it. Runs in the query rather than over the results, so a
  // folded-away book is never fetched and never reaches the browser —
  // though it is still curation and not access control (domain/levels.ts).
  const filters: Where[] = [{ level: { less_than_equal: levelId(level) } }]
  if (collectionId) filters.push({ collections: { equals: collectionId } })

  const books = await payload.find({
    collection: 'books',
    where: filters.length === 1 ? filters[0] : { and: filters },
    sort: 'title',
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
    sort: 'title',
    limit: 100,
    depth: 1,
    overrideAccess: false,
  })
  return result.docs
}

export async function getBookBySlug(slug: string) {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'books',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 1,
    overrideAccess: false,
  })
  return result.docs[0] ?? null
}

/**
 * The books a reader uploaded, whatever state they are in.
 *
 * Access overridden and filtered by owner here, because a reader's own
 * private conversions are exactly what the Books access rule hides from
 * the public catalog — this is the one view that is meant to see them.
 */
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
