export const MAX_DEPTH = 3

export interface CollectionNode {
  id: number
  title: string
  parent?: number | { id: number } | null
}

export interface TreeNode<T extends CollectionNode> {
  collection: T
  depth: number
  children: TreeNode<T>[]
}

export function parentIdOf(node: CollectionNode): number | null {
  const parent = node.parent
  if (typeof parent === 'number') return parent
  if (parent && typeof parent === 'object' && typeof parent.id === 'number') return parent.id
  return null
}

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

    if (!parent || parent === node) {
      roots.push(node)
      continue
    }
    parent.children.push(node)
  }

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

    const parentId = parentIdOf(collection)
    const parent = parentId === null ? undefined : nodes.get(parentId)
    if (parent) parent.children = parent.children.filter((child) => child !== node)

    roots.push(node)
    assign(node, 1)
  }

  return roots
}

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
    if (seen.has(current)) return
    seen.add(current)
    ids.push(current)
    for (const child of childrenOf.get(current) ?? []) walk(child)
  }
  walk(id)
  return ids
}

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

export function depthOf(collections: readonly CollectionNode[], id: number): number {
  return ancestryOf(collections, id).length || 1
}

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

export function eligibleParents<T extends CollectionNode>(
  collections: readonly T[],
  id: number | null,
): T[] {
  return collections.filter(
    (collection) => canNest({ collections, id, parentId: collection.id }).allowed,
  )
}
