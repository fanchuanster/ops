import React from 'react'

import { BookCard } from '../../components/BookCard'
import { getCatalog } from '../../lib/catalog'

// Rendered per-request: it queries the database, which is deliberately
// not reachable during `next build`.
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const { books } = await getCatalog({ limit: 8 })

  return (
    <main className="page">
      <section className="hero">
        <h1>Books worth reading, made comfortable to read.</h1>
        <p>
          Many valuable books — traditional Chinese classics, history, works on wisdom and living
          well — survive online only as scanned pages. NobleSee rebuilds them as clean, reflowable
          editions you can actually read: on a phone, on a Kindle, in the dark.
        </p>
      </section>

      <div className="section-head">
        <h2>From the library</h2>
        <a href="/books">All books →</a>
      </div>

      {books.length === 0 ? (
        <p className="empty">
          No books published yet. Add one in the <a href="/admin">admin</a>.
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
