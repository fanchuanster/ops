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

const BOOK_GRID_COLUMNS = 4

export function BookGrid({
  books,
  newTab = false,
}: {
  books: BookTileData[]
  newTab?: boolean
}) {
  const covered = books.slice(0, BOOK_GRID_COLUMNS)
  const rest = books.slice(BOOK_GRID_COLUMNS)
  return (
    <>
      <ul className="book-grid">
        {covered.map((book) => (
          <BookTile key={book.id} book={book} showLevel newTab={newTab} />
        ))}
      </ul>
      {rest.length > 0 ? <BookTextList books={rest} newTab={newTab} /> : null}
    </>
  )
}

function BookTextList({ books, newTab }: { books: BookTileData[]; newTab: boolean }) {
  return (
    <ul className="book-list">
      {books.map((book) => (
        <li key={book.id} className="book-list__item">
          <a
            href={`/books/${book.slug}`}
            target={newTab ? '_blank' : undefined}
            rel={newTab ? 'noopener' : undefined}
          >
            {book.title}
            {book.author ? <span className="book-list__author"> - {book.author}</span> : null}
          </a>
        </li>
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
