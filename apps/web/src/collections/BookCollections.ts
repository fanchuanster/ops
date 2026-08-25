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

/**
 * A collection may not be filed under itself, its own descendant, or so
 * deep that the tree stops being browsable.
 *
 * Here rather than only in the admin screen because there is more than
 * one way in: `/admin/library`, and the REST API under
 * `(payload)/api`. A cycle created through either would strand every
 * collection in the ring — the tree
 * builder detaches them so the catalog survives, but they would vanish
 * from the shelves until somebody noticed.
 *
 * The rule itself is `canNest` in `domain/collectionTree.ts`; this hook
 * only fetches what it needs and turns a refusal into an error. Business
 * logic must not accumulate in Payload hooks (CLAUDE.md section 2.1).
 */
const enforceNesting: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  // An update that does not mention the parent is not a move. Only a
  // stated parent is checked, so editing a title never has to re-prove
  // where the collection sits.
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
    // Null on create: a collection that does not exist yet has no
    // descendants and nothing hanging beneath it.
    id: typeof originalDoc?.id === 'number' ? originalDoc.id : null,
    parentId,
  })

  if (!decision.allowed) throw new APIError(NESTING_ERRORS[decision.reason!], 400)
  return data
}

/**
 * A shelf's place among its own siblings.
 *
 * The same rule books get in `collections/Books.ts`: one past the
 * highest already standing on this parent, so a shelf's `sequence`
 * order is the order its children arrived in until somebody renumbers
 * them. Whether a reader ever *sees* that order is the parent's
 * `childOrder`, which defaults to alphabetical — the number is always
 * assigned, and only consulted when the shelf asks for it.
 *
 * A stated number is obeyed exactly, collisions included — two shelves
 * may share a number and then read alphabetically between themselves.
 * Nothing shifts out of the way any more.
 *
 * "Stated" means *different from what is stored*: Payload hands this
 * hook the whole document with the update merged into it, so
 * `data.sortOrder` is always a number on an update. Reading its mere
 * presence as an instruction would make a shelf moved to another parent
 * keep the number it held among its old siblings — see the same rule,
 * and the same trap, in `collections/Books.ts`.
 */
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
  // An update that does not mention the parent is not a move, so the
  // shelf keeps whatever parent it already had.
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

/**
 * Curatorial groupings: "Chinese Wisdom", "Authors / Nan Huaijin", etc.
 *
 * They nest. `parent` has been here since the first migration and
 * nothing read it until 2026-08-23; what makes it mean something is
 * `domain/collectionTree.ts`, and the one rule worth stating here is
 * that **a parent shelf carries everything beneath it**. A reader who
 * opens "Chinese Classics" gets the books filed directly on it and the
 * books on every shelf standing on it.
 */
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
      /**
       * How this shelf's own children are ordered — the books filed
       * directly on it and the shelves standing on it, both.
       *
       * A curator's decision and not a reader's, so it is written where
       * the other curatorial fields are: administrators only, at every
       * door and not just the one with the control on it.
       */
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
      /**
       * An administrator's, for the same reason `collectionOrder` is on
       * a book: this is where a shelf sits among its siblings, so
       * changing it moves every shelf it passes and decides what a
       * reader meets first. The reorder arrows in `/admin/library` are
       * the only control for it and they are behind `currentAdmin`;
       * this is the same rule at the API door, which has no screen in
       * front of it.
       */
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
