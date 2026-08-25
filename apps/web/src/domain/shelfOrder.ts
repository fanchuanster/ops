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
 * The sequence is not a position in a list, it is a **number the item
 * carries**: a book is given one when it is filed onto a shelf, it is
 * unique among that shelf's own books, and an editor can change it.
 * Collections carry the same number among their own siblings
 * (`sortOrder`, which predates this module and is exactly this idea for
 * shelves rather than books).
 *
 * Two consequences of it being a carried number rather than a position,
 * both deliberate:
 *
 *   - The numbers need not be contiguous. Nothing renumbers a shelf
 *     because one book left it, so 1, 2, 5 is a normal state and the
 *     gap is not a bug to tidy. An order id an editor typed is a fact
 *     they stated, and rewriting the whole shelf under them to close a
 *     gap would move books nobody touched.
 *   - Setting one to a number already taken **shifts**, it does not
 *     swap. `placeInOrder` inserts at the number asked for and pushes
 *     the run of occupants along, which is what "put this book third"
 *     means to the person typing 3.
 *
 * An item with no number at all sorts last, under the alphabetical
 * fallback — the same rule `sortOrder` has always had on collections,
 * so a library nobody has ordered still reads in a sensible order
 * rather than in whatever order the rows came back in.
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
 * Ascending by order id, unnumbered last, ties broken by title.
 *
 * The tie-break matters more than it looks: order ids are unique per
 * shelf by construction, but this comparator also runs over a *mixed*
 * list — one catalog query covers every shelf at once — where two books
 * on different shelves legitimately share the number 1.
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

/** The first order id on an empty shelf. One, not zero — editors count from one. */
export const FIRST_ORDER_ID = 1

/**
 * The order id a new arrival gets: one past the highest already there.
 *
 * Past the highest rather than into the first gap. A shelf's numbers
 * are a sequence somebody is reading down, and dropping a new book into
 * the hole left by a deleted one puts it in the middle of a list it has
 * no business being in the middle of.
 */
export function nextOrderId(siblings: readonly OrderedItem[]): number {
  let highest = FIRST_ORDER_ID - 1
  for (const sibling of siblings) {
    const order = orderIdOf(sibling)
    if (order !== null && order > highest) highest = order
  }
  return highest + 1
}

/** One write `placeInOrder` or `resequence` is asking for. */
export interface OrderWrite {
  id: number | string
  order: number
}

/**
 * Put one item at a given order id, shifting whatever is in the way.
 *
 * Returns only the writes that actually change something — the item
 * itself, and the contiguous run of occupants starting at the number
 * asked for, each pushed up by one. The run stops at the first free
 * number, so a shelf numbered 1, 2, 7 with something inserted at 1
 * rewrites two rows and leaves 7 where it is.
 *
 * `desired` is clamped to a whole number no lower than the first order
 * id: an editor typing 0 or -3 means "first", and a fractional order id
 * would break the uniqueness this exists to keep.
 */
export function placeInOrder(
  siblings: readonly OrderedItem[],
  { id, desired }: { id: number | string; desired: number },
): OrderWrite[] {
  const target = Math.max(FIRST_ORDER_ID, Math.floor(desired))
  const key = String(id)

  // The moved item is not in its own way. Taken from the others only,
  // so re-stating a book's own number is a no-op rather than a shove.
  const occupied = new Map<number, OrderedItem>()
  for (const sibling of siblings) {
    if (String(sibling.id) === key) continue
    const order = orderIdOf(sibling)
    if (order !== null) occupied.set(order, sibling)
  }

  const writes: OrderWrite[] = []
  const current = siblings.find((sibling) => String(sibling.id) === key)
  if (!current || orderIdOf(current) !== target) writes.push({ id, order: target })

  for (let slot = target; occupied.has(slot); slot += 1) {
    writes.push({ id: occupied.get(slot)!.id, order: slot + 1 })
  }
  return writes
}

/**
 * Number a shelf 1, 2, 3… in the order given.
 *
 * For the one case that genuinely is a renumber: the reorder arrows,
 * which hand over the sibling group in its new order. Every row is
 * written, including the ones whose number does not change, because the
 * caller's job here is to make the stored numbers say what the list on
 * screen says.
 */
export function resequence(siblings: readonly OrderedItem[]): OrderWrite[] {
  return siblings.map((sibling, index) => ({
    id: sibling.id,
    order: FIRST_ORDER_ID + index,
  }))
}
