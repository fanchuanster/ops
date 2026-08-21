import React from 'react'

import { BookTile } from '../../../components/BookTile'
import { ShareCta } from '../../../components/ShareCta'
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
 * The catalog: one scrolling shelf per collection.
 *
 * This is the only place collections are browsed. There was a separate
 * `/collections` page listing them as cards until 2026-08-21; a
 * collection is not a peer of a book but the shelf a book stands on, so
 * listing the shelves separately asked a reader to choose between two
 * routes to the same thing. That page now redirects here.
 *
 * Filtering stays a plain link with a query string rather than
 * client-side state, so every filtered view is a real URL a reader can
 * bookmark or share, and the page ships no JavaScript to render.
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

  // One shelf per collection, from the single catalog query above
  // rather than one query per collection. A book in two collections
  // stands on both shelves, which is correct — it is in both.
  const shelves = collections
    .map((c) => ({
      collection: c,
      books: books.filter((book) =>
        (book.collections ?? []).some(
          (ref) => String(typeof ref === 'object' && ref ? ref.id : ref) === String(c.id),
        ),
      ),
    }))
    .filter((shelf) => shelf.books.length > 0)

  // Every published book belongs to a collection eventually, but not
  // today — so anything uncollected still gets a shelf rather than
  // being invisible in the library.
  const shelved = new Set(shelves.flatMap((s) => s.books.map((b) => String(b.id))))
  const loose = books.filter((book) => !shelved.has(String(book.id)))

  const selected = collection ? collections.find((c) => c.slug === collection) : null

  return (
    <main className="page">
      <div className="page-head">
        <h1>{selected ? selected.title : 'Library'}</h1>
        {/* Only when a shelf is being shown on its own, because that is
            the only time there is anywhere else to go. The design's
            heading row is otherwise just the word. */}
        {collection ? (
          <span className="page-head__note">
            <a href={href({ collection: undefined })}>The whole library →</a>
          </span>
        ) : null}
      </div>

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
      <p className="filter-note">{LEVEL_DESCRIPTIONS[level]}</p>

      {books.length === 0 ? (
        <p className="empty">
          {collection
            ? 'No books in this collection yet.'
            : level === 'extensive'
              ? 'No books published yet.'
              : `No books at the ${LEVEL_LABELS[level].toLowerCase()} level yet — try Extensive to see the whole library.`}
        </p>
      ) : (
        <div className="shelves">
          {shelves.map(({ collection: c, books: shelfBooks }) => (
            <section key={c.id}>
              <div className="shelf__head">
                <a href={href({ collection: c.slug })}>{c.title}</a>
                <span className="shelf__rule" />
              </div>
              <ul className="shelf__books">
                {shelfBooks.map((book) => (
                  <BookTile key={book.id} book={book} />
                ))}
              </ul>
            </section>
          ))}

          {loose.length > 0 ? (
            <section>
              <div className="shelf__head">
                <span>{shelves.length > 0 ? 'Also in the library' : 'All books'}</span>
                <span className="shelf__rule" />
              </div>
              <ul className="shelf__books">
                {loose.map((book) => (
                  <BookTile key={book.id} book={book} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <div className="shelves__foot">
        <ShareCta />
      </div>
    </main>
  )
}
