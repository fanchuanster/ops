import React from 'react'

import { CollectionSelect } from '../../../../components/admin/CollectionSelect'
import { LevelPill } from '../../../../components/admin/LevelPill'
import { LibraryFilters } from '../../../../components/admin/LibraryFilters'
import { levelFromId } from '../../../../domain/levels'
import { countDeliveries, getAdminCollections, getLibrary } from '../../../../lib/adminData'
import { requireAdmin } from '../../../../lib/adminAuth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Books' }

/**
 * The whole library, and the two things an editor changes about a book
 * from a list: its reading level and its shelf.
 *
 * Both are administrator fields, and both are set here rather than in
 * the CMS because they are *comparative* decisions — whether this book
 * is essential is a question about the books either side of it, which
 * a one-record form cannot show you.
 *
 * Everything else about a book still lives in the CMS. This screen
 * deliberately does not grow into a second editor for every field: it
 * is the shelf-arranging screen, and the moment it also edits titles
 * and covers it stops being scannable.
 */
export default async function AdminBooksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; collection?: string }>
}) {
  await requireAdmin()
  const params = await searchParams

  const query = (params.q ?? '').trim()
  const rawCollection = Number(params.collection)
  const collectionId = Number.isInteger(rawCollection) ? rawCollection : null

  const [books, collections] = await Promise.all([
    getLibrary({ query, collectionId }),
    getAdminCollections(),
  ])
  const deliveries = await countDeliveries(books.map((book) => book.id))

  return (
    <div className="admin-pane">
      <header className="admin-head">
        <div>
          <h1>Books</h1>
          <p>
            {books.length} {books.length === 1 ? 'title' : 'titles'}
            {query || collectionId !== null ? ' matching' : ' in the library'}
          </p>
        </div>
        <LibraryFilters
          query={query}
          collectionId={collectionId}
          collections={collections.map((c) => ({ id: c.id, title: c.title }))}
        />
      </header>

      <div className="admin-scroll">
        {books.length === 0 ? (
          <p className="admin-empty">Nothing matches that.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Book</th>
                <th className="admin-col--lg">Collection</th>
                <th>Level</th>
                <th className="admin-col--md">Where</th>
                <th className="admin-col--md admin-num">Sent</th>
              </tr>
            </thead>
            <tbody>
              {books.map((book) => {
                const face = Array.from((book.originalTitle || book.title).trim())[0] ?? '·'
                const shelf = (book.collections ?? [])
                  .map((entry) => (typeof entry === 'object' && entry ? entry.id : entry))
                  .find((id): id is number => typeof id === 'number')

                return (
                  <tr key={book.id}>
                    <td>
                      <span className="admin-bookcell">
                        <span className="admin-face cjk" aria-hidden="true">
                          {face}
                        </span>
                        <span>
                          <a className="admin-rowlink" href={`/books/${book.slug}`}>
                            {book.title}
                          </a>
                          {book.author ? <em>{book.author}</em> : null}
                        </span>
                      </span>
                    </td>
                    <td className="admin-col--lg">
                      <CollectionSelect
                        bookId={book.id}
                        current={shelf ?? null}
                        collections={collections.map((c) => ({ id: c.id, title: c.title }))}
                      />
                    </td>
                    <td>
                      <LevelPill bookId={book.id} level={levelFromId(book.level)} />
                    </td>
                    <td className="admin-col--md">
                      <span
                        className={`admin-chip-status admin-chip-status--${
                          book.visibility === 'public' ? 'approved' : 'unsubmitted'
                        }`}
                      >
                        {book.visibility === 'public' ? 'Public' : 'Private'}
                      </span>
                    </td>
                    <td className="admin-col--md admin-quiet admin-num">
                      {deliveries.get(book.id) ?? 0}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
