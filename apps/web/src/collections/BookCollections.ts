import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import {
  MAX_DEPTH,
  type NestingRefusal,
  canNest,
  parentIdOf,
} from '../domain/collectionTree'
import { DEFAULT_CHILD_ORDER, SHELF_SORTS, nextOrderId } from '../domain/shelfOrder'

const NESTING_ERRORS: Record<NestingRefusal, string> = {
  self: 'A collection cannot be filed under itself.',
  descendant: 'A collection cannot be filed under one of its own sub-collections.',
  too_deep: `Collections nest ${MAX_DEPTH} levels deep at most.`,
  unknown_parent: 'That parent collection does not exist.',
}

const enforceNesting: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  if (!data || !('parent' in data)) return data

  const parentId = parentIdOf({ id: 0, title: '', parent: data.parent ?? null })
  if (parentId === null) return data

  const all = await req.payload.find({
    collection: 'book-collections',
    limit: 500,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const decision = canNest({
    collections: all.docs,
    id: typeof originalDoc?.id === 'number' ? originalDoc.id : null,
    parentId,
  })

  if (!decision.allowed) throw new APIError(NESTING_ERRORS[decision.reason!], 400)
  return data
}

const assignSiblingOrder: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (!data) return data

  const stated =
    typeof data.sortOrder === 'number' && data.sortOrder !== originalDoc?.sortOrder
  if (stated) return data

  const was = parentIdOf({ id: 0, title: '', parent: originalDoc?.parent ?? null })
  const parent =
    'parent' in data ? parentIdOf({ id: 0, title: '', parent: data.parent ?? null }) : was

  const moved = operation === 'create' || parent !== was
  if (!moved && typeof originalDoc?.sortOrder === 'number') return data

  const all = await req.payload.find({
    collection: 'book-collections',
    limit: 500,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  return {
    ...data,
    sortOrder: nextOrderId(
      all.docs
        .filter(
          (collection) =>
            collection.id !== originalDoc?.id && parentIdOf(collection) === parent,
        )
        .map((collection) => ({
          id: collection.id,
          title: collection.title,
          order: collection.sortOrder,
        })),
    ),
  }
}

export const BookCollections: CollectionConfig = {
  slug: 'book-collections',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'parent', 'sortOrder', 'slug'],
    group: 'Library',
  },
  access: { read: () => true },
  hooks: { beforeChange: [enforceNesting, assignSiblingOrder] },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'description', type: 'textarea' },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'book-collections',
      admin: {
        description: `The shelf this one stands on. A parent shows every book beneath it, so filing "Confucian" under "Chinese Classics" means the classics shelf shows both. Nests ${MAX_DEPTH} levels deep at most; a collection cannot be filed under itself or under its own sub-collection.`,
      },
    },
    {
      name: 'childOrder',
      type: 'select',
      defaultValue: DEFAULT_CHILD_ORDER,
      options: [
        { label: 'A–Z, by title', value: 'alphabetical' },
        { label: 'Curated, by order id', value: 'sequence' },
      ],
      access: {
        create: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
        update: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
      },
      admin: {
        description:
          'How the books and shelves on this one are ordered. A–Z unless this shelf has an order of its own — a volume set, a reading path — in which case order ids decide. Set from /admin/library.',
      },
    },
    {
      name: 'sortOrder',
      access: {
        create: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
        update: ({ req }) => Boolean(req.user?.roles?.includes('admin')),
      },
      type: 'number',
      admin: {
        description:
          'Where this shelf sits among the shelves on the same parent, lowest first. Given when the shelf is filed and editable from /admin/library; a number another shelf already has shifts that shelf down. Left empty it falls to the end and sorts by title.',
      },
    },
  ],
}
