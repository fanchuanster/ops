import { subtreeIds, type CollectionNode } from './collectionTree'

export function searchNeedle(query: string | null | undefined): string {
  return (query ?? '').trim()
}

export function matchesNeedle(value: string | null | undefined, needle: string): boolean {
  const wanted = needle.trim().toLowerCase()
  if (wanted === '') return true
  return (value ?? '').toLowerCase().includes(wanted)
}

export function shelvesNamed(
  collections: readonly CollectionNode[],
  needle: string,
): number[] {
  const wanted = needle.trim().toLowerCase()
  if (wanted === '') return []

  const named = new Set<number>()
  for (const collection of collections) {
    if (!collection.title.toLowerCase().includes(wanted)) continue
    for (const id of subtreeIds(collections, collection.id)) named.add(id)
  }
  return [...named]
}
