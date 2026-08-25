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
import {
  shelfSortFor,
  SHELF_SORTS,
  SHELF_SORT_DESCRIPTIONS,
  SHELF_SORT_LABELS,
  parseShelfSort,
  sortShelfItems,
} from '../../../domain/shelfOrder'
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
 * The reading-level filter is not in the design, and is kept anyway —
 * levels are a product feature (CLAUDE.md section 5.1), and a reader
 * browsing at `essential` has no other way to widen the shelf.
 */
/** A book as the catalog hands it over — a tile's data, and its order id. */
type CatalogBook = Awaited<ReturnType<typeof getCatalog>>['books'][number]

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string; level?: string; sort?: string }>
}) {
  const params = await searchParams
  const collection = params.collection
  const level = parseBrowseLevel(params.level)
  const sort = parseShelfSort(params.sort)

  const href = (next: { collection?: string; level?: string; sort?: string }) => {
    const query = new URLSearchParams()
    const nextCollection = 'collection' in next ? next.collection : collection
    const nextLevel = next.level ?? level
    // `sort: undefined` passed explicitly means "clear the override",
    // which is not the same as the key being absent — that means
    // "leave it as it is". `in` tells the two apart.
    const nextSort = 'sort' in next ? next.sort : sort
    if (nextCollection) query.set('collection', nextCollection)
    // The default reads as no filter at all, so it stays out of the URL.
    if (nextLevel !== DEFAULT_BROWSE_LEVEL) query.set('level', nextLevel)
    // No `sort=` means "let each shelf decide", which is the ordinary
    // visit and stays out of the URL.
    if (nextSort) query.set('sort', nextSort)
    const qs = query.toString()
    return qs ? `/books?${qs}` : '/books'
  }

  const [{ books }, collections] = await Promise.all([
    getCatalog({ collectionSlug: collection, level, sort }),
    // Every shelf, in a stable order. Which order a reader sees is
    // decided per shelf below, from its own `childOrder`.
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
      shelfSortFor({ readerSort: sort, childOrder: shelf?.childOrder }),
    )

  // A shelf's sub-shelves are its children too, so they take the same
  // rule its books do. `buildTree` keeps whatever order it is given, so
  // sorting the group here is what decides the order on the page.
  const orderChildren = (
    parent: (typeof collections)[number] | null,
    nodes: TreeNode<(typeof collections)[number]>[],
  ) =>
    sortShelfItems(
      nodes.map((node) => ({
        node,
        id: node.collection.id,
        title: node.collection.title,
        order: node.collection.sortOrder,
      })),
      shelfSortFor({ readerSort: sort, childOrder: parent?.childOrder }),
    ).map((entry) => entry.node)

  const toShelf = (node: TreeNode<(typeof collections)[number]>): ShelfNode => ({
    id: String(node.collection.id),
    title: node.collection.title,
    books: onShelf(node.collection, String(node.collection.id)),
    children: orderChildren(node.collection, node.children).map(toShelf),
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
  // Root shelves have no parent to carry a `childOrder`, so they take
  // the library's own default rather than inheriting from nowhere.
  const shelves = orderChildren(
    selectedNode ? selectedNode.collection : null,
    selectedNode ? selectedNode.children : tree,
  ).map(toShelf)
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

      <div className="filter-row">
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

        {/* A link with a query string, like the level beside it and for
            the same reason: how a shelf is ordered is part of the view,
            so it stays in the URL and every ordering of the library
            remains bookmarkable.

            Three options rather than two, because the first one is a
            real answer and not the absence of one: each shelf reads the
            way its curator set it, which for most of them is A–Z and
            for a volume set is volume order. The other two force one
            rule across the whole page. */}
        <nav className="filters filters--sort" aria-label="Order">
          <a
            href={href({ sort: undefined })}
            title="Each shelf in the order its curator chose"
            aria-current={sort === null ? 'true' : undefined}
          >
            As arranged
          </a>
          {SHELF_SORTS.map((value) => (
            <a
              key={value}
              href={href({ sort: value })}
              title={SHELF_SORT_DESCRIPTIONS[value]}
              aria-current={sort === value ? 'true' : undefined}
            >
              {SHELF_SORT_LABELS[value]}
            </a>
          ))}
        </nav>
      </div>

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
