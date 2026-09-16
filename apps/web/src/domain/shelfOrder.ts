export const SHELF_SORTS = ['sequence', 'alphabetical'] as const

export type ShelfSort = (typeof SHELF_SORTS)[number]

export const DEFAULT_CHILD_ORDER: ShelfSort = 'alphabetical'

export const SHELF_SORT_LABELS: Record<ShelfSort, string> = {
  sequence: 'Curated',
  alphabetical: 'A–Z',
}

export const SHELF_SORT_DESCRIPTIONS: Record<ShelfSort, string> = {
  sequence: 'By the order id each item carries',
  alphabetical: 'By title',
}

export function isShelfSort(value: unknown): value is ShelfSort {
  return typeof value === 'string' && (SHELF_SORTS as readonly string[]).includes(value)
}

export function shelfSortFor({ childOrder }: { childOrder?: unknown }): ShelfSort {
  return isShelfSort(childOrder) ? childOrder : DEFAULT_CHILD_ORDER
}

export interface OrderedItem {
  id: number | string
  title: string
  order?: number | null
}

const collator = new Intl.Collator(['zh-Hant', 'zh-Hans', 'en'], {
  numeric: true,
  sensitivity: 'base',
})

export function compareTitles(a: OrderedItem, b: OrderedItem): number {
  return collator.compare(a.title ?? '', b.title ?? '')
}

export function orderIdOf(item: OrderedItem): number | null {
  const order = item.order
  return typeof order === 'number' && Number.isFinite(order) ? order : null
}

export function compareSequence(a: OrderedItem, b: OrderedItem): number {
  const left = orderIdOf(a)
  const right = orderIdOf(b)
  if (left === null && right === null) return compareTitles(a, b)
  if (left === null) return 1
  if (right === null) return -1
  if (left !== right) return left - right
  return compareTitles(a, b)
}

export function sortShelfItems<T extends OrderedItem>(
  items: readonly T[],
  sort: ShelfSort,
): T[] {
  return [...items].sort(sort === 'alphabetical' ? compareTitles : compareSequence)
}

export const FIRST_ORDER_ID = 1

export const MAX_ORDER_ID = 9999

export function nextOrderId(siblings: readonly OrderedItem[]): number {
  let highest = FIRST_ORDER_ID - 1
  for (const sibling of siblings) {
    const order = orderIdOf(sibling)
    if (order !== null && order > highest) highest = order
  }
  return Math.min(MAX_ORDER_ID, highest + 1)
}

export function orderIdFrom(desired: number): number {
  if (!Number.isFinite(desired)) return FIRST_ORDER_ID
  return Math.min(MAX_ORDER_ID, Math.max(FIRST_ORDER_ID, Math.floor(desired)))
}

export interface OrderWrite {
  id: number | string
  order: number
}

export function resequence(siblings: readonly OrderedItem[]): OrderWrite[] {
  return siblings.map((sibling, index) => ({
    id: sibling.id,
    order: FIRST_ORDER_ID + index,
  }))
}
