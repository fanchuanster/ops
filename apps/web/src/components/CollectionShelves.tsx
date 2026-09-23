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
  if (countBooks(shelf) === 0) return null

  return (
    <section className="shelf" id={`shelf-${shelf.id}`}>
      <h2 className="shelf__name cjk">{shelf.title}</h2>
      <ShelfBody shelf={shelf} newTab={newTab} />
    </section>
  )
}

function SubShelf({ shelf, newTab }: { shelf: ShelfNode; newTab: boolean }) {
  if (countBooks(shelf) === 0) return null

  return (
    <section className="subshelf" id={`shelf-${shelf.id}`}>
      <h3 className="subshelf__name cjk">{shelf.title}</h3>
      <ShelfBody shelf={shelf} newTab={newTab} />
    </section>
  )
}

function ShelfBody({ shelf, newTab }: { shelf: ShelfNode; newTab: boolean }) {
  return (
    <>
      {shelf.description ? <p className="shelf__lede">{shelf.description}</p> : null}
      {shelf.books.length > 0 ? <BookGrid books={shelf.books} newTab={newTab} /> : null}
      {shelf.children.map((child) => (
        <SubShelf key={child.id} shelf={child} newTab={newTab} />
      ))}
    </>
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
