import React from 'react'

import { BookTile, type BookTileData } from './BookTile'

export interface ShelfNode {
  id: string
  title: string
  description?: string | null
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
  const books = booksUnder(shelf)
  if (books.length === 0) return null

  return (
    <section className="shelf" id={`shelf-${shelf.id}`}>
      <h2 className="shelf__name cjk">{shelf.title}</h2>
      {shelf.description ? <p className="shelf__lede">{shelf.description}</p> : null}
      <BookGrid books={books} newTab={newTab} />
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

function booksUnder(shelf: ShelfNode): BookTileData[] {
  const seen = new Set<string>()
  const books: BookTileData[] = []
  const walk = (node: ShelfNode) => {
    for (const book of node.books) {
      const id = String(book.id)
      if (seen.has(id)) continue
      seen.add(id)
      books.push(book)
    }
    for (const child of node.children) walk(child)
  }
  walk(shelf)
  return books
}
