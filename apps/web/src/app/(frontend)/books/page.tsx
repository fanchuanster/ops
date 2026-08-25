import React from 'react'

import { BookTile } from '../../../components/BookTile'
import { CollectionShelves, type ShelfNode } from '../../../components/CollectionShelves'
import { ShareCta } from '../../../components/ShareCta'
import {
  ancestryOf,
  buildTree,
  flattenTree,
  type TreeNode,
} from '../../../domain/collectionTree'
import {
  BOOK_LEVELS,
  DEFAULT_BROWSE_LEVEL,
  LEVEL_DESCRIPTIONS,
  LEVEL_LABELS,
  parseBrowseLevel,
} from '../../../domain/levels'
import { shelfSortFor, sortShelfItems } from '../../../domain/shelfOrder'
import { getCatalog, getCollections } from '../../../lib/catalog'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Library' }

/**
 * The catalog: the whole library as one collapsible tree of shelves.
 *
 * This is the only place collections are browsed. There was a separate
 * `/collections` page listing them as cards until 2026-08-21; a
 * collection is not a peer of a book but the shelf a book stands on, so
 * listing the shelves separately asked a reader to choose between two
 * routes to the same thing. That page now redirects here.
 *
 * The page showed **one level of shelves at a time** until 2026-08-24 —
 * root collections in the library, a collection's own children once you
 * were inside it — on the argument that a nested library rendered flat
 * is a wall of every shelf at once. The Figma design replaced that with
 * the flat tree plus a fold, which answers the wall directly instead of
 * answering it by hiding the library behind a click; see
 * `components/CollectionShelves.tsx` and CLAUDE.md section 5.3.
 *
 * `?collection=` survives that change and still narrows the page to one
 * subtree, so a shelf remains a real URL a reader can link to — it is
 * just no longer the only way down. The reading-level filter is
 * likewise still a plain link with a query string rather than client
 * state, so every filtered view stays bookmarkable and the only
 * JavaScript on the page is the fold.
 *
 * **How the library is ordered is not the reader's to change.** There
 * was an "As arranged / A–Z / Curated" control here until 2026-08-25,
 * and a `?sort=` override behind it that forced one rule across every
 * shelf on the page. Both are gone. Ordering is an editorial judgement
 * — where a reader should start, which volume comes first — and it is
 * made in the admin: the arrows on `/admin/collections` arrange the
 * shelves, and each shelf's own `childOrder` arranges what is on it.
 * A reader offered a button to overrule that is being offered a way to
 * undo the curation the library exists to provide.
 *
 * The reading-level filter is not in the design, and is kept anyway —
 * levels are a product feature (CLAUDE.md section 5.1), and a reader
 * browsing at `essential` has no other way to widen the shelf.
 */
/** A book as the catalog hands it over — a tile's data, and its order id. */
type CatalogBook = Awaited<ReturnType<typeof getCatalog>>['books'][number]

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string; level?: string }>
}) {
  const params = await searchParams
  const collection = params.collection
  const level = parseBrowseLevel(params.level)

  const href = (next: { collection?: string; level?: string }) => {
    const query = new URLSearchParams()
    const nextCollection = 'collection' in next ? next.collection : collection
    const nextLevel = next.level ?? level
    if (nextCollection) query.set('collection', nextCollection)
    // The default reads as no filter at all, so it stays out of the URL.
    if (nextLevel !== DEFAULT_BROWSE_LEVEL) query.set('level', nextLevel)
    const qs = query.toString()
    return qs ? `/books?${qs}` : '/books'
  }

  const [{ books }, collections] = await Promise.all([
    getCatalog({ collectionSlug: collection, level }),
    // Every shelf, already in the order the admin arranged them —
    // `sortOrder` first, title second. `buildTree` keeps whatever order
    // it is given, so that arrangement is what the page renders, at
    // every depth and at the root, exactly as the editorial tree shows
    // it (`admin/library/page.tsx`).
    getCollections(),
  ])

  const selected = collection ? collections.find((c) => c.slug === collection) : null
  const trail = selected ? ancestryOf(collections, selected.id) : []

  // Which books are filed directly on which shelf. Built once from the
  // single catalog query above rather than one query per shelf.
  //
  // Directly, not "and everything beneath": each shelf in the tree
  // renders its own books and *contains* the shelves under it, so a
  // parent carries its descendants visually. Rolling the subtree up
  // into the parent as well would print every book twice.
  const direct = new Map<string, CatalogBook[]>()
  const placed = new Set<string>()
  for (const book of books) {
    const ref = book.collection
    if (!ref) continue
    const id = String(typeof ref === 'object' ? ref.id : ref)
    const shelf = direct.get(id)
    if (shelf) shelf.push(book)
    else direct.set(id, [book])
    placed.add(String(book.id))
  }

  // Ordered again here, per shelf, over the order the query already
  // returned — and this is where the shelf's own `childOrder` is
  // honoured, because the catalog's sort is one ordering across every
  // shelf at once and cannot be two different things at the same time.
  // This is where a shelf becomes the list a reader actually sees.
  const onShelf = (shelf: (typeof collections)[number] | null, id: string) =>
    sortShelfItems(
      (direct.get(id) ?? []).map((book) => ({ ...book, order: book.collectionOrder })),
      shelfSortFor({ childOrder: shelf?.childOrder }),
    )

  // A shelf's sub-shelves are not re-sorted here: they arrive in the
  // order `/admin/collections` put them in and keep it. `childOrder`
  // governs the *books* on a shelf; where the shelves themselves stand
  // is what the reorder arrows say, and a shelf that moved under those
  // arrows has to move on this page too or the arrows are decoration.
  const toShelf = (node: TreeNode<(typeof collections)[number]>): ShelfNode => ({
    id: String(node.collection.id),
    title: node.collection.title,
    books: onShelf(node.collection, String(node.collection.id)),
    children: node.children.map(toShelf),
  })

  const tree = buildTree(collections)

  // Inside a collection the tree is that collection's own children: the
  // page heading already names the shelf itself, so repeating it as a
  // root here would print the title twice. Its own books lead the page
  // instead, above its children — which is the order the design uses
  // for every shelf that has both.
  const selectedNode = selected
    ? (flattenTree(tree).find((node) => node.collection.id === selected.id) ?? null)
    : null
  const shelves = (selectedNode ? selectedNode.children : tree).map(toShelf)
  const lead = selected ? onShelf(selected, String(selected.id)) : []

  // Every published book belongs to a collection eventually, but not
  // today — so anything uncollected still gets a shelf rather than
  // being invisible in the library. It joins the tree as a last root
  // rather than as markup of its own, so it folds like every other
  // shelf and there is only one shelf renderer to keep in step.
  const loose = books.filter((book) => !placed.has(String(book.id)))
  if (loose.length > 0) {
    shelves.push({
      // Not a collection id. Prefixed so it can never collide with one.
      id: '__loose',
      title:
        shelves.length === 0 && lead.length === 0
          ? 'All books'
          : selected
            ? `Also in ${selected.title}`
            : 'Also in the library',
      books: loose,
      children: [],
    })
  }

  return (
    <main className="page library">
      <div className="page-head">
        <h1>{selected ? selected.title : 'Library'}</h1>
        {/* Only when a shelf is being shown on its own, because that is
            the only time there is anywhere else to go. With nesting
            there is more than one somewhere: a child shelf's reader
            wants the shelf above it, not only the whole library. The
            trail below is the path down to here, itself excluded. */}
        {selected ? (
          <span className="page-head__note">
            <a href={href({ collection: undefined })}>Library</a>
            {trail.slice(0, -1).map((ancestor) => (
              <React.Fragment key={ancestor.id}>
                {' / '}
                <a href={href({ collection: ancestor.slug })}>{ancestor.title}</a>
              </React.Fragment>
            ))}
          </span>
        ) : null}
      </div>

      {selected?.description ? <p className="page-lede">{selected.description}</p> : null}

      <nav className="filters" aria-label="Reading level">
        {BOOK_LEVELS.map((value) => (
          <a
            key={value}
            href={href({ level: value })}
            title={LEVEL_DESCRIPTIONS[value]}
            aria-current={level === value ? 'true' : undefined}
          >
            {LEVEL_LABELS[value]}
          </a>
        ))}
      </nav>

      {books.length === 0 ? (
        <p className="empty">
          {collection
            ? 'No books in this collection yet.'
            : level === 'extensive'
              ? 'No books published yet.'
              : `No books at the ${LEVEL_LABELS[level].toLowerCase()} level yet — try Extensive to see the whole library.`}
        </p>
      ) : (
        <>
          {/* The selected collection's own books, unheaded: the page
              heading above is their heading. */}
          {lead.length > 0 ? (
            <ul className="shelf__books shelf__books--lead">
              {lead.map((book) => (
                <BookTile key={book.id} book={book} />
              ))}
            </ul>
          ) : null}

          <CollectionShelves shelves={shelves} />
        </>
      )}

      <div className="shelves__foot">
        <ShareCta />
      </div>
    </main>
  )
}
