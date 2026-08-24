'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { canNest, parentIdOf, subtreeIds } from '../../../domain/collectionTree'
import {
  isBookLevel,
  isLevelApplyMode,
  levelFromId,
  levelId,
  shelfLevelFor,
} from '../../../domain/levels'
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

export type CollectionsState = { error?: string; ok?: string }

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

/**
 * Level every book on a shelf, and on every shelf standing on it.
 *
 * A shelf of eighty books cannot be levelled eighty clicks at a time,
 * so the level is handed down the subtree in one act. The subtree and
 * not just the shelf, because CLAUDE.md section 5.3 says a parent
 * carries everything beneath it — an editor levelling "Chinese
 * Classics" means the Confucian shelf standing on it too, and a version
 * that quietly stopped at the first level would be the more surprising
 * of the two behaviours.
 *
 * Two modes, and `domain/levels.ts` owns the difference: a **cap** can
 * only ever move a book shallower and leaves a curated one alone; an
 * **exact** level overwrites whatever was there. Neither is a default
 * worth guessing at, so the form asks, and cap is what it offers first.
 *
 * Only books that would actually change are written. Applying a cap to
 * a large shelf typically moves a handful of them, and a write per book
 * regardless would be a round trip to D1 for every row to change three
 * — which is what a Worker is billed for.
 */
/**
 * How many books one shelf-levelling will touch, and how many at a time.
 *
 * The ceiling is not arithmetic: every update is a Worker subrequest,
 * and a run that quietly stopped halfway through a shelf would be worse
 * than one that never started. 500 is comfortably inside the budget for
 * a library this size; past it the honest answer is a script.
 */
const BOOK_LIMIT = 500
const BATCH = 20

export async function applyShelfLevel(
  _prev: CollectionsState,
  formData: FormData,
): Promise<CollectionsState> {
  const admin = await currentAdmin()
  if (!admin) return { error: 'Administrators only.' }

  const collectionId = Number(formData.get('collectionId'))
  if (!Number.isInteger(collectionId)) return { error: 'No collection named.' }

  const level = formData.get('level')
  if (!isBookLevel(level)) return { error: 'That is not a level.' }

  const mode = formData.get('mode')
  if (!isLevelApplyMode(mode)) return { error: 'Say whether that is a cap or an exact level.' }

  const payload = await getPayload({ config })

  try {
    const all = await payload.find({
      collection: 'book-collections',
      limit: 500,
      depth: 0,
      overrideAccess: true,
    })
    const docs = all.docs as BookCollection[]
    // `subtreeIds` walks down from whatever it is given and always
    // returns at least that id, so it cannot tell us the shelf is gone.
    // The list it walked can.
    if (!docs.some((shelf) => shelf.id === collectionId)) {
      return { error: 'That shelf is no longer there.' }
    }
    const shelves = subtreeIds(docs, collectionId)

    // Every book filed on any shelf in the subtree, in one query. The
    // `in` is over an indexed join rather than a query per shelf.
    const books = await payload.find({
      collection: 'books',
      where: { collection: { in: shelves } },
      limit: BOOK_LIMIT,
      depth: 0,
      overrideAccess: true,
    })

    const changes = books.docs.flatMap((book) => {
      const next = shelfLevelFor(mode, level, levelFromId(book.level))
      return next === null ? [] : [{ id: book.id, level: levelId(next) }]
    })

    // In batches rather than all at once. Each update is a subrequest
    // and a Worker has a bounded number of them, so a shelf of hundreds
    // must not fan out into one flight — and each is an independent row,
    // so there is nothing to gain from doing them strictly in turn.
    for (let at = 0; at < changes.length; at += BATCH) {
      await Promise.all(
        changes.slice(at, at + BATCH).map((change) =>
          payload.update({
            collection: 'books',
            id: change.id,
            data: { level: change.level },
            overrideAccess: true,
          }),
        ),
      )
    }

    revalidateCollections()
    return {
      ok:
        changes.length === 0
          ? 'Nothing to change — every book beneath it already fits.'
          : `${changes.length} ${changes.length === 1 ? 'book' : 'books'} moved to ${level}.`,
    }
  } catch (error) {
    logError('admin.collections.applyLevel', error)
    return { error: 'That level could not be applied.' }
  }
}

function revalidateCollections() {
  revalidatePath('/admin/library')
  // The home page is a row of these shelves, in this order.
  revalidatePath('/')
  revalidatePath('/collections')
  revalidatePath('/books')
}
