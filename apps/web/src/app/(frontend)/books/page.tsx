import React from 'react'

import { BookLine } from '../../../components/BookLine'
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
import { CATALOG_LIMIT, getCatalog, getCollections } from '../../../lib/catalog'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Library' }

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
    if (nextLevel !== DEFAULT_BROWSE_LEVEL) query.set('level', nextLevel)
    const qs = query.toString()
    return qs ? `/books?${qs}` : '/books'
  }

  const [{ books }, collections] = await Promise.all([
    getCatalog({ collectionSlug: collection, level, limit: CATALOG_LIMIT }),
    getCollections(),
  ])

  const selected = collection ? collections.find((c) => c.slug === collection) : null
  const trail = selected ? ancestryOf(collections, selected.id) : []

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
    books: onShelf(node.collection, String(node.collection.id)),
    children: node.children.map(toShelf),
  })

  const tree = buildTree(collections)

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
      <div className="page-head">
        <h1>{selected ? selected.title : 'Library'}</h1>
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
          {lead.length > 0 ? (
            <ul className="shelf__lines shelf__lines--lead">
              {lead.map((book) => (
                <BookLine key={book.id} book={book} />
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
