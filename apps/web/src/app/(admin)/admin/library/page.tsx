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
import {
  chosenCoverPage,
  coverCandidatePages,
  coverImageUrl,
  coverSourceFormat,
  hasRenderedPages,
  uploadedCoverId,
} from '../../../../domain/cover'
import { levelFromId } from '../../../../domain/levels'
import { shelfSortFor, sortShelfItems } from '../../../../domain/shelfOrder'
import {
  countDeliveries,
  getAdminBook,
  getAdminCollections,
  getLibrary,
} from '../../../../lib/adminData'
import { requireAdmin } from '../../../../lib/adminAuth'
import { shortDate } from '../../../../lib/adminFormat'
import type { User } from '../../../../payload-types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Library' }

export default async function AdminLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; book?: string }>
}) {
  await requireAdmin()
  const params = await searchParams
  const query = (params.q ?? '').trim()

  const [books, collections] = await Promise.all([
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
    uploader: uploaderOf(book),
    uploaded: shortDate(book.createdAt),
    order: book.collectionOrder ?? null,
    href: href({ book: String(book.id) }),
  })

  const asOption = (collection: (typeof collections)[number]) => ({
    id: collection.id,
    title: collection.title,
    depth: depthOf(collections, collection.id),
  })

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
      sortOrder: node.collection.sortOrder ?? null,
      parentOptions: eligibleParents(collections, node.collection.id).map(asOption),
      first: siblings[0]?.id === node.collection.id,
      last: siblings[siblings.length - 1]?.id === node.collection.id,
      booksInSubtree: subtreeBookCount(node, direct),
      books: sortShelfItems(
        own.filter(matches).map((book) => ({ ...book, order: book.collectionOrder })),
        shelfSortFor({ childOrder: node.collection.childOrder }),
      ).map(asBookRow),
      hidden: own.length - own.filter(matches).length,
      childOrder: shelfSortFor({ childOrder: node.collection.childOrder }),
    }
  })

  const loose = books.filter((book) => !shelved.has(book.id))

  const shelves = collections.map((collection) => ({
    id: collection.id,
    title: collection.title,
  }))

  const shelfOf = (entry: unknown): number | null => {
    const id = typeof entry === 'object' && entry ? (entry as { id: number }).id : entry
    return typeof id === 'number' ? id : null
  }

  const uploadedCover = selected ? uploadedCoverId(selected.cover) : null

  const editing: BookEditValues | null = selected
    ? {
        id: selected.id,
        title: selected.title,
        originalTitle: selected.originalTitle ?? '',
        author: selected.author ?? '',
        description: selected.description ?? '',
        level: levelFromId(selected.level),
        collectionId: shelfOf(selected.collection),
        collectionOrder: selected.collectionOrder ?? null,
        slug: selected.slug,
        published: selected.visibility === 'public',
        sent: deliveries.get(selected.id) ?? 0,
        uploader: uploaderOf(selected),
        uploaderEmail: uploaderEmailOf(selected),
        uploaded: shortDate(selected.createdAt),
        coverUrl: coverImageUrl({
          uploadedId: uploadedCover,
          bookId: selected.id,
          generated: selected.generatedCover ?? {},
        }),
        hasUploadedCover: uploadedCover !== null,
        coverPage: chosenCoverPage(selected.generatedCover ?? {}),
        coverPages: coverCandidatePages(selected.generatedCover ?? {}),
        hasRenderedCover: hasRenderedPages(selected.generatedCover ?? {}),
        canMakeCover:
          coverSourceFormat((selected.artifacts ?? []).map((a) => a.format)) !== null,
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
          <span>Uploaded by · When · Level · Status · Sent</span>
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

function uploaderOf(book: { owner?: unknown }): string | null {
  const owner = typeof book.owner === 'object' ? (book.owner as User | null) : null
  if (!owner) return null
  return owner.displayName || owner.email || null
}

function uploaderEmailOf(book: { owner?: unknown }): string | null {
  const owner = typeof book.owner === 'object' ? (book.owner as User | null) : null
  if (!owner?.email) return null
  return owner.displayName ? owner.email : null
}
