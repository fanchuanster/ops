import React from 'react'

import { BookTile, type BookTileData } from '../../../components/BookTile'
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
  const direct = new Map<string, BookTileData[]>()
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

  const toShelf = (node: TreeNode<(typeof collections)[number]>): ShelfNode => ({
    id: String(node.collection.id),
    title: node.collection.title,
    books: direct.get(String(node.collection.id)) ?? [],
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
  const lead = selected ? (direct.get(String(selected.id)) ?? []) : []

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
