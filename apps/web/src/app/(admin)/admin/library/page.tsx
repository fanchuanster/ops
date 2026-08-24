import React from 'react'

import { BookEditPanel, type BookEditValues } from '../../../../components/admin/BookEditPanel'
import { LibraryTree, type LibraryRow } from '../../../../components/admin/LibraryTree'
import { LibrarySearch } from '../../../../components/admin/LibrarySearch'
import {
  buildTree,
  depthOf,
  eligibleParents,
  flattenTree,
  parentIdOf,
} from '../../../../domain/collectionTree'
import { levelFromId } from '../../../../domain/levels'
import {
  countDeliveries,
  getAdminBook,
  getAdminCollections,
  getLibrary,
} from '../../../../lib/adminData'
import { requireAdmin } from '../../../../lib/adminAuth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Library' }

/**
 * The library: the shelves and the books on them, on one screen.
 *
 * Books and Collections were two screens until 2026-08-24, and the
 * design merged them. It is the right merge. They were never two
 * subjects — a book's shelf was edited on the Books screen and the
 * shelf itself on the Collections screen, so the two questions an
 * editor actually asks ("what is on this shelf" and "is this shelf
 * right") lived one navigation apart from each other. Worse, neither
 * screen could answer the one question the tree exists for: what a
 * reader finds when they open a collection.
 *
 * So the tree is the spine and books are rows on it, which is also what
 * `/books` shows a reader. An editor now arranges the library while
 * looking at the thing they are arranging.
 *
 * Selection is `?book=` rather than client state, as on the review
 * queue: it renders on the server, survives a save, gives every book
 * row a real link, and means the tree needs client state only for the
 * things that genuinely are ephemeral — which collection card is open
 * for editing, and whether an inline form is showing.
 *
 * Search filters the *books*, not the shelves. A shelf with no match
 * stays on the page with nothing under it rather than disappearing,
 * because the shelves are the map: a map that rearranges itself when
 * you search is not a map.
 */
export default async function AdminLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; book?: string }>
}) {
  await requireAdmin()
  const params = await searchParams
  const query = (params.q ?? '').trim()

  const [books, collections] = await Promise.all([
    // Every book, unfiltered: the search below runs over this list so
    // that an empty shelf still draws. Bounded by `getLibrary`'s own
    // page limit, which is what stops this being unbounded.
    getLibrary({ query: '', collectionId: null }),
    getAdminCollections(),
  ])
  const deliveries = await countDeliveries(books.map((book) => book.id))

  const selectedId = Number(params.book)
  const selected = Number.isInteger(selectedId) ? await getAdminBook(selectedId) : null

  const needle = query.toLowerCase()
  const matches = (book: (typeof books)[number]) =>
    needle === '' ||
    [book.title, book.originalTitle, book.author]
      .some((field) => (field ?? '').toLowerCase().includes(needle))

  // Which books sit directly on which shelf. One shelf each, so this
  // is a filing rather than a fan-out — a parent still shows the book,
  // by containing the shelf it is on.
  const direct = new Map<number, typeof books>()
  const shelved = new Set<number>()
  for (const book of books) {
    const ref = book.collection
    const id = typeof ref === 'object' && ref ? ref.id : ref
    if (typeof id !== 'number') continue
    const shelf = direct.get(id)
    if (shelf) shelf.push(book)
    else direct.set(id, [book])
    shelved.add(book.id)
  }

  const href = (extra: Record<string, string | null>) => {
    const next = new URLSearchParams()
    if (query) next.set('q', query)
    if (params.book) next.set('book', params.book)
    for (const [key, value] of Object.entries(extra)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const search = next.toString()
    return search ? `/admin/library?${search}` : '/admin/library'
  }

  const asBookRow = (book: (typeof books)[number]) => ({
    id: book.id,
    title: book.title,
    author: book.author ?? '',
    face: Array.from((book.originalTitle || book.title).trim())[0] ?? '·',
    level: levelFromId(book.level),
    published: book.visibility === 'public',
    sent: deliveries.get(book.id) ?? 0,
    href: href({ book: String(book.id) }),
  })

  const asOption = (collection: (typeof collections)[number]) => ({
    id: collection.id,
    title: collection.title,
    depth: depthOf(collections, collection.id),
  })

  // Flattened in tree order — a parent immediately before its children
  // — so the client renders one row per shelf and indents by depth,
  // rather than nesting components. Every rule about where a shelf may
  // be filed is decided here, on the server, where they already live.
  const tree = buildTree(collections)
  const rows: LibraryRow[] = flattenTree(tree).map((node) => {
    const siblings = collections.filter(
      (other) => parentIdOf(other) === parentIdOf(node.collection),
    )
    const own = direct.get(node.collection.id) ?? []

    return {
      id: node.collection.id,
      title: node.collection.title,
      description: node.collection.description ?? '',
      depth: node.depth,
      parentId: parentIdOf(node.collection),
      parentOptions: eligibleParents(collections, node.collection.id).map(asOption),
      first: siblings[0]?.id === node.collection.id,
      last: siblings[siblings.length - 1]?.id === node.collection.id,
      // What the shelf-levelling form says it is about to touch: the
      // whole subtree, counted once per book.
      booksInSubtree: subtreeBookCount(node, direct),
      books: own.filter(matches).map(asBookRow),
      hidden: own.length - own.filter(matches).length,
    }
  })

  // Every published book belongs to a shelf eventually, but not yet —
  // and a book nobody has filed is exactly the one an editor is looking
  // for. It goes last, under its own heading, rather than nowhere.
  const loose = books.filter((book) => !shelved.has(book.id))

  const shelves = collections.map((collection) => ({
    id: collection.id,
    title: collection.title,
  }))

  const shelfOf = (entry: unknown): number | null => {
    const id = typeof entry === 'object' && entry ? (entry as { id: number }).id : entry
    return typeof id === 'number' ? id : null
  }

  const editing: BookEditValues | null = selected
    ? {
        id: selected.id,
        title: selected.title,
        originalTitle: selected.originalTitle ?? '',
        author: selected.author ?? '',
        description: selected.description ?? '',
        level: levelFromId(selected.level),
        collectionId: shelfOf(selected.collection),
        slug: selected.slug,
        published: selected.visibility === 'public',
        sent: deliveries.get(selected.id) ?? 0,
      }
    : null

  return (
    <div className="admin-split">
      <div className="admin-pane">
        <header className="admin-head">
          <div>
            <h1>Library</h1>
            <p>
              {books.length} {books.length === 1 ? 'title' : 'titles'} on{' '}
              {collections.length} {collections.length === 1 ? 'shelf' : 'shelves'}
            </p>
          </div>
          <LibrarySearch query={query} />
        </header>

        <div className="admin-libcols" aria-hidden="true">
          <span>Book</span>
          <span>Level · Status · Sent</span>
        </div>

        <div className="admin-scroll">
          <LibraryTree
            rows={rows}
            loose={loose.filter(matches).map(asBookRow)}
            newParentOptions={eligibleParents(collections, null).map(asOption)}
            selectedBook={selected?.id ?? null}
          />
        </div>
      </div>

      {editing ? (
        <BookEditPanel book={editing} collections={shelves} closeHref={href({ book: null })} />
      ) : null}
    </div>
  )
}

/**
 * Books on this shelf and every shelf standing on it, counted once.
 *
 * By id rather than by adding lengths, because a book may be filed on a
 * parent and on one of its children at the same time and it is still
 * one book — the same reason the reader-facing count in
 * `CollectionShelves` is a Set.
 */
function subtreeBookCount(
  node: { collection: { id: number }; children: { collection: { id: number } }[] },
  direct: Map<number, { id: number }[]>,
): number {
  const seen = new Set<number>()
  const walk = (current: typeof node) => {
    for (const book of direct.get(current.collection.id) ?? []) seen.add(book.id)
    for (const child of current.children) walk(child as typeof node)
  }
  walk(node)
  return seen.size
}
