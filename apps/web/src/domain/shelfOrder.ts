/**
 * How the things on a shelf are ordered.
 *
 * A collection's children — the books filed directly on it, and the
 * shelves standing on it — are ordered two ways, and a reader picks
 * which:
 *
 *   sequence      the order somebody put them in, ascending
 *   alphabetical  by title
 *
 * The sequence is a **number the item carries**, and since 2026-08-25
 * two things about that number are deliberately loose:
 *
 *   - **It need not be unique.** Two books on a shelf may both be 3,
 *     and they then read alphabetically between themselves. Setting a
 *     number therefore writes one row and never touches another book,
 *     which is what an editor typing 3 actually asked for. It used to
 *     *shift* the run of occupants along to keep the numbers unique —
 *     one edit rewriting half a shelf, and books nobody touched moving.
 *   - **A shelf is alphabetical until somebody says otherwise.** An
 *     arrival is not given the next free number any more; it takes
 *     `UNPLACED_ORDER_ID`, which every unplaced item shares, so they
 *     all tie and fall to the title comparison. A shelf nobody has
 *     curated reads A–Z, and a book given a real number rises out of
 *     that run to the place it was given.
 *
 * The numbers need not be contiguous either. Nothing renumbers a shelf
 * because a book left it, so 1, 2, 5 is a normal state — an order id an
 * editor typed is a fact they stated, and closing a gap under them
 * would move books nobody touched.
 *
 * ## Why "unplaced" is a number and not null
 *
 * It would read better as null, and it cannot be. The catalog sorts in
 * the database because `limit` truncates — browsing in the curated
 * order has to take the first forty-eight *by that order*. SQLite sorts
 * NULLs **first** in an ascending sort and the adapter emits no
 * `NULLS LAST`, so a null would put every uncurated book ahead of the
 * ones an editor deliberately numbered: exactly backwards. A large
 * shared number sorts last by ordinary arithmetic, in the database and
 * in `compareSequence` alike.
 *
 * Null still means something, and something different: a book on no
 * shelf at all. An order id is a position among a collection's own
 * books, so off the shelf there is nothing for it to be a position in.
 *
 * Framework-independent, like everything in `src/domain`.
 */

export const SHELF_SORTS = ['sequence', 'alphabetical'] as const

export type ShelfSort = (typeof SHELF_SORTS)[number]

/**
 * Sequence, not alphabetical.
 *
 * The library is curated: the order an editor put a shelf in is a
 * judgement about where a reader should start, and the alphabet is not.
 * Alphabetical is the one to reach for when you are *looking for* a
 * book rather than being shown one, which is why it is offered and why
 * it is not the default.
 */
export const DEFAULT_SHELF_SORT: ShelfSort = 'sequence'

export const SHELF_SORT_LABELS: Record<ShelfSort, string> = {
  sequence: 'Curated',
  alphabetical: 'A–Z',
}

export const SHELF_SORT_DESCRIPTIONS: Record<ShelfSort, string> = {
  sequence: 'The order the library puts them in',
  alphabetical: 'By title',
}

export function isShelfSort(value: unknown): value is ShelfSort {
  return typeof value === 'string' && (SHELF_SORTS as readonly string[]).includes(value)
}

/** The sort a query string is asking for; the default for anything else. */
export function parseShelfSort(raw: string | string[] | undefined | null): ShelfSort {
  const value = Array.isArray(raw) ? raw[0] : raw
  return isShelfSort(value) ? value : DEFAULT_SHELF_SORT
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
 * Not a storage limit — it is the gap that keeps a typed number and
 * `UNPLACED_ORDER_ID` from ever colliding. Four digits is already far
 * more than a shelf holds; anything larger is a typo, and clamping is
 * kinder than refusing.
 */
export const MAX_ORDER_ID = 9999

/**
 * The number everything unplaced carries: the back of the shelf.
 *
 * Shared rather than unique, which is the whole point — every item
 * nobody has curated ties with every other, so they read alphabetically
 * among themselves and after anything an editor placed. Out of reach of
 * `MAX_ORDER_ID`, so it can never be typed by accident.
 */
export const UNPLACED_ORDER_ID = 1_000_000

/** Whether this item is where an editor put it, rather than at the back. */
export function isPlaced(item: OrderedItem): boolean {
  const order = orderIdOf(item)
  return order !== null && order < UNPLACED_ORDER_ID
}

/**
 * A number an editor typed, made storable.
 *
 * Floored and clamped: a fractional place is meaningless, 0 or -3 means
 * "first", and anything past `MAX_ORDER_ID` is a slip rather than a
 * position. Nothing here consults the other books — duplicates are
 * allowed now, so there is nothing to resolve.
 */
export function orderIdFrom(desired: number): number {
  if (!Number.isFinite(desired)) return UNPLACED_ORDER_ID
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
