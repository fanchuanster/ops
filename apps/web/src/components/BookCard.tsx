import React from 'react'

export interface BookCardData {
  id: string | number
  slug: string
  title: string
  originalTitle?: string | null
  author?: string | null
  cover?: { url?: string | null; alt?: string | null } | string | number | null
}

/**
 * Covers are optional and often will be, since a scanned source rarely
 * yields a usable one. Rather than leaving a grey rectangle, the
 * fallback sets the original-script title as the cover — which for a
 * Chinese classic is closer to how the book actually presents itself
 * than a stock placeholder would be.
 */
export function BookCard({ book }: { book: BookCardData }) {
  const cover = typeof book.cover === 'object' && book.cover !== null ? book.cover : null
  const faceText = book.originalTitle || book.title

  return (
    <li className="book-card">
      <a href={`/books/${book.slug}`}>
        {cover?.url ? (
          <div className="book-card__cover">
            <img src={cover.url} alt={cover.alt || ''} loading="lazy" />
          </div>
        ) : (
          <div className="book-card__cover book-card__cover--empty cjk" aria-hidden="true">
            {faceText}
          </div>
        )}
        <h3>{book.title}</h3>
        {book.author ? <p>{book.author}</p> : null}
      </a>
    </li>
  )
}
