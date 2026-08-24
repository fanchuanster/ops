import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import {
  MAX_DEPTH,
  type NestingRefusal,
  canNest,
  parentIdOf,
} from '../domain/collectionTree'

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
 * Here rather than only in the admin screen because there are two ways
 * in: `/admin/library`, and Payload's own `/cms`. A cycle created
 * through either would strand every collection in the ring — the tree
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
  hooks: { beforeChange: [enforceNesting] },
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
      name: 'sortOrder',
      type: 'number',
      admin: {
        description:
          'Where this shelf sits among its siblings, lowest first. Left empty it falls to the end and sorts by title — which is what every collection did before anyone chose. Set from /admin/library rather than typed here.',
      },
    },
  ],
}
