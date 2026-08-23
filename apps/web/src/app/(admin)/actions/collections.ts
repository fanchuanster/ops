'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { canNest, parentIdOf } from '../../../domain/collectionTree'
import type { BookCollection } from '../../../payload-types'
import { currentAdmin } from '../../../lib/adminAuth'
import { logError } from '../../../lib/logError'

/**
 * The shelves: naming them, describing them, filing them under one
 * another, and putting them in order.
 *
 * A collection is a piece of editorial writing as much as a filter —
 * the description is what a reader is told a shelf is *for* — so this
 * screen edits the words, and the order they are read in.
 *
 * Nesting is checked here *and* in a hook on the collection, because
 * `/cms` is a second door into the same table. The rule lives in
 * `domain/collectionTree.ts`; both callers only ask it.
 */

export type CollectionsState = { error?: string }

/** "Chinese Classics" → "chinese-classics". */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The parent a form is asking for: an id, or null for a root.
 *
 * An empty string is the "No parent" option in the select and means
 * unfiled, which is a real instruction rather than a missing field.
 */
function requestedParent(formData: FormData): number | null {
  const raw = String(formData.get('parentId') ?? '').trim()
  if (raw === '') return null
  const id = Number(raw)
  return Number.isInteger(id) ? id : null
}

/** Every collection, for the nesting rules to be checked against. */
async function allCollections(payload: Awaited<ReturnType<typeof getPayload>>) {
  const result = await payload.find({
    collection: 'book-collections',
    limit: 500,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  return result.docs
}

const NESTING_ERRORS = {
  self: 'A collection cannot be filed under itself.',
  descendant: 'A collection cannot be filed under one of its own sub-collections.',
  too_deep: 'That would nest the collections too deeply.',
  unknown_parent: 'That parent collection no longer exists.',
} as const

export async function createCollection(
  _prev: CollectionsState,
  formData: FormData,
): Promise<CollectionsState> {
  const admin = await currentAdmin()
  if (!admin) return { error: 'Administrators only.' }

  const title = String(formData.get('title') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  if (title === '') return { error: 'A collection needs a name.' }

  // A Chinese-only title slugifies to nothing useful, and a slug is a
  // required unique column — so fall back to something guaranteed to
  // exist rather than failing on a perfectly good name.
  const slug = slugify(title) || `collection-${Date.now()}`

  const payload = await getPayload({ config })

  const parent = requestedParent(formData)
  if (parent !== null) {
    // A collection that does not exist yet has nothing hanging beneath
    // it, so only the parent's own depth can refuse this.
    const decision = canNest({ collections: await allCollections(payload), id: null, parentId: parent })
    if (!decision.allowed) return { error: NESTING_ERRORS[decision.reason!] }
  }

  try {
    await payload.create({
      collection: 'book-collections',
      data: { title, slug, description: description || null, parent },
      overrideAccess: true,
    })
  } catch (error) {
    logError('admin.collections.create', error)
    return { error: 'That collection could not be created — the name may already be taken.' }
  }

  revalidateCollections()
  return {}
}

/**
 * Everything one card edits: the name, the description, and the shelf
 * this one stands on.
 *
 * One action rather than three, because the card is one form and an
 * administrator changing "Confucian" to "Confucian classics" while also
 * filing it under "Chinese Classics" has made one decision, not two.
 */
export async function saveCollection(
  _prev: CollectionsState,
  formData: FormData,
): Promise<CollectionsState> {
  const admin = await currentAdmin()
  if (!admin) return { error: 'Administrators only.' }

  const id = Number(formData.get('collectionId'))
  if (!Number.isInteger(id)) return { error: 'No collection named.' }

  const title = String(formData.get('title') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  if (title === '') return { error: 'A collection needs a name.' }

  const payload = await getPayload({ config })

  const parent = requestedParent(formData)
  const collections = await allCollections(payload)
  const decision = canNest({ collections, id, parentId: parent })
  if (!decision.allowed) return { error: NESTING_ERRORS[decision.reason!] }

  const before = collections.find((collection) => collection.id === id)
  if (!before) return { error: 'No collection named.' }

  // Moving to a new parent puts it among strangers, so it goes to the
  // end of them rather than landing in the middle on whatever number it
  // happened to carry from its old siblings.
  const sortOrder = parentIdOf(before) === parent ? undefined : lastAmong(collections, parent)

  try {
    // The slug is deliberately left alone. It is in every link a reader
    // has ever saved to this shelf, and renaming "Chinese History" to
    // "History of China" is a change of wording, not a decision to
    // break those links.
    await payload.update({
      collection: 'book-collections',
      id,
      data: {
        title,
        description: description || null,
        parent,
        ...(sortOrder === undefined ? {} : { sortOrder }),
      },
      overrideAccess: true,
    })
  } catch (error) {
    logError('admin.collections.save', error)
    return { error: 'That change could not be saved.' }
  }

  revalidateCollections()
  return {}
}

/** One past the last `sortOrder` among a parent's children. */
function lastAmong(
  collections: readonly BookCollection[],
  parent: number | null,
): number {
  return collections
    .filter((collection) => parentIdOf(collection) === parent)
    .reduce((highest, sibling) => Math.max(highest, sibling.sortOrder ?? 0), 0) + 1
}

/**
 * Move a collection one place up or down **among its own siblings**.
 *
 * Since collections nest, the order is per-parent: moving "Daoist" up
 * moves it past "Confucian" on the same shelf, and can never lift it
 * out from under "Chinese Classics". Changing where a collection is
 * filed is `saveCollection` above, and is a different decision.
 *
 * Rewrites `sortOrder` across the sibling group rather than swapping two
 * values. Swapping only works when every row already has a distinct
 * number, and most of them have null. Rewriting is a handful of updates
 * on a group of a few rows, and it leaves the column in a state the next
 * move can rely on.
 */
export async function moveCollection(
  _prev: CollectionsState,
  formData: FormData,
): Promise<CollectionsState> {
  const admin = await currentAdmin()
  if (!admin) return { error: 'Administrators only.' }

  const id = Number(formData.get('collectionId'))
  const direction = String(formData.get('direction') ?? '')
  if (!Number.isInteger(id)) return { error: 'No collection named.' }
  if (direction !== 'up' && direction !== 'down') return { error: 'Nowhere to move it.' }

  const payload = await getPayload({ config })
  const current = await payload.find({
    collection: 'book-collections',
    sort: ['sortOrder', 'title'],
    limit: 500,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const moving = current.docs.find((doc) => doc.id === id)
  if (!moving) return { error: 'No collection named.' }

  const parent = parentIdOf(moving)
  const order = current.docs
    .filter((doc) => parentIdOf(doc) === parent)
    .map((doc) => doc.id)
  const from = order.indexOf(id)
  const to = direction === 'up' ? from - 1 : from + 1
  // Already at the end it is being moved towards: not an error, just
  // nothing to do. The button is disabled there anyway.
  if (from === -1 || to < 0 || to >= order.length) return {}

  ;[order[from], order[to]] = [order[to], order[from]]

  try {
    await Promise.all(
      order.map((collectionId, index) =>
        payload.update({
          collection: 'book-collections',
          id: collectionId,
          data: { sortOrder: index },
          overrideAccess: true,
        }),
      ),
    )
  } catch (error) {
    logError('admin.collections.move', error)
    return { error: 'The order could not be saved.' }
  }

  revalidateCollections()
  return {}
}

function revalidateCollections() {
  revalidatePath('/admin/collections')
  revalidatePath('/admin/books')
  // The home page is a row of these shelves, in this order.
  revalidatePath('/')
  revalidatePath('/collections')
  revalidatePath('/books')
}
