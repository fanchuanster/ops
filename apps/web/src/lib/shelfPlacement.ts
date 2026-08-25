import type { Payload } from 'payload'

import { parentIdOf } from '../domain/collectionTree'
import { placeInOrder } from '../domain/shelfOrder'

/**
 * Putting a book, or a shelf, at a given number among its own kind.
 *
 * The rule is `placeInOrder` in `domain/shelfOrder.ts` — insert at the
 * number asked for and push the run of occupants along. This module is
 * the I/O around it: fetch the sibling group, apply the writes it asks
 * for.
 *
 * It lives here rather than in the collection hook that *assigns* order
 * ids because a shift is several updates to several rows, and a hook
 * sees one row at a time: it would meet each of those writes on its own
 * and try to shift it out of the way of the shift. Assignment (a number
 * for an arrival) is the hook's; placement (a number an editor typed)
 * is every caller's, through here.
 *
 * Both functions are safe to call when nothing has to move — an editor
 * re-stating the number a book already has produces no writes at all.
 */

/** How many siblings a shelf can hold before this stops being loaded whole. */
const SIBLING_LIMIT = 1000

/**
 * Give a book its place among the books on one shelf.
 *
 * `shelfId` of null is not an error and not a no-op: a book on no shelf
 * has no order id (`domain/shelfOrder.ts`), and the collection hook has
 * already cleared it. There is simply nothing to place it among.
 */
export async function placeBookOnShelf(
  payload: Payload,
  { bookId, shelfId, desired }: { bookId: number; shelfId: number | null; desired: number },
): Promise<void> {
  if (shelfId === null) return

  const siblings = await payload.find({
    collection: 'books',
    where: { collection: { equals: shelfId } },
    limit: SIBLING_LIMIT,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const writes = placeInOrder(
    siblings.docs.map((book) => ({
      id: book.id,
      title: book.title,
      order: book.collectionOrder,
    })),
    { id: bookId, desired },
  )

  await Promise.all(
    writes.map((write) =>
      payload.update({
        collection: 'books',
        id: write.id as number,
        data: { collectionOrder: write.order },
        overrideAccess: true,
      }),
    ),
  )
}

/**
 * Give a collection its place among the shelves standing on the same
 * parent.
 *
 * `parentId` of null is the root group, which is a real group — the
 * shelves a reader meets first — and not "unfiled". That is why the
 * comparison is on `parentIdOf` rather than on a query: a root's parent
 * is absent in the row, so `{ parent: { equals: null } }` is not a
 * filter every adapter agrees about, and the collections table is tens
 * of rows that every other rule here already loads whole.
 */
export async function placeCollectionAmongSiblings(
  payload: Payload,
  {
    collectionId,
    parentId,
    desired,
  }: { collectionId: number; parentId: number | null; desired: number },
): Promise<void> {
  const all = await payload.find({
    collection: 'book-collections',
    limit: SIBLING_LIMIT,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const writes = placeInOrder(
    all.docs
      .filter((collection) => parentIdOf(collection) === parentId)
      .map((collection) => ({
        id: collection.id,
        title: collection.title,
        order: collection.sortOrder,
      })),
    { id: collectionId, desired },
  )

  await Promise.all(
    writes.map((write) =>
      payload.update({
        collection: 'book-collections',
        id: write.id as number,
        data: { sortOrder: write.order },
        overrideAccess: true,
      }),
    ),
  )
}
