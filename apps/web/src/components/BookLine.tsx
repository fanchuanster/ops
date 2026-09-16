import React from 'react'

import { readingFormat } from '../domain/publication'
import type { BookTileData } from './BookTile'

export function BookLine({ book }: { book: BookTileData }) {
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
