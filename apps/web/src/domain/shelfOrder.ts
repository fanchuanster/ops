/**
 * How the things on a shelf are ordered.
 *
 * A collection's children — the books filed directly on it, and the
 * shelves standing on it — are ordered one of two ways:
 *
 *   alphabetical  by title
 *   sequence      by the order id each item carries
 *
 * **The shelf decides, not the reader.** Since 2026-08-25 every
 * collection carries `childOrder`, and it defaults to alphabetical:
 * a library nobody has curated reads A–Z, which is the order a reader
 * can predict and scan. A curator switches one shelf to `sequence` when
 * its contents have an order of their own — a ten-volume set, a reading
 * path, a "start here" — and only that shelf changes.
 *
 * That default matters more than it looks. It used to be `sequence`
 * everywhere, which meant a shelf's order was whatever numbers happened
 * to have been handed out, and alphabetical was something a reader had
 * to ask for. Curation is the exception; being able to find a title is
 * the norm.
 *
 * The reader's A–Z / Curated toggle is still there and is now an
 * *override*: with no `?sort=` in the URL each shelf uses its own
 * setting, and picking one applies it to the whole page.
 *
 * ## The order id
 *
 * A number the item carries, handed out one past the highest on the
 * shelf when it is filed, and editable afterwards. It need not be
 * unique — two books at 3 read alphabetically between themselves — so
 * setting one writes a single row and moves nothing else. It need not
 * be contiguous either: nothing renumbers a shelf because a book left
 * it, so 1, 2, 5 is a normal state and the gap is not a bug to tidy.
 *
 * An item with no number at all sorts last under the title comparison.
 * That is the safety net rather than the common case, since filing a
 * book gives it one — a book on *no* shelf has none, because an order
 * id is a position among a collection's own books.
 *
 * Framework-independent, like everything in `src/domain`.
 */

export const SHELF_SORTS = ['sequence', 'alphabetical'] as const

export type ShelfSort = (typeof SHELF_SORTS)[number]

/**
 * What a shelf does when nobody has said otherwise: A–Z.
 *
 * The library is mostly not curated, and a reader scanning for a title
 * can predict the alphabet. A curator switches the shelves that have an
 * order of their own — the ten-volume set, the reading path — and every
 * other shelf stays findable.
 */
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

/**
 * The sort a reader asked for, or null when they did not ask.
 *
 * Null is the interesting value: it means "let each shelf decide", and
 * it is what an ordinary visit to `/books` carries. Collapsing an
 * absent parameter into a default here would take that decision away
 * from the shelf and hand it to whoever wrote this function.
 */
export function parseShelfSort(raw: string | string[] | undefined | null): ShelfSort | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return isShelfSort(value) ? value : null
}

/**
 * How to order one shelf's children: the reader's override if they made
 * one, else the shelf's own setting, else A–Z.
 *
 * The one place that decision is made, so a shelf reads the same way on
 * the public library and in the editorial tree.
 */
export function shelfSortFor({
  readerSort,
  childOrder,
}: {
  readerSort?: ShelfSort | null
  childOrder?: unknown
}): ShelfSort {
  if (readerSort) return readerSort
  return isShelfSort(childOrder) ? childOrder : DEFAULT_CHILD_ORDER
}

/** Anything that sits on a shelf: a book, or a shelf standing on it. */
export interface OrderedItem {
  id: number | string
  title: string
  /** Its order id on this shelf. Null for one nobody has numbered. */
  order?: number | null
}

/**
 * Titles compared as a reader would read them.
 *
 * `zh` first because this library's centre of gravity is Chinese, and
 * `numeric` because "卷 2" belongs before "卷 10" — a plain code-point
 * comparison puts it after. Built once: constructing a collator per
 * comparison is the classic way to make a sort of two hundred titles
 * slow on a Worker.
 */
const collator = new Intl.Collator(['zh-Hant', 'zh-Hans', 'en'], {
  numeric: true,
  sensitivity: 'base',
})

export function compareTitles(a: OrderedItem, b: OrderedItem): number {
  return collator.compare(a.title ?? '', b.title ?? '')
}

/** A usable order id, or null — anything else stored is not one. */
export function orderIdOf(item: OrderedItem): number | null {
  const order = item.order
  return typeof order === 'number' && Number.isFinite(order) ? order : null
}

/**
 * Ascending by order id, ties broken by title, null last.
 *
 * The tie-break is not a corner case any more, it is the common one:
 * order ids need not be unique, and everything nobody has placed shares
 * `UNPLACED_ORDER_ID`, so an uncurated shelf reaches the title
 * comparison for every pair. It also runs over a *mixed* list — one
 * catalog query covers every shelf at once — where two books on
 * different shelves legitimately share the number 1.
 *
 * Null is last rather than treated as unplaced: a null order id means a
 * book on no shelf, which has no business being interleaved with one
 * that is on this one.
 */
export function compareSequence(a: OrderedItem, b: OrderedItem): number {
  const left = orderIdOf(a)
  const right = orderIdOf(b)
  if (left === null && right === null) return compareTitles(a, b)
  if (left === null) return 1
  if (right === null) return -1
  if (left !== right) return left - right
  return compareTitles(a, b)
}

/** The shelf in the order asked for. A copy; the input is left alone. */
export function sortShelfItems<T extends OrderedItem>(
  items: readonly T[],
  sort: ShelfSort,
): T[] {
  return [...items].sort(sort === 'alphabetical' ? compareTitles : compareSequence)
}

/** Editors count from one, so the lowest place on a shelf is 1. */
export const FIRST_ORDER_ID = 1

/**
 * The highest number an editor may type.
 *
 * Four digits is already far more than a shelf holds; anything larger
 * is a typo, and clamping is kinder than refusing.
 */
export const MAX_ORDER_ID = 9999

/**
 * The order id a new arrival gets: one past the highest already there.
 *
 * Past the highest rather than into the first gap. A shelf's numbers
 * are a sequence somebody is reading down, and dropping a new book into
 * the hole left by a deleted one puts it in the middle of a list it has
 * no business being in the middle of.
 *
 * Incremental at filing, which is what makes `sequence` mean "the order
 * they arrived in" on a shelf nobody has hand-numbered. Between
 * 2026-08-25 and this commit an arrival took a shared "unplaced" value
 * instead, so `sequence` and alphabetical were the same list — that was
 * the wrong lever for "shelves should read A–Z by default", and the
 * right one is `childOrder` on the shelf.
 */
export function nextOrderId(siblings: readonly OrderedItem[]): number {
  let highest = FIRST_ORDER_ID - 1
  for (const sibling of siblings) {
    const order = orderIdOf(sibling)
    if (order !== null && order > highest) highest = order
  }
  return Math.min(MAX_ORDER_ID, highest + 1)
}

/**
 * A number an editor typed, made storable.
 *
 * Floored and clamped: a fractional place is meaningless, 0 or -3 means
 * "first", and anything past `MAX_ORDER_ID` is a slip rather than a
 * position. Nothing here consults the other books — duplicates are
 * allowed, so there is nothing to resolve.
 */
export function orderIdFrom(desired: number): number {
  if (!Number.isFinite(desired)) return FIRST_ORDER_ID
  return Math.min(MAX_ORDER_ID, Math.max(FIRST_ORDER_ID, Math.floor(desired)))
}

/** One write `resequence` is asking for. */
export interface OrderWrite {
  id: number | string
  order: number
}

/**
 * Number a shelf 1, 2, 3… in the order given.
 *
 * For the one case that genuinely is a renumber: the reorder arrows,
 * which hand over the sibling group in its new order. Every row is
 * written, including the ones whose number does not change, because the
 * caller's job here is to make the stored numbers say what the list on
 * screen says — and after an arrow the whole group is placed, so none
 * of them is at the back of the shelf any more.
 */
export function resequence(siblings: readonly OrderedItem[]): OrderWrite[] {
  return siblings.map((sibling, index) => ({
    id: sibling.id,
    order: FIRST_ORDER_ID + index,
  }))
}
