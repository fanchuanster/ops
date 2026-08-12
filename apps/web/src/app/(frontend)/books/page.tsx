import React from 'react'

import { BookCard } from '../../../components/BookCard'
import { getCatalog, getCollections } from '../../../lib/catalog'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Library' }

/**
 * The catalog. Filtering is a plain link with a query string rather
 * than client-side state, so every filtered view is a real URL a reader
 * can bookmark or share, and the page ships no JavaScript to render.
 */
export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string }>
}) {
  const { collection } = await searchParams
  const [{ books }, collections] = await Promise.all([
    getCatalog({ collectionSlug: collection }),
    getCollections(),
  ])

  return (
    <main className="page">
      <div className="section-head">
        <h2>Library</h2>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.875rem', color: 'var(--ink-faint)' }}>
          {books.length} {books.length === 1 ? 'book' : 'books'}
        </span>
      </div>

      {collections.length > 0 ? (
        <nav className="filters" aria-label="Filter by collection">
          <a href="/books" aria-current={!collection ? 'true' : undefined}>
            All
          </a>
          {collections.map((c) => (
            <a
              key={c.id}
              href={`/books?collection=${encodeURIComponent(c.slug)}`}
              aria-current={collection === c.slug ? 'true' : undefined}
            >
              {c.title}
            </a>
          ))}
        </nav>
      ) : null}

      {books.length === 0 ? (
        <p className="empty">
          {collection
            ? 'No books in this collection yet.'
            : 'No books published yet.'}
        </p>
      ) : (
        <ul className="book-grid">
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </ul>
      )}
    </main>
  )
}
