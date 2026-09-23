import React from 'react'

import { CollectionShelves, BookGrid, type ShelfNode } from '../../../components/CollectionShelves'
import {
  ancestryOf,
  buildTree,
  flattenTree,
  pruneEmpty,
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
import {
  CATALOG_LIMIT,
  getCatalog,
  getCollections,
  getStockedCollectionIds,
} from '../../../lib/catalog'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Library' }

type CatalogBook = Awaited<ReturnType<typeof getCatalog>>['books'][number]

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string; level?: string; q?: string }>
}) {
  const params = await searchParams
  const collection = params.collection
  const level = parseBrowseLevel(params.level)
  const asked = params.q?.trim() ?? ''

  const href = (next: { collection?: string; level?: string; q?: string }) => {
    const query = new URLSearchParams()
    const nextCollection = 'collection' in next ? next.collection : collection
    const nextLevel = next.level ?? level
    const nextAsked = 'q' in next ? next.q : asked
    if (nextCollection) query.set('collection', nextCollection)
    if (nextLevel !== DEFAULT_BROWSE_LEVEL) query.set('level', nextLevel)
    if (nextAsked) query.set('q', nextAsked)
    const qs = query.toString()
    return qs ? `/books?${qs}` : '/books'
  }

  const [{ books }, collections, stocked] = await Promise.all([
    getCatalog({ collectionSlug: collection, level, query: asked, limit: CATALOG_LIMIT }),
    getCollections(),
    getStockedCollectionIds(level),
  ])

  const selected = collection ? collections.find((c) => c.slug === collection) : null
  const ancestors = selected ? ancestryOf(collections, selected.id).slice(0, -1) : []

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

  const onShelf = (shelf: (typeof collections)[number] | null, id: string) =>
    sortShelfItems(
      (direct.get(id) ?? []).map((book) => ({ ...book, order: book.collectionOrder })),
      shelfSortFor({ childOrder: shelf?.childOrder }),
    )

  const toShelf = (node: TreeNode<(typeof collections)[number]>): ShelfNode => ({
    id: String(node.collection.id),
    title: node.collection.title,
    description: node.collection.description,
    books: onShelf(node.collection, String(node.collection.id)),
    children: node.children.map(toShelf),
  })

  const tree = buildTree(collections)
  const navTree = pruneEmpty(tree, stocked)

  const selectedNode = selected
    ? (flattenTree(tree).find((node) => node.collection.id === selected.id) ?? null)
    : null
  const shelves = (selectedNode ? selectedNode.children : tree).map(toShelf)
  const lead = selected ? onShelf(selected, String(selected.id)) : []

  const loose = books.filter((book) => !placed.has(String(book.id)))
  if (loose.length > 0) {
    shelves.push({
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
      {selected ? (
        <div className="page-head">
          <h1 className="cjk">{selected.title}</h1>
          {ancestors.length > 0 ? (
            <span className="page-head__note">
              {ancestors.map((ancestor, index) => (
                <React.Fragment key={ancestor.id}>
                  {index > 0 ? ' / ' : null}
                  <a href={href({ collection: ancestor.slug })}>{ancestor.title}</a>
                </React.Fragment>
              ))}
            </span>
          ) : null}
        </div>
      ) : (
        <h1 className="visually-hidden">Library</h1>
      )}

      {selected?.description ? <p className="page-lede">{selected.description}</p> : null}

      <div className="depth">
        <span className="depth__label">Reading depth:</span>
        <nav className="depth__levels" aria-label="Reading level">
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
      </div>

      <div className={navTree.length > 0 ? 'library__body' : 'library__body library__body--bare'}>
        {navTree.length > 0 ? (
          <nav className="library__tree" aria-label="Collections">
            <p className="library__tree-head">Collections</p>
            {navTree.map((node) => (
              <React.Fragment key={node.collection.id}>
                <a
                  className="library__tree-shelf cjk"
                  href={href({ collection: node.collection.slug })}
                  aria-current={selected?.id === node.collection.id ? 'page' : undefined}
                >
                  {node.collection.title}
                </a>
                {node.children.map((child) => (
                  <a
                    key={child.collection.id}
                    className="library__tree-sub cjk"
                    href={href({ collection: child.collection.slug })}
                    aria-current={selected?.id === child.collection.id ? 'page' : undefined}
                  >
                    {child.collection.title}
                  </a>
                ))}
              </React.Fragment>
            ))}
          </nav>
        ) : null}

        <div className="library__main">
          {asked ? (
            <p className="library__asked">
              {books.length === 0
                ? `Nothing matches “${asked}”.`
                : `${books.length} ${books.length === 1 ? 'book' : 'books'} matching “${asked}”.`}{' '}
              <a href={href({ q: '' })}>Show everything</a>
            </p>
          ) : null}

          {books.length === 0 ? (
            asked ? null : (
              <p className="empty">
                {collection
                  ? 'No books in this collection yet.'
                  : level === 'extensive'
                    ? 'No books published yet.'
                    : `No books at the ${LEVEL_LABELS[level].toLowerCase()} level yet — try Extensive to see the whole library.`}
              </p>
            )
          ) : (
            <>
              {lead.length > 0 ? <BookGrid books={lead} newTab={Boolean(asked)} /> : null}

              <CollectionShelves shelves={shelves} newTab={Boolean(asked)} />
            </>
          )}
        </div>
      </div>
    </main>
  )
}
