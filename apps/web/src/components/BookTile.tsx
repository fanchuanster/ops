import React from 'react'

import { coverImageUrl, uploadedCoverId } from '../domain/cover'
import { readingFormat } from '../domain/publication'

export interface BookTileData {
  id: string | number
  slug: string
  title: string
  originalTitle?: string | null
  author?: string | null
  cover?: { url?: string | null; alt?: string | null } | string | number | null
  generatedCover?: {
    state?: string | null
    key?: string | null
    page?: number | null
    candidates?: number | null
  } | null
  artifacts?: { format: string }[] | null
}

export function BookTile({ book }: { book: BookTileData }) {
  const cover = coverImageUrl({
    uploadedId: uploadedCoverId(book.cover),
    bookId: book.id,
    generated: book.generatedCover ?? {},
  })
  const face = (book.originalTitle || book.title).trim()

  const readable = readingFormat((book.artifacts ?? []).map((a) => a.format)) !== null

  return (
    <li className="tile">
      <a href={readable ? `/read/${book.slug}` : `/books/${book.slug}`}>
        <span className="tile__face cjk" aria-hidden="true">
          {cover ? (
            <img src={cover} alt="" loading="lazy" />
          ) : (
            <span className="tile__glyph">{Array.from(face)[0] ?? '·'}</span>
          )}
        </span>
        <span className="tile__title">{book.title}</span>
      </a>
    </li>
  )
}
