/**
 * Collections nest.
 *
 * A shelf is not always a flat list: "Chinese Classics" wants
 * "Confucian" and "Daoist" underneath it, and a reader who asks for the
 * parent expects everything on every shelf beneath it — that is what
 * nesting *means*, and it is the one rule the rest of this module
 * exists to serve (`subtreeIds`).
 *
 * The `parent` field has been on the collection since the first
 * migration and nothing read it until 2026-08-23. This module is what
 * makes it mean something.
 *
 * Three rules, all here rather than in a route or a hook, because each
 * of them is enforced in two places at once — our own admin screen and
 * Payload's `/cms`:
 *
 *   1. A collection may not be its own ancestor.
 *   2. The tree is at most `MAX_DEPTH` deep, counting a moved subtree's
 *      own height, not just the node being moved.
 *   3. A parent that no longer exists is not an error. It reads as a
 *      root, so deleting a shelf never makes its children vanish.
 *
 * Framework-independent, like everything in `src/domain`.
 */

/**
 * How deep the library may nest.
 *
 * Three, and the limit is editorial rather than technical: past a
 * grandchild a reader is navigating a filesystem rather than browsing a
 * library, and the breadcrumb stops fitting on a phone. Nothing here
 * would break at four — `subtreeIds` is a walk, not a join — so this is
 * a number to change if the library ever genuinely needs it.
 */
export const MAX_DEPTH = 3

export interface CollectionNode {
  id: number
  title: string
  /** The parent's id, as stored: an id, a populated document, or nothing. */
  parent?: number | { id: number } | null
}

export interface TreeNode<T extends CollectionNode> {
  collection: T
  /** 1 for a root. */
  depth: number
  children: TreeNode<T>[]
}

/** The parent's id, whatever shape the field came back in. */
export function parentIdOf(node: CollectionNode): number | null {
  const parent = node.parent
  if (typeof parent === 'number') return parent
  if (parent && typeof parent === 'object' && typeof parent.id === 'number') return parent.id
  return null
}

/**
 * The flat list as a tree, preserving the order it arrived in.
 *
 * Order is deliberately *not* recomputed here. The list comes from a
 * query sorted by `sortOrder` then `title`, and that is the one
 * ordering rule the library has; re-sorting in the tree builder would
 * be a second one to keep in step with the first. Siblings therefore
 * come out in the order they were given.
 *
 * A node whose parent is missing — deleted, or filtered out of the
 * query — becomes a root rather than disappearing. The alternative is a
 * shelf that silently stops being browsable because something above it
 * was tidied away.
 */
export function buildTree<T extends CollectionNode>(collections: readonly T[]): TreeNode<T>[] {
  const nodes = new Map<number, TreeNode<T>>()
  for (const collection of collections) {
    nodes.set(collection.id, { collection, depth: 1, children: [] })
  }

  const roots: TreeNode<T>[] = []
  for (const collection of collections) {
    const node = nodes.get(collection.id)!
    const parentId = parentIdOf(collection)
    const parent = parentId === null ? undefined : nodes.get(parentId)

    // Its own parent, or a parent that is not here: a root either way.
    // Deeper cycles are broken below, where the depths are assigned.
    if (!parent || parent === node) {
      roots.push(node)
      continue
    }
    parent.children.push(node)
  }

  // Depth is assigned by walking down from the roots, which is also what
  // detaches a cycle: a ring of collections that never reaches a root is
  // never visited, so it is appended afterwards rather than recursed
  // into forever. The write path refuses to create one (`canNest`), but
  // a ring already in the database must not take the catalog down.
  const seen = new Set<number>()
  const assign = (node: TreeNode<T>, depth: number) => {
    if (seen.has(node.collection.id)) return
    seen.add(node.collection.id)
    node.depth = depth
    for (const child of node.children) assign(child, depth + 1)
  }
  for (const root of roots) assign(root, 1)

  for (const collection of collections) {
    const node = nodes.get(collection.id)!
    if (seen.has(collection.id)) continue

    // Stranded in a cycle: nothing above it reaches a root. Detached
    // from its parent and shown as a root of its own, so an
    // administrator can see it and fix it rather than losing it from
    // every screen. `assign` marks the rest of the ring on the way
    // down, which is what stops the ring being emitted twice.
    const parentId = parentIdOf(collection)
    const parent = parentId === null ? undefined : nodes.get(parentId)
    if (parent) parent.children = parent.children.filter((child) => child !== node)

    roots.push(node)
    assign(node, 1)
  }

  return roots
}

/** The tree flattened back to a list, parents immediately before their children. */
export function flattenTree<T extends CollectionNode>(tree: readonly TreeNode<T>[]): TreeNode<T>[] {
  const out: TreeNode<T>[] = []
  const walk = (nodes: readonly TreeNode<T>[]) => {
    for (const node of nodes) {
      out.push(node)
      walk(node.children)
    }
  }
  walk(tree)
  return out
}

/**
 * A collection and everything beneath it.
 *
 * This is the whole point of nesting. A reader who opens "Chinese
 * Classics" is asking for the books on that shelf *and* on every shelf
 * standing on it — so the catalog query filters on this list rather
 * than on one id.
 *
 * Includes the collection itself, because books attach to a parent
 * directly as often as they attach to a child.
 */
export function subtreeIds(collections: readonly CollectionNode[], id: number): number[] {
  const childrenOf = new Map<number, number[]>()
  for (const collection of collections) {
    const parentId = parentIdOf(collection)
    if (parentId === null || parentId === collection.id) continue
    const siblings = childrenOf.get(parentId)
    if (siblings) siblings.push(collection.id)
    else childrenOf.set(parentId, [collection.id])
  }

  const ids: number[] = []
  const seen = new Set<number>()
  const walk = (current: number) => {
    // Guarded rather than trusted: a cycle in stored data must not spin
    // here, and this runs on every filtered catalog request.
    if (seen.has(current)) return
    seen.add(current)
    ids.push(current)
    for (const child of childrenOf.get(current) ?? []) walk(child)
  }
  walk(id)
  return ids
}

/**
 * The path from the root down to this collection, itself last.
 *
 * What the breadcrumb on a filtered library page is made of. Empty when
 * the collection is not in the list at all.
 */
export function ancestryOf<T extends CollectionNode>(
  collections: readonly T[],
  id: number,
): T[] {
  const byId = new Map(collections.map((collection) => [collection.id, collection]))
  const path: T[] = []
  const seen = new Set<number>()

  let current = byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    const parentId = parentIdOf(current)
    current = parentId === null ? undefined : byId.get(parentId)
  }
  return path
}

/** How deep this collection sits, 1 for a root. */
export function depthOf(collections: readonly CollectionNode[], id: number): number {
  return ancestryOf(collections, id).length || 1
}

/**
 * How many levels this collection's own subtree adds beneath it.
 *
 * 1 for a leaf. Needed because moving a collection moves everything
 * under it: a two-level subtree hung off a depth-2 parent would land its
 * grandchildren at depth 4, which `MAX_DEPTH` forbids even though the
 * node being moved would itself be legal.
 */
export function heightOf(collections: readonly CollectionNode[], id: number): number {
  const ids = new Set(subtreeIds(collections, id))
  let tallest = 1
  const base = depthOf(collections, id)
  for (const collection of collections) {
    if (!ids.has(collection.id)) continue
    tallest = Math.max(tallest, depthOf(collections, collection.id) - base + 1)
  }
  return tallest
}

export type NestingRefusal = 'self' | 'descendant' | 'too_deep' | 'unknown_parent'

export interface NestingDecision {
  allowed: boolean
  reason?: NestingRefusal
}

/**
 * May this collection be filed under that one?
 *
 * `parentId` of null is always allowed: unfiling something is never
 * illegal. `id` of null asks the question for a collection that does not
 * exist yet, which has no descendants and no height of its own.
 */
export function canNest({
  collections,
  id,
  parentId,
}: {
  collections: readonly CollectionNode[]
  id: number | null
  parentId: number | null
}): NestingDecision {
  if (parentId === null) return { allowed: true }
  if (id !== null && parentId === id) return { allowed: false, reason: 'self' }

  const parent = collections.find((collection) => collection.id === parentId)
  if (!parent) return { allowed: false, reason: 'unknown_parent' }

  if (id !== null && subtreeIds(collections, id).includes(parentId)) {
    return { allowed: false, reason: 'descendant' }
  }

  const height = id === null ? 1 : heightOf(collections, id)
  if (depthOf(collections, parentId) + height >= MAX_DEPTH + 1) {
    return { allowed: false, reason: 'too_deep' }
  }

  return { allowed: true }
}

/**
 * Which collections this one may legally be filed under.
 *
 * What the parent picker on the admin screen is filled from — so an
 * administrator is never offered a choice that will be refused when
 * they save it.
 */
export function eligibleParents<T extends CollectionNode>(
  collections: readonly T[],
  id: number | null,
): T[] {
  return collections.filter(
    (collection) => canNest({ collections, id, parentId: collection.id }).allowed,
  )
}
