'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { currentAdmin } from '../../../lib/adminAuth'
import { logError } from '../../../lib/logError'

/**
 * The shelves: naming them, describing them, and putting them in order.
 *
 * A collection is a piece of editorial writing as much as a filter —
 * the description is what a reader is told a shelf is *for* — so this
 * screen edits the words, and the order they are read in.
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
  try {
    await payload.create({
      collection: 'book-collections',
      data: { title, slug, description: description || null },
      overrideAccess: true,
    })
  } catch (error) {
    logError('admin.collections.create', error)
    return { error: 'That collection could not be created — the name may already be taken.' }
  }

  revalidateCollections()
  return {}
}

export async function renameCollection(
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
  try {
    // The slug is deliberately left alone. It is in every link a reader
    // has ever saved to this shelf, and renaming "Chinese History" to
    // "History of China" is a change of wording, not a decision to
    // break those links.
    await payload.update({
      collection: 'book-collections',
      id,
      data: { title, description: description || null },
      overrideAccess: true,
    })
  } catch (error) {
    logError('admin.collections.rename', error)
    return { error: 'That change could not be saved.' }
  }

  revalidateCollections()
  return {}
}

/**
 * Move a collection one place up or down.
 *
 * Rewrites `sortOrder` across the whole list from what is on screen
 * rather than swapping two values. Swapping only works when every row
 * already has a distinct number, and most of them have null — this is
 * the first time anybody has ordered them. Rewriting is a handful of
 * updates on a table with tens of rows, and it leaves the column in a
 * state the next move can rely on.
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
    limit: 200,
    depth: 0,
    overrideAccess: true,
  })

  const order = current.docs.map((doc) => doc.id)
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
