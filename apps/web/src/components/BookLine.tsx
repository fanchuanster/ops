import React from 'react'

import { readingFormat } from '../domain/publication'
import type { BookTileData } from './BookTile'

/**
 * A book as one line of text: its title, then its author.
 *
 * This is the library's listing, where `BookTile` is the homepage's.
 * The two pages are doing different jobs and the design follows the
 * job. The homepage is showing a visitor what this library *is*, and a
 * cover is the fastest thing there is at that — a shelf of faces reads
 * as a bookshelf before a word of it is read. The library is where
 * somebody already convinced goes to *find* a book, across every shelf
 * at once, and there a cover is a 90px picture standing between the
 * reader and the name of the thing.
 *
 * What it buys, concretely: the whole tree fits in far less vertical
 * space, the author is back (the tile dropped it on 2026-08-24 because
 * at 0.625rem it was competing with the title), and a title is no
 * longer clamped to two lines — `南怀瑾选集 第七卷` keeps its volume
 * number, which is the half that tells two entries apart.
 *
 * It opens the book for the same reason the tile does: picking a book
 * off a shelf is picking it up to read. A book with no edition yet goes
 * to its page instead, since there is nothing to open.
 */
export function BookLine({ book }: { book: BookTileData }) {
  // The same rule the reader authorizes with, so a line never points at
  // a page that then refuses (`domain/publication.ts`).
  const readable = readingFormat((book.artifacts ?? []).map((a) => a.format)) !== null

  return (
    <li className="line">
      <a href={readable ? `/read/${book.slug}` : `/books/${book.slug}`}>
        <span className="line__title cjk">{book.title}</span>
        {book.author ? <span className="line__author">{book.author}</span> : null}
      </a>
    </li>
  )
}
