'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { canNest, parentIdOf, subtreeIds } from '../../../domain/collectionTree'
import { isShelfSort, orderIdFrom, resequence } from '../../../domain/shelfOrder'
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

export type CollectionsState = { error?: string; ok?: string }

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function requestedParent(formData: FormData): number | null {
  const raw = String(formData.get('parentId') ?? '').trim()
  if (raw === '') return null
  const id = Number(raw)
  return Number.isInteger(id) ? id : null
}

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

  const slug = slugify(title) || `collection-${Date.now()}`

  const payload = await getPayload({ config })

  const parent = requestedParent(formData)
  if (parent !== null) {
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

  const order = requestedOrder(formData)
  if (order === 'invalid') return { error: 'An order is a whole number.' }

  const childOrder = String(formData.get('childOrder') ?? '')

  try {
    await payload.update({
      collection: 'book-collections',
      id,
      data: {
        title,
        description: description || null,
        parent,
        sortOrder: order === null ? undefined : orderIdFrom(order),
        childOrder: isShelfSort(childOrder) ? childOrder : undefined,
      },
      overrideAccess: true,
    })
  } catch (error) {
    logError('admin.collections.save', error)
    return { error: 'That change could not be saved.' }
  }

  revalidateCollections()
  return { ok: 'Saved.' }
}

function requestedOrder(formData: FormData): number | null | 'invalid' {
  const raw = String(formData.get('sortOrder') ?? '').trim()
  if (raw === '') return null
  const order = Number(raw)
  return Number.isInteger(order) ? order : 'invalid'
}

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
  if (from === -1 || to < 0 || to >= order.length) return {}

  ;[order[from], order[to]] = [order[to], order[from]]

  try {
    await Promise.all(
      resequence(order.map((collectionId) => ({ id: collectionId, title: '' }))).map((write) =>
        payload.update({
          collection: 'book-collections',
          id: write.id as number,
          data: { sortOrder: write.order },
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
    if (!docs.some((shelf) => shelf.id === collectionId)) {
      return { error: 'That shelf is no longer there.' }
    }
    const shelves = subtreeIds(docs, collectionId)

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
  revalidatePath('/')
  revalidatePath('/collections')
  revalidatePath('/books')
}
