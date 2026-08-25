'use client'

import React, { useActionState, useState } from 'react'

import {
  applyShelfLevel,
  createCollection,
  moveCollection,
  saveCollection,
  type CollectionsState,
} from '../../app/(admin)/actions/collections'
import {
  BOOK_LEVELS,
  DEFAULT_BOOK_LEVEL,
  LEVEL_APPLY_DESCRIPTIONS,
  LEVEL_APPLY_LABELS,
  LEVEL_APPLY_MODES,
  LEVEL_LABELS,
  type BookLevel,
} from '../../domain/levels'
import { MAX_DEPTH } from '../../domain/collectionTree'
import {
  SHELF_SORTS,
  SHELF_SORT_DESCRIPTIONS,
  SHELF_SORT_LABELS,
  type ShelfSort,
} from '../../domain/shelfOrder'

export interface ParentOption {
  id: number
  title: string
  /** Only to indent the option, so a nested choice reads as nested. */
  depth: number
}

export interface LibraryBookRow {
  id: number
  title: string
  author: string
  /** First character of the original-script title, for the tile face. */
  face: string
  level: BookLevel
  /** In the public library — which since 2026-08-24 means "approved". */
  published: boolean
  /** Deliveries to e-readers. Not downloads; NobleSee has none. */
  sent: number
  /**
   * Who uploaded it — a display name, else an email. Null for a book
   * staff entered, which has no uploader rather than a missing one.
   */
  uploader: string | null
  /** The day the book arrived, ISO, formatted on the server. */
  uploaded: string
  /**
   * Where it sits among the books on its own shelf, lowest first.
   *
   * Null for a book on no shelf: an order id is a position among a
   * collection's books, and the "Other" group is not a collection.
   */
  order: number | null
  /**
   * Where clicking this row goes — built on the server.
   *
   * A string and not a callback: a function cannot cross into a client
   * component, and the server is where the rest of the query string
   * lives anyway.
   */
  href: string
}

export interface LibraryRow {
  id: number
  title: string
  description: string
  /** 1 for a top-level shelf; deeper rows are indented by it. */
  depth: number
  parentId: number | null
  /** Where it sits among the shelves on the same parent, lowest first. */
  sortOrder: number | null
  parentOptions: ParentOption[]
  first: boolean
  last: boolean
  /** Books on this shelf and every shelf beneath it, counted once. */
  booksInSubtree: number
  /** The books filed *directly* here, after the search filter. */
  books: LibraryBookRow[]
  /** How many of its own books the search is hiding. */
  hidden: number
  /** How this shelf orders its own children: A–Z, or by order id. */
  childOrder: ShelfSort
}

/**
 * The shelves, with their books on them.
 *
 * One screen instead of two, from the design. The tree is the spine and
 * a book is a row on it, so an editor arranges the library while
 * looking at what a reader will find — which is the one view neither of
 * the two screens this replaced could show.
 *
 * Flattened on the server and indented by depth rather than nested in
 * the DOM, so a shelf row is the same row wherever it sits.
 *
 * Client state covers exactly three ephemeral things: which shelf is
 * open for editing, whether its levelling form is showing, and whether
 * an add form is showing. Every write is a form posting to a server
 * action, so nothing here holds a copy of the library — a save that
 * fails leaves the row showing what is actually stored rather than what
 * somebody hoped.
 *
 * Two controls the design does not draw are kept deliberately:
 *
 *   the reorder arrows, and the order box beside the parent picker —
 *     `sortOrder` is what decides the order a reader meets the shelves
 *     in, and the homepage shows the first two. With no control for it
 *     that order goes back to being whatever the database returns. The
 *     arrows are for "one place up"; the box is for "third", which on a
 *     long shelf is a great many clicks otherwise.
 *   the parent picker — the design's "+ sub" *creates* a shelf under a
 *     parent, which is not the same as moving one that already exists.
 *     Without it a mis-filed shelf can only be fixed by hand through
 *     the REST API.
 */
export function LibraryTree({
  rows,
  loose,
  newParentOptions,
  selectedBook,
}: {
  rows: LibraryRow[]
  /** Books nobody has filed yet. */
  loose: LibraryBookRow[]
  newParentOptions: ParentOption[]
  selectedBook: number | null
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  const [createState, create, creating] = useActionState<CollectionsState, FormData>(
    createCollection,
    {},
  )

  return (
    <div className="admin-lib">
      {rows.map((row) => (
        <ShelfRow
          key={row.id}
          row={row}
          editing={editing === row.id}
          onEdit={() => setEditing(row.id)}
          onDone={() => setEditing(null)}
          selectedBook={selectedBook}
        />
      ))}

      {loose.length > 0 ? (
        <section className="admin-lib__group" style={{ '--depth': 0 } as React.CSSProperties}>
          <div className="admin-lib__shelf admin-lib__shelf--loose">
            <span className="admin-lib__name">Other</span>
            <span className="admin-quiet">
              {loose.length} {loose.length === 1 ? 'book' : 'books'} nobody has filed
            </span>
          </div>
          {loose.map((book) => (
            <BookRow
              key={book.id}
              book={book}
              depth={0}
              selected={selectedBook === book.id}
            />
          ))}
        </section>
      ) : null}

      {adding ? (
        <form action={create} className="admin-lib__add">
          <label className="visually-hidden" htmlFor="new-collection-title">
            Collection name
          </label>
          <input
            id="new-collection-title"
            name="title"
            placeholder="Collection name"
            autoFocus
            required
          />
          <label className="visually-hidden" htmlFor="new-collection-description">
            Short description
          </label>
          <input
            id="new-collection-description"
            name="description"
            placeholder="What is this shelf for? Readers see this."
          />
          <label className="visually-hidden" htmlFor="new-collection-parent">
            Stands on
          </label>
          <select id="new-collection-parent" name="parentId" defaultValue="">
            <option value="">A shelf of its own</option>
            {newParentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {'— '.repeat(option.depth - 1)}
                Under {option.title}
              </option>
            ))}
          </select>
          <div className="admin-lib__actions">
            <button type="submit" className="admin-btn admin-btn--small" disabled={creating}>
              {creating ? 'Adding…' : 'Add'}
            </button>
            <button
              type="button"
              className="admin-linkbtn"
              onClick={() => setAdding(false)}
              disabled={creating}
            >
              Cancel
            </button>
          </div>
          {createState.error ? <p className="form-error">{createState.error}</p> : null}
        </form>
      ) : (
        <button type="button" className="admin-lib__addbtn" onClick={() => setAdding(true)}>
          + Add a collection
        </button>
      )}
    </div>
  )
}

function ShelfRow({
  row,
  editing,
  onEdit,
  onDone,
  selectedBook,
}: {
  row: LibraryRow
  editing: boolean
  onEdit: () => void
  onDone: () => void
  selectedBook: number | null
}) {
  const [saveState, save, saving] = useActionState<CollectionsState, FormData>(saveCollection, {})
  const [moveState, move, moving] = useActionState<CollectionsState, FormData>(moveCollection, {})
  const [levelling, setLevelling] = useState(false)
  const [addingChild, setAddingChild] = useState(false)

  return (
    <section
      className="admin-lib__group"
      // Indented by depth rather than nested, so the arrows keep working
      // and a row is the same row wherever it sits.
      style={{ '--depth': row.depth - 1 } as React.CSSProperties}
    >
      <div
        className={
          row.depth > 1 ? 'admin-lib__shelf admin-lib__shelf--nested' : 'admin-lib__shelf'
        }
      >
        {editing ? (
          <form action={save} className="admin-lib__edit">
            <input type="hidden" name="collectionId" value={row.id} />
            <label className="visually-hidden" htmlFor={`title-${row.id}`}>
              Name
            </label>
            <input id={`title-${row.id}`} name="title" defaultValue={row.title} required autoFocus />
            <label className="visually-hidden" htmlFor={`description-${row.id}`}>
              Description
            </label>
            <input
              id={`description-${row.id}`}
              name="description"
              defaultValue={row.description}
              placeholder="What is this shelf for? Readers see this."
            />
            <label className="visually-hidden" htmlFor={`parent-${row.id}`}>
              Stands on
            </label>
            {/* Only shelves this one may legally stand on are offered,
                so an editor is never shown a choice that will be
                refused when they save it. */}
            <select id={`parent-${row.id}`} name="parentId" defaultValue={row.parentId ?? ''}>
              <option value="">A shelf of its own</option>
              {row.parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {'— '.repeat(option.depth - 1)}
                  Under {option.title}
                </option>
              ))}
            </select>
            {/* How this shelf's own children read — its books and the
                shelves standing on it, both. A–Z unless the shelf has
                an order of its own, which is the case order ids exist
                for: a volume set, a reading path. Until an editor
                switches this, the numbers below are recorded and never
                consulted (`domain/shelfOrder.ts`). */}
            <label className="visually-hidden" htmlFor={`childorder-${row.id}`}>
              How its contents are ordered
            </label>
            <select
              id={`childorder-${row.id}`}
              name="childOrder"
              defaultValue={row.childOrder}
              title="How the books and shelves on this one are ordered"
            >
              {SHELF_SORTS.map((value) => (
                <option key={value} value={value}>
                  {SHELF_SORT_LABELS[value]} — {SHELF_SORT_DESCRIPTIONS[value]}
                </option>
              ))}
            </select>
            {/* The same number the arrows above move, typed rather than
                stepped. The arrows are for "one place up"; this is for
                "third", which on a shelf of twenty is nine clicks
                otherwise. Two shelves may share a number and then read
                alphabetically between themselves — nothing shifts. */}
            <label className="visually-hidden" htmlFor={`order-${row.id}`}>
              Order among its siblings
            </label>
            <input
              id={`order-${row.id}`}
              name="sortOrder"
              className="admin-lib__order-input admin-num"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              defaultValue={row.sortOrder ?? ''}
              placeholder="#"
              title="Where this shelf sits among the shelves on the same parent"
            />
            <div className="admin-lib__actions">
              <button type="submit" className="admin-btn admin-btn--small" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="admin-linkbtn" onClick={onDone} disabled={saving}>
                Cancel
              </button>
            </div>
            {saveState.error ? <p className="form-error">{saveState.error}</p> : null}
          </form>
        ) : (
          <>
            <span className="admin-lib__heading">
              <span className={row.depth > 1 ? 'admin-lib__name admin-lib__name--nested' : 'admin-lib__name'}>
                {row.title}
              </span>
              {row.description && row.depth === 1 ? (
                <span className="admin-quiet">{row.description}</span>
              ) : null}
              {row.hidden > 0 ? (
                <span className="admin-quiet">
                  {row.hidden} hidden by the search
                </span>
              ) : null}
            </span>

            <span className="admin-lib__tools">
              {/* Order is a decision somebody took, and the homepage
                  shows the first two shelves. The design has no control
                  for it; without one it reverts to whatever the
                  database returns. */}
              <form action={move} className="admin-lib__move">
                <input type="hidden" name="collectionId" value={row.id} />
                <button
                  type="submit"
                  name="direction"
                  value="up"
                  disabled={row.first || moving}
                  aria-label={`Move ${row.title} up, among its own siblings`}
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M7 10.5V3.5M7 3.5L4 6.5M7 3.5L10 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="submit"
                  name="direction"
                  value="down"
                  disabled={row.last || moving}
                  aria-label={`Move ${row.title} down, among its own siblings`}
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M7 3.5V10.5M7 10.5L4 7.5M7 10.5L10 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </form>

              {row.depth < MAX_DEPTH ? (
                <button
                  type="button"
                  className="admin-linkbtn"
                  onClick={() => setAddingChild((open) => !open)}
                >
                  {addingChild ? 'Cancel' : '+ sub'}
                </button>
              ) : null}
              <button type="button" className="admin-linkbtn" onClick={onEdit}>
                Edit
              </button>
              <button
                type="button"
                className="admin-linkbtn"
                onClick={() => setLevelling((open) => !open)}
              >
                Level
              </button>
            </span>
          </>
        )}
      </div>

      {moveState.error ? <p className="form-error admin-lib__error">{moveState.error}</p> : null}

      {addingChild ? <AddChild parentId={row.id} onDone={() => setAddingChild(false)} /> : null}
      {levelling ? <ShelfLevel row={row} /> : null}

      {row.books.map((book) => (
        <BookRow
          key={book.id}
          book={book}
          depth={row.depth - 1}
          selected={selectedBook === book.id}
        />
      ))}
    </section>
  )
}

/**
 * One book on a shelf.
 *
 * The uploader and the date sit between the title and the level, and
 * are the reason an editor can tell a reader's submission from a book
 * staff entered without opening either. Both are quiet: they are
 * provenance, not the subject of the row.
 *
 * The level is a label here and not a control. It was three buttons
 * that saved on click, which was the right shape when this list was the
 * only place a level could be set; the panel sets it now, and the shelf
 * form sets a whole subtree at once, so a third writer sitting under
 * the cursor in a dense list was one too many. The full word rather
 * than an initial, because two of the three levels start with "E".
 */
function BookRow({
  book,
  depth,
  selected,
}: {
  book: LibraryBookRow
  depth: number
  selected: boolean
}) {
  return (
    <div
      className="admin-lib__book"
      data-selected={selected ? 'true' : undefined}
      style={{ '--depth': depth } as React.CSSProperties}
    >
      <span className="admin-face cjk" aria-hidden="true">
        {book.face}
      </span>
      <span className="admin-lib__booktext">
        <a className="admin-rowlink" href={book.href}>
          {/* Its place on the shelf, before the title, because that is
              the order the rows are already in — a number a reader can
              follow down the column is the whole point of showing it.
              Absent for an unfiled book, which has no place to show. */}
          {book.order === null ? null : (
            <span className="admin-lib__order admin-num" aria-hidden="true">
              {book.order}
            </span>
          )}
          {book.title}
        </a>
        {book.author ? <em>{book.author}</em> : null}
      </span>
      {/* Who put it here, and when. A column of its own rather than a
          third line under the title: an editor scanning for a reader's
          upload is comparing this down the page, and a value that
          starts at a different x each row cannot be compared.
          Truncated rather than wrapped — an email is as long as
          somebody's email happens to be, and the panel shows it whole.
          No tooltip, deliberately: the stretched row link covers this
          span, so a `title` on it would never appear. */}
      <span className="admin-lib__origin admin-quiet">
        <span className="admin-lib__uploader">{book.uploader ?? '—'}</span>
        <span className="admin-num">{book.uploaded || '—'}</span>
      </span>
      <span className={`admin-levelchip admin-levelchip--${book.level}`}>
        {LEVEL_LABELS[book.level]}
      </span>
      <span
        className={`admin-chip-status admin-chip-status--${book.published ? 'approved' : 'unsubmitted'}`}
      >
        {book.published ? 'Published' : 'Draft'}
      </span>
      <span className="admin-lib__sent admin-quiet admin-num" title="Sent to e-readers">
        {book.sent}
      </span>
    </div>
  )
}

/** Create a shelf directly under this one. */
function AddChild({ parentId, onDone }: { parentId: number; onDone: () => void }) {
  const [state, create, creating] = useActionState<CollectionsState, FormData>(
    createCollection,
    {},
  )

  return (
    <form action={create} className="admin-lib__inline">
      <input type="hidden" name="parentId" value={parentId} />
      <label className="visually-hidden" htmlFor={`sub-${parentId}`}>
        Name of the new shelf
      </label>
      <input id={`sub-${parentId}`} name="title" placeholder="Name" autoFocus required />
      <input name="description" placeholder="Description (optional)" />
      <button type="submit" className="admin-btn admin-btn--small" disabled={creating}>
        {creating ? 'Adding…' : 'Add'}
      </button>
      <button type="button" className="admin-linkbtn" onClick={onDone} disabled={creating}>
        Cancel
      </button>
      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  )
}

/**
 * Hand a reading level down a whole shelf.
 *
 * Two modes, and the form makes an editor choose rather than guessing
 * for them: a **cap** can only move a book shallower and leaves a
 * curated one alone; an **exact** level overwrites whatever was there.
 * `domain/levels.ts` owns both rules and the server applies them.
 *
 * Nothing is stored on the collection. A shelf has no level of its own;
 * this is an act performed on the books, and the result shows up in
 * their own chips a few rows below.
 */
function ShelfLevel({ row }: { row: LibraryRow }) {
  const [state, apply, applying] = useActionState<CollectionsState, FormData>(applyShelfLevel, {})
  const [mode, setMode] = useState<(typeof LEVEL_APPLY_MODES)[number]>('cap')

  return (
    <form action={apply} className="admin-lib__level">
      <input type="hidden" name="collectionId" value={row.id} />
      <p className="admin-lib__levelhead">Level this shelf</p>

      <div className="admin-lib__levels">
        {BOOK_LEVELS.map((level) => (
          <label key={level} className="admin-levelchoice admin-levelchoice--compact">
            <input
              type="radio"
              name="level"
              value={level}
              defaultChecked={level === DEFAULT_BOOK_LEVEL}
            />
            <span>{LEVEL_LABELS[level]}</span>
          </label>
        ))}
      </div>

      <div className="admin-lib__modes">
        {LEVEL_APPLY_MODES.map((option) => (
          <label key={option} className="admin-levelchoice">
            <input
              type="radio"
              name="mode"
              value={option}
              checked={mode === option}
              onChange={() => setMode(option)}
            />
            <span>{LEVEL_APPLY_LABELS[option]}</span>
            <em>{LEVEL_APPLY_DESCRIPTIONS[option]}</em>
          </label>
        ))}
      </div>

      <p className="admin-quiet">
        {row.booksInSubtree} {row.booksInSubtree === 1 ? 'book' : 'books'} on this shelf
        {row.booksInSubtree > row.books.length ? ' and the shelves under it' : ''}.
      </p>

      <button type="submit" className="admin-btn admin-btn--small" disabled={applying}>
        {applying ? 'Applying…' : 'Apply'}
      </button>

      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.ok && !state.error ? <p className="admin-ok">{state.ok}</p> : null}
    </form>
  )
}
