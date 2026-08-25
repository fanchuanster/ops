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

import { subtreeIds } from '../domain/collectionTree'
import { type BookLevel, DEFAULT_BROWSE_LEVEL, levelId } from '../domain/levels'
import { DEFAULT_SHELF_SORT, type ShelfSort } from '../domain/shelfOrder'
import { slugFromParam } from './slugParam'

export async function getCatalog({
  collectionSlug,
  level = DEFAULT_BROWSE_LEVEL,
  sort = DEFAULT_SHELF_SORT,
  limit = 48,
}: {
  collectionSlug?: string
  level?: BookLevel
  sort?: ShelfSort
  limit?: number
} = {}) {
  const payload = await getPayload({ config })

  // The subtree, not the one shelf. A reader who opens "Chinese
  // Classics" is asking for the books on it *and* on every shelf
  // standing on it — that is what nesting means, and this query is
  // where it is honoured (`domain/collectionTree.ts`).
  //
  // One query for the whole list rather than a recursive walk of the
  // table: there are tens of collections, D1 has no recursive CTE
  // through this adapter, and the tree is computed in memory in
  // microseconds.
  let collectionIds: number[] | undefined
  if (collectionSlug) {
    const all = await payload.find({
      collection: 'book-collections',
      limit: 500,
      depth: 0,
      pagination: false,
      overrideAccess: false,
    })
    const found = all.docs.find((doc) => doc.slug === collectionSlug)
    // An unknown slug must yield an empty catalog, never the whole
    // catalog — otherwise a typo silently defeats the filter.
    if (!found) return { books: [], collection: null, level }
    collectionIds = subtreeIds(all.docs, found.id)
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
  if (collectionIds) filters.push({ collection: { in: collectionIds } })

  // Sorted in the database and not only in the page, because `limit`
  // truncates: browsing in the curated order has to take the first
  // forty-eight *by that order*, not the first forty-eight
  // alphabetically and then rearrange them.
  //
  // `collectionOrder` is a position within one shelf, so this is not a
  // meaningful global ordering — the page groups the result by shelf
  // and each shelf comes out in its own order, which is the only thing
  // asked of it. The title key underneath settles books on different
  // shelves that share a number, and books nobody has numbered.
  const books = await payload.find({
    collection: 'books',
    where: { and: filters },
    sort: sort === 'alphabetical' ? 'title' : ['collectionOrder', 'title'],
    limit,
    depth: 1,
    overrideAccess: false,
  })

  return { books: books.docs, collection: collectionSlug ?? null, level, sort }
}

/**
 * Every collection, in the order asked for.
 *
 * Curated: `sortOrder` first, `title` second. The second key is not
 * decoration — `sortOrder` is nullable, so a collection nobody has
 * moved still lands in the alphabetical order it has always had rather
 * than in whatever order the rows happen to come back in.
 *
 * A–Z: title alone, which is the point of asking for it.
 *
 * Order is per-parent, and this is a flat list of every collection at
 * every depth — `buildTree` preserves the order it is given, so sorting
 * the whole list here orders each sibling group correctly and there is
 * no second ordering rule inside the tree builder to keep in step.
 */
export async function getCollections(sort: ShelfSort = DEFAULT_SHELF_SORT) {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'book-collections',
    sort: sort === 'alphabetical' ? ['title'] : ['sortOrder', 'title'],
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
