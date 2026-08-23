/**
 * Nested collections.
 *
 * Two things carry weight here. `subtreeIds` is what makes a parent
 * shelf show the books on the shelves beneath it — get it wrong and
 * nesting is decoration. And `canNest` is the only thing standing
 * between an administrator and a ring of collections that would hang
 * every walk in this module.
 *
 * The tree builder is also tested against data that is already broken,
 * because it runs on the public catalog: a cycle someone created before
 * these rules existed must not take the library down.
 */

import { describe, expect, it } from 'vitest'

import {
  MAX_DEPTH,
  ancestryOf,
  buildTree,
  canNest,
  depthOf,
  eligibleParents,
  flattenTree,
  heightOf,
  parentIdOf,
  subtreeIds,
} from './collectionTree'

/*
    1 Classics
      2 Confucian
        4 Analects commentary
      3 Daoist
    5 Health
*/
const library = [
  { id: 1, title: 'Classics', parent: null },
  { id: 2, title: 'Confucian', parent: 1 },
  { id: 3, title: 'Daoist', parent: 1 },
  { id: 4, title: 'Analects commentary', parent: 2 },
  { id: 5, title: 'Health', parent: null },
]

describe('reading the parent field', () => {
  it('takes an id, a populated document, or nothing', () => {
    expect(parentIdOf({ id: 2, title: 'x', parent: 1 })).toBe(1)
    expect(parentIdOf({ id: 2, title: 'x', parent: { id: 1 } })).toBe(1)
    expect(parentIdOf({ id: 2, title: 'x', parent: null })).toBeNull()
    expect(parentIdOf({ id: 2, title: 'x' })).toBeNull()
  })
})

describe('building the tree', () => {
  it('nests children under their parents and numbers the depths', () => {
    const tree = buildTree(library)
    expect(tree.map((n) => n.collection.id)).toEqual([1, 5])
    expect(tree[0].children.map((n) => n.collection.id)).toEqual([2, 3])
    expect(tree[0].children[0].children[0].collection.title).toBe('Analects commentary')
    expect(tree[0].depth).toBe(1)
    expect(tree[0].children[0].depth).toBe(2)
    expect(tree[0].children[0].children[0].depth).toBe(3)
  })

  it('keeps the order it was given, rather than sorting again', () => {
    const reversed = [...library].reverse()
    const roots = buildTree(reversed).map((n) => n.collection.id)
    expect(roots).toEqual([5, 1])
    expect(buildTree(reversed)[1].children.map((n) => n.collection.id)).toEqual([3, 2])
  })

  it('treats a missing parent as a root, so a deleted shelf hides nothing', () => {
    const orphaned = [{ id: 9, title: 'Orphan', parent: 404 }]
    expect(buildTree(orphaned).map((n) => n.collection.id)).toEqual([9])
  })

  it('does not hang on a cycle already in the data', () => {
    const ring = [
      { id: 1, title: 'A', parent: 2 },
      { id: 2, title: 'B', parent: 1 },
      { id: 3, title: 'C', parent: null },
    ]
    const tree = buildTree(ring)
    // Every collection is still reachable — an administrator cannot fix
    // what no screen will show them.
    expect(flattenTree(tree).map((n) => n.collection.id).sort()).toEqual([1, 2, 3])
  })

  it('flattens parents immediately before their children', () => {
    expect(flattenTree(buildTree(library)).map((n) => n.collection.id)).toEqual([1, 2, 4, 3, 5])
  })
})

describe('a collection and everything beneath it', () => {
  it('is what a parent shelf is filtered by', () => {
    expect(subtreeIds(library, 1).sort()).toEqual([1, 2, 3, 4])
  })

  it('includes the collection itself, since books attach to parents too', () => {
    expect(subtreeIds(library, 5)).toEqual([5])
    expect(subtreeIds(library, 4)).toEqual([4])
  })

  it('terminates on a cycle', () => {
    const ring = [
      { id: 1, title: 'A', parent: 2 },
      { id: 2, title: 'B', parent: 1 },
    ]
    expect(subtreeIds(ring, 1).sort()).toEqual([1, 2])
  })
})

describe('where a collection sits', () => {
  it('reads the path down from the root', () => {
    expect(ancestryOf(library, 4).map((c) => c.id)).toEqual([1, 2, 4])
    expect(ancestryOf(library, 1).map((c) => c.id)).toEqual([1])
    expect(ancestryOf(library, 404)).toEqual([])
  })

  it('measures depth and subtree height', () => {
    expect(depthOf(library, 1)).toBe(1)
    expect(depthOf(library, 4)).toBe(3)
    expect(heightOf(library, 1)).toBe(3)
    expect(heightOf(library, 2)).toBe(2)
    expect(heightOf(library, 4)).toBe(1)
  })
})

describe('what may be filed under what', () => {
  it('allows a plain move to a shallow parent', () => {
    expect(canNest({ collections: library, id: 5, parentId: 1 })).toEqual({ allowed: true })
  })

  it('always allows unfiling', () => {
    expect(canNest({ collections: library, id: 4, parentId: null })).toEqual({ allowed: true })
  })

  it('refuses a collection as its own parent', () => {
    expect(canNest({ collections: library, id: 1, parentId: 1 })).toEqual({
      allowed: false,
      reason: 'self',
    })
  })

  it('refuses filing a collection under its own descendant', () => {
    expect(canNest({ collections: library, id: 1, parentId: 4 })).toEqual({
      allowed: false,
      reason: 'descendant',
    })
  })

  it('refuses a parent that is not there', () => {
    expect(canNest({ collections: library, id: 5, parentId: 404 })).toEqual({
      allowed: false,
      reason: 'unknown_parent',
    })
  })

  it('counts the moved subtree’s own height, not just the node', () => {
    // 5 is a leaf, so it fits under a depth-2 parent…
    expect(canNest({ collections: library, id: 5, parentId: 2 }).allowed).toBe(true)
    // …but 2 carries a child, and moving it under 3 would put that
    // child at depth 4.
    expect(canNest({ collections: library, id: 2, parentId: 3 })).toEqual({
      allowed: false,
      reason: 'too_deep',
    })
  })

  it('refuses anything below the deepest legal level', () => {
    expect(depthOf(library, 4)).toBe(MAX_DEPTH)
    expect(canNest({ collections: library, id: 5, parentId: 4 })).toEqual({
      allowed: false,
      reason: 'too_deep',
    })
  })

  it('answers for a collection that does not exist yet', () => {
    expect(canNest({ collections: library, id: null, parentId: 2 }).allowed).toBe(true)
    expect(canNest({ collections: library, id: null, parentId: 4 }).allowed).toBe(false)
  })
})

describe('the parent picker', () => {
  it('offers only what will actually be accepted', () => {
    // Not 3: 2 carries a child, and 3 is already a child itself, so
    // that move would land a grandchild at depth 4. Not 4 either, and
    // never itself.
    expect(eligibleParents(library, 2).map((c) => c.id)).toEqual([1, 5])
  })

  it('offers every shallow collection to a new one', () => {
    expect(eligibleParents(library, null).map((c) => c.id)).toEqual([1, 2, 3, 5])
  })
})
