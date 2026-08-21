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
import { getPayload, type TypedUser, type Where } from 'payload'

import { type BookLevel, DEFAULT_BROWSE_LEVEL, levelId } from '../domain/levels'
import { slugFromParam } from './slugParam'

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

  // The catalog is the *public* library, said here rather than left to
  // the collection's access rule. That rule now also admits a reader's
  // own uploads, which belong in `/account/books` and nowhere near a
  // browse listing — and a filter that only holds while nobody passes a
  // session is not a filter.
  //
  // The level is one indexed comparison: a reader at this id sees every
  // book at or below it. In the query rather than over the results, so a
  // folded-away book is never fetched and never reaches the browser —
  // though it is still curation and not access control (domain/levels.ts).
  const filters: Where[] = [
    { visibility: { equals: 'public' } },
    { status: { equals: 'published' } },
    { level: { less_than_equal: levelId(level) } },
  ]
  if (collectionId) filters.push({ collections: { equals: collectionId } })

  const books = await payload.find({
    collection: 'books',
    where: { and: filters },
    sort: 'title',
    limit,
    depth: 1,
    overrideAccess: false,
  })

  return { books: books.docs, collection: collectionSlug ?? null, level }
}

/**
 * Every collection, in the order an editor put them in.
 *
 * `sortOrder` first, `title` second. The second key is not decoration:
 * `sortOrder` is nullable, so a collection nobody has moved still lands
 * in the alphabetical order it has always had rather than in whatever
 * order the rows happen to come back in.
 */
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

/**
 * One book by slug, as seen by whoever is asking.
 *
 * The `user` argument is not optional decoration. `overrideAccess:
 * false` with nobody passed is an *anonymous* query — the local API
 * does not read the request's cookies — so omitting it means a reader's
 * own private upload is filtered out of their own book page and their
 * own reader, which surfaces as a bare 404. Every caller that has a
 * session must hand it over.
 *
 * The slug is decoded on the way in, because every caller is a dynamic
 * route handing over a URL segment and Next does not decode those — see
 * `slugFromParam`. Decoding here rather than at each of the five call
 * sites: this is the one function they all pass through, so a route
 * added later cannot forget.
 */
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
