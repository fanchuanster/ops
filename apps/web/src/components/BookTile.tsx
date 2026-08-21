import React from 'react'

import { readingFormat } from '../domain/publication'

export interface BookTileData {
  id: string | number
  slug: string
  title: string
  originalTitle?: string | null
  author?: string | null
  cover?: { url?: string | null; alt?: string | null } | string | number | null
  artifacts?: { format: string }[] | null
}

/**
 * A book as a portrait tile: a 2:3 face, then title and author beneath.
 *
 * The face is the first character of the original-script title set large
 * on the band ground — which is the design's answer to a library whose
 * books mostly arrive as scans with no cover art. It is not a
 * placeholder standing in for a missing image; it is what a NobleSee
 * book looks like, and 論 at this size is more recognisable on a shelf
 * than a thumbnail of a scanned title page would be.
 *
 * A real cover still wins when there is one, because the slot is
 * already the right shape for it.
 *
 * This replaced a horizontal row card on 2026-08-21, when the design
 * moved its shelves to scrolling tiles. The row's argument — that a 2:3
 * cover leaves no room for text beside it at 375px — does not apply to
 * a tile, where the text is underneath and the shelf scrolls.
 *
 * **The tile opens the book, not a page about the book.** Picking a
 * book off a shelf is picking it up to read, and a landing page with a
 * "Read online" button on it was a turnstile in front of the one thing
 * this library is for. The details — rights, price, sending it to a
 * device — are still there, one link away from inside the reader.
 *
 * A book with no edition yet is the exception: there is nothing to
 * open, so it goes to its page rather than to a reader that would only
 * apologise.
 */
export function BookTile({ book }: { book: BookTileData }) {
  const cover = typeof book.cover === 'object' && book.cover !== null ? book.cover : null
  const face = (book.originalTitle || book.title).trim()

  // The same rule the reader authorizes with, so a tile never points at
  // a page that then refuses (`domain/publication.ts`).
  const readable = readingFormat((book.artifacts ?? []).map((a) => a.format)) !== null

  return (
    <li className="tile">
      <a href={readable ? `/read/${book.slug}` : `/books/${book.slug}`}>
        <span className="tile__face cjk" aria-hidden="true">
          {cover?.url ? (
            <img src={cover.url} alt="" loading="lazy" />
          ) : (
            // Array.from, not [0]: a character outside the BMP is two
            // UTF-16 code units, and slicing one off renders a tofu box.
            <span className="tile__glyph">{Array.from(face)[0] ?? '·'}</span>
          )}
        </span>
        <span className="tile__title">{book.title}</span>
        {book.author ? <span className="tile__author">{book.author}</span> : null}
      </a>
    </li>
  )
}
