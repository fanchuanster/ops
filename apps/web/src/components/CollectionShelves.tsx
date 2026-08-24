'use client'

import React, { useState } from 'react'

import { BookTile, type BookTileData } from './BookTile'

/**
 * One shelf in the library tree: a collection, the books filed directly
 * on it, and the shelves standing on it.
 *
 * Deliberately serialisable and free of Payload types — the page is a
 * server component and this crosses the boundary as plain JSON.
 */
export interface ShelfNode {
  id: string
  title: string
  /** Books filed *directly* on this collection, not on its children. */
  books: BookTileData[]
  children: ShelfNode[]
}

/**
 * The whole library as one collapsible tree.
 *
 * This replaced a one-level-at-a-time drill-down on 2026-08-24, from
 * the Figma design (`Enhance Upload Flow UI`, `LibraryPage`). The old
 * shape showed root shelves in the library and a collection's own
 * children once you were inside it, on the argument — written into
 * CLAUDE.md 5.3 — that a nested library rendered flat is a wall of
 * every shelf at once.
 *
 * That argument was right about the wall and wrong about the remedy.
 * Collapsing answers it directly: a reader who wants "Chinese Classics"
 * folded away folds it away, and everything else stays where it is.
 * Drilling down answered it by hiding the library behind a click and
 * making a reader guess which shelf was worth opening.
 *
 * What it costs is the page's zero-JavaScript rendering, which is why
 * the reading-level filter beside it is still a plain link with a query
 * string: the *state a reader would want to share* stays in the URL,
 * and only the fold — which is a per-reader convenience, not a view —
 * lives in the browser.
 *
 * Each node renders only its own books. A parent carries its
 * descendants by containing them visually rather than by absorbing
 * their books, so nothing appears twice; that is also what the design
 * does.
 *
 * A nested shelf's heading carries the number of books under it, its
 * own sub-shelves included. Root shelves do not: "Authors" is a
 * container, and a count beside every top-level heading reads as an
 * inventory rather than as a library.
 *
 * A shelf heading here is a fold, not a link — as designed. The
 * drill-down URL it used to be is still reachable: the homepage's
 * teaser shelves link to `/books?collection=`, which narrows this tree
 * to one subtree and puts a breadcrumb above it.
 */
export function CollectionShelves({ shelves }: { shelves: ShelfNode[] }) {
  // Collapsed rather than expanded, so the default is the whole library
  // open — the state a reader who has never touched a chevron gets.
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

  // Everything under this shelf, its sub-shelves included, counted once.
  const total = countBooks(shelf)

  // A shelf with nothing under it at this reading level is not drawn at
  // all. The level filter runs in the catalog query, so "no books" here
  // already means "nothing this reader is browsing for" — an empty
  // heading would be a shelf that promises books and has none.
  if (total === 0) return null

  // Root shelves carry the collection name in the display face; deeper
  // ones are set as small tracked capitals, which is what keeps a
  // three-level tree readable as a hierarchy rather than as headings of
  // three arbitrary sizes.
  const head =
    depth === 0 ? (
      <h2 className="shelf__name">{shelf.title}</h2>
    ) : (
      <span className="shelf__name">{shelf.title}</span>
    )

  return (
    <section
      className={depth === 0 ? 'shelf shelf--root' : 'shelf shelf--nested'}
      // Each level steps in by one unit; the books under it step in one
      // further, so a sub-shelf's tiles sit clear of its own heading.
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
          {/* Not on a root shelf. "Authors" is a container — its count
              is the sum of the author shelves standing on it, which
              tells a reader nothing they cannot see by opening it, and
              a number beside every top-level heading turns the library
              into an inventory. The count earns its place further down,
              where a folded shelf is genuinely hidden. */}
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
          <ul className="shelf__books">
            {shelf.books.map((book) => (
              <BookTile key={book.id} book={book} />
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

/**
 * How many books are under this shelf, counting every shelf on it.
 *
 * By id and not by adding lengths: a book may be filed on a parent and
 * on one of its children at once, and it is one book. That is the same
 * reason `booksInSubtree` on the admin's collection cards is a Set.
 *
 * Zero is also how a shelf learns it should not be drawn — at a given
 * reading level a whole subtree can come back empty.
 */
function countBooks(shelf: ShelfNode): number {
  const seen = new Set<string>()
  const walk = (node: ShelfNode) => {
    for (const book of node.books) seen.add(String(book.id))
    for (const child of node.children) walk(child)
  }
  walk(shelf)
  return seen.size
}

/**
 * The fold indicator: points right when closed, down when open.
 *
 * `aria-hidden`, because the button it sits in already announces its
 * state through `aria-expanded` — a second announcement would read the
 * fold twice.
 */
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
