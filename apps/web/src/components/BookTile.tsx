import React from 'react'

import { coverImageUrl, uploadedCoverId } from '../domain/cover'
import { LEVEL_LABELS, levelFromId } from '../domain/levels'

export interface BookTileData {
  id: string | number
  slug: string
  title: string
  author?: string | null
  cover?: { url?: string | null; alt?: string | null } | string | number | null
  generatedCover?: {
    state?: string | null
    key?: string | null
    page?: number | null
    candidates?: number | null
  } | null
  artifacts?: { format: string }[] | null
  level?: number | null
}

export function BookTile({
  book,
  showLevel = false,
  newTab = false,
}: {
  book: BookTileData
  showLevel?: boolean
  newTab?: boolean
}) {
  const cover = coverImageUrl({
    uploadedId: uploadedCoverId(book.cover),
    bookId: book.id,
    generated: book.generatedCover ?? {},
  })
  const face = book.title.trim()

  return (
    <li className="tile">
      <a
        href={`/books/${book.slug}`}
        target={newTab ? '_blank' : undefined}
        rel={newTab ? 'noopener' : undefined}
      >
        <span className="tile__face cjk" aria-hidden="true">
          {cover ? (
            <img src={cover} alt="" loading="lazy" />
          ) : (
            <span className="tile__glyph">{Array.from(face)[0] ?? '·'}</span>
          )}
        </span>
        <span className="tile__title">{book.title}</span>
        {showLevel && typeof book.level === 'number' ? (
          <span className="tile__level">{LEVEL_LABELS[levelFromId(book.level)]}</span>
        ) : null}
      </a>
    </li>
  )
}
