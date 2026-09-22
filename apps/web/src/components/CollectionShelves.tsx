import React from 'react'

import { BookTile, type BookTileData } from './BookTile'

export interface ShelfNode {
  id: string
  title: string
  href: string
  books: BookTileData[]
  children: ShelfNode[]
}

export function CollectionShelves({
  shelves,
  newTab = false,
}: {
  shelves: ShelfNode[]
  newTab?: boolean
}) {
  return (
    <div className="shelves">
      {shelves.map((shelf) => (
        <Shelf key={shelf.id} shelf={shelf} newTab={newTab} />
      ))}
    </div>
  )
}

function Shelf({ shelf, newTab }: { shelf: ShelfNode; newTab: boolean }) {
  if (countBooks(shelf) === 0) return null

  const branches = shelf.children.filter((child) => countBooks(child) > 0)

  return (
    <section className="shelf" id={`shelf-${shelf.id}`}>
      <h2 className="shelf__name cjk">{shelf.title}</h2>

      {shelf.books.length > 0 ? <BookGrid books={shelf.books} newTab={newTab} /> : null}

      {branches.length > 0 ? (
        <ul className="branches">
          {branches.map((child) => {
            const total = countBooks(child)
            return (
              <li key={child.id}>
                <a
                  href={child.href}
                  target={newTab ? '_blank' : undefined}
                  rel={newTab ? 'noopener' : undefined}
                >
                  <span className="branches__name cjk">{child.title}</span>
                  <span className="branches__count">
                    {total} {total === 1 ? 'volume' : 'volumes'}
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}

export function BookGrid({
  books,
  newTab = false,
}: {
  books: BookTileData[]
  newTab?: boolean
}) {
  return (
    <ul className="book-grid">
      {books.map((book) => (
        <BookTile key={book.id} book={book} showLevel newTab={newTab} />
      ))}
    </ul>
  )
}

function countBooks(shelf: ShelfNode): number {
  const seen = new Set<string>()
  const walk = (node: ShelfNode) => {
    for (const book of node.books) seen.add(String(book.id))
    for (const child of node.children) walk(child)
  }
  walk(shelf)
  return seen.size
}
