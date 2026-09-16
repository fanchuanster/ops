'use client'

import React, { useState } from 'react'

import { BookLine } from './BookLine'
import type { BookTileData } from './BookTile'

export interface ShelfNode {
  id: string
  title: string
  books: BookTileData[]
  children: ShelfNode[]
}

export function CollectionShelves({ shelves }: { shelves: ShelfNode[] }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="shelves">
      {shelves.map((shelf) => (
        <Shelf
          key={shelf.id}
          shelf={shelf}
          depth={0}
          collapsed={collapsed}
          onToggle={toggle}
        />
      ))}
    </div>
  )
}

function Shelf({
  shelf,
  depth,
  collapsed,
  onToggle,
}: {
  shelf: ShelfNode
  depth: number
  collapsed: ReadonlySet<string>
  onToggle: (id: string) => void
}) {
  const open = !collapsed.has(shelf.id)
  const panelId = `shelf-${shelf.id}`

  const total = countBooks(shelf)

  if (total === 0) return null

  const head =
    depth === 0 ? (
      <h2 className="shelf__name">{shelf.title}</h2>
    ) : (
      <span className="shelf__name">{shelf.title}</span>
    )

  return (
    <section
      className={depth === 0 ? 'shelf shelf--root' : 'shelf shelf--nested'}
      style={{ '--depth': depth } as React.CSSProperties}
    >
      <div className="shelf__head">
        <button
          type="button"
          className="shelf__toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onToggle(shelf.id)}
        >
          <Chevron open={open} />
          {head}
          {depth > 0 ? (
            <span className="shelf__count">
              {total}
              <span className="visually-hidden"> {total === 1 ? 'book' : 'books'}</span>
            </span>
          ) : null}
        </button>
        <span className="shelf__rule" />
      </div>

      <div id={panelId} className="shelf__body" hidden={!open}>
        {shelf.books.length > 0 ? (
          <ul className="shelf__lines">
            {shelf.books.map((book) => (
              <BookLine key={book.id} book={book} />
            ))}
          </ul>
        ) : null}

        {shelf.children.map((child) => (
          <Shelf
            key={child.id}
            shelf={child}
            depth={depth + 1}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? 'chevron chevron--open' : 'chevron'}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 2l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
