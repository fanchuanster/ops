import React from 'react'

import { coverImageUrl, uploadedCoverId } from '../domain/cover'
import { readingFormat } from '../domain/publication'

export interface BookTileData {
  id: string | number
  slug: string
  title: string
  originalTitle?: string | null
  cover?: { url?: string | null; alt?: string | null } | string | number | null
  /** Page one, rendered by the converter when nobody uploaded a cover. */
  generatedCover?: {
    state?: string | null
    key?: string | null
    // Which of the rendered pages this book wears, so a tile shows the
    // chosen cover rather than always page one (`domain/cover.ts`).
    page?: number | null
    candidates?: number | null
  } | null
  artifacts?: { format: string }[] | null
}

/**
 * A book as a portrait tile: a 2:3 face, then the title beneath it.
 *
 * The author was under the title until 2026-08-24 and is gone. A shelf
 * is scanned rather than read, and at 0.625rem in the library's tiles
 * the second line was competing with the one that actually identifies
 * the book. What it cost was a truncated title; what it bought was a
 * name nobody could finish reading. The title now gets both lines.
 *
 * The face has three answers, in order: an uploaded cover, page one of
 * the book, and — when there is neither — the first character of the
 * original-script title set large on the band ground.
 *
 * That last one is not a placeholder standing in for a missing image;
 * it is what a NobleSee book looks like, and 論 at this size is more
 * recognisable on a shelf than nothing is. It used to be the answer for
 * every scan, on the argument that a glyph beats a thumbnail of a title
 * page. Page one changed the terms: a scan's first page *is* the book's
 * cover, printed by whoever published it, so it is a real cover and not
 * a thumbnail of a stand-in (`domain/cover.ts`).
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
  // An uploaded cover, then the chosen page of the book, then neither —
  // at which point the face below is what a NobleSee book looks like
  // (`domain/cover.ts`). Both are served by `/covers/<id>`, so a tile
  // for a book this reader may not see shows the face, not a picture.
  const cover = coverImageUrl({
    uploadedId: uploadedCoverId(book.cover),
    bookId: book.id,
    generated: book.generatedCover ?? {},
  })
  const face = (book.originalTitle || book.title).trim()

  // The same rule the reader authorizes with, so a tile never points at
  // a page that then refuses (`domain/publication.ts`).
  const readable = readingFormat((book.artifacts ?? []).map((a) => a.format)) !== null

  return (
    <li className="tile">
      <a href={readable ? `/read/${book.slug}` : `/books/${book.slug}`}>
        <span className="tile__face cjk" aria-hidden="true">
          {cover ? (
            <img src={cover} alt="" loading="lazy" />
          ) : (
            // Array.from, not [0]: a character outside the BMP is two
            // UTF-16 code units, and slicing one off renders a tofu box.
            <span className="tile__glyph">{Array.from(face)[0] ?? '·'}</span>
          )}
        </span>
        <span className="tile__title">{book.title}</span>
      </a>
    </li>
  )
}
