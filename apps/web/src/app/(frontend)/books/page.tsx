import React from 'react'

import { BookCard } from '../../../components/BookCard'
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
 * The catalog. Filtering is a plain link with a query string rather
 * than client-side state, so every filtered view is a real URL a reader
 * can bookmark or share, and the page ships no JavaScript to render.
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

  return (
    <main className="page">
      <div className="section-head">
        <h2>Library</h2>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.875rem', color: 'var(--ink-faint)' }}>
          {books.length} {books.length === 1 ? 'book' : 'books'}
        </span>
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

      {collections.length > 0 ? (
        <nav className="filters" aria-label="Filter by collection">
          <a href={href({ collection: undefined })} aria-current={!collection ? 'true' : undefined}>
            All
          </a>
          {collections.map((c) => (
            <a
              key={c.id}
              href={href({ collection: c.slug })}
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
            : level === 'extensive'
              ? 'No books published yet.'
              : `No books at the ${LEVEL_LABELS[level].toLowerCase()} level yet — try Extensive to see the whole library.`}
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
