import React from 'react'

import { BookEditPanel, type BookEditValues } from '../../../../components/admin/BookEditPanel'
import { LevelPill } from '../../../../components/admin/LevelPill'
import { LibraryFilters } from '../../../../components/admin/LibraryFilters'
import { levelFromId } from '../../../../domain/levels'
import {
  countDeliveries,
  getAdminBook,
  getAdminCollections,
  getLibrary,
} from '../../../../lib/adminData'
import { requireAdmin } from '../../../../lib/adminAuth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Books' }

/**
 * The whole library, and a panel for editing one book in it.
 *
 * A list and a detail panel, as the design draws it — and the panel is
 * chosen with `?book=` rather than with client-side selection, the same
 * way the review queue does it. A query parameter renders on the
 * server, survives a save, gives every row a real link, and keeps the
 * list itself entirely free of client state.
 *
 * The screen used to edit two things in the rows — level and shelf —
 * and send an editor to the CMS for everything else, on the argument
 * that a shelf-arranging list stops being scannable the moment it also
 * edits titles. The list is still exactly that; the editing moved into
 * a panel beside it. The level pill stays in the row all the same,
 * because levelling is a *comparative* decision — whether this book is
 * essential is a question about the books either side of it — and that
 * is the one judgement a detail panel cannot show you.
 *
 * What the panel does not offer is visibility. A book is in the public
 * library because a reviewer approved it (`actions/review.ts`), and a
 * second control that could contradict that would only be a way to
 * publish something the rights never cleared.
 */
export default async function AdminBooksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; collection?: string; book?: string }>
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

  // Fetched separately rather than picked out of the list: a save may
  // have moved the book out of the current filter, and the panel should
  // still show what happened rather than closing itself.
  const selectedId = Number(params.book)
  const selected = Number.isInteger(selectedId) ? await getAdminBook(selectedId) : null

  const shelfOf = (entries: unknown): number | null =>
    ((entries ?? []) as (number | { id: number } | null)[])
      .map((entry) => (typeof entry === 'object' && entry ? entry.id : entry))
      .find((id): id is number => typeof id === 'number') ?? null

  const href = (extra: Record<string, string | null>) => {
    const next = new URLSearchParams()
    if (query) next.set('q', query)
    if (collectionId !== null) next.set('collection', String(collectionId))
    if (params.book) next.set('book', params.book)
    for (const [key, value] of Object.entries(extra)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const search = next.toString()
    return search ? `/admin/books?${search}` : '/admin/books'
  }

  const shelves = collections.map((collection) => ({ id: collection.id, title: collection.title }))

  const editing: BookEditValues | null = selected
    ? {
        id: selected.id,
        title: selected.title,
        originalTitle: selected.originalTitle ?? '',
        author: selected.author ?? '',
        description: selected.description ?? '',
        level: levelFromId(selected.level),
        collectionId: shelfOf(selected.collections),
        slug: selected.slug,
      }
    : null

  return (
    <div className="admin-split">
      <div className="admin-pane">
        <header className="admin-head">
          <div>
            <h1>Books</h1>
            <p>
              {books.length} {books.length === 1 ? 'title' : 'titles'}
              {query || collectionId !== null ? ' matching' : ' in the library'}
            </p>
          </div>
          <LibraryFilters query={query} collectionId={collectionId} collections={shelves} />
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
                  <th className="admin-col--md">Status</th>
                  <th className="admin-col--md admin-num">Sent</th>
                </tr>
              </thead>
              <tbody>
                {books.map((book) => {
                  const face = Array.from((book.originalTitle || book.title).trim())[0] ?? '·'
                  const shelf = shelfOf(book.collections)
                  const shelfName = shelves.find((entry) => entry.id === shelf)?.title
                  const published = book.visibility === 'public'

                  return (
                    <tr
                      key={book.id}
                      className="admin-row"
                      data-selected={selected?.id === book.id ? 'true' : undefined}
                    >
                      <td>
                        <span className="admin-bookcell">
                          <span className="admin-face cjk" aria-hidden="true">
                            {face}
                          </span>
                          <span>
                            {/* The stretched link is what makes the whole
                                row open the panel while still being one
                                link a keyboard can reach. */}
                            <a className="admin-rowlink" href={href({ book: String(book.id) })}>
                              {book.title}
                            </a>
                            {book.author ? <em>{book.author}</em> : null}
                          </span>
                        </span>
                      </td>
                      <td className="admin-col--lg admin-quiet">
                        {shelfName ?? <span className="admin-quiet">No collection</span>}
                      </td>
                      <td>
                        {/* Still saved on click, still in the row. The
                            panel can set a level too; this is the one
                            that lets an editor level a shelf by reading
                            down it. */}
                        <LevelPill bookId={book.id} level={levelFromId(book.level)} />
                      </td>
                      <td className="admin-col--md">
                        <span
                          className={`admin-chip-status admin-chip-status--${
                            published ? 'approved' : 'unsubmitted'
                          }`}
                        >
                          {published ? 'Published' : 'Draft'}
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

      {editing ? (
        <BookEditPanel
          book={editing}
          collections={shelves}
          closeHref={href({ book: null })}
        />
      ) : null}
    </div>
  )
}
