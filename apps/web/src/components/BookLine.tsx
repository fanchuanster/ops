import React from 'react'

import type { BookTileData } from './BookTile'

export function BookLine({ book }: { book: BookTileData }) {
  return (
    <li className="line">
      <a href={`/books/${book.slug}`}>
        <span className="line__title cjk">{book.title}</span>
        {book.author ? <span className="line__author">{book.author}</span> : null}
      </a>
    </li>
  )
}
