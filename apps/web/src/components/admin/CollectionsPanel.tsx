'use client'

import React, { useActionState, useState } from 'react'

import {
  createCollection,
  moveCollection,
  saveCollection,
  type CollectionsState,
} from '../../app/(admin)/actions/collections'

export interface ParentOption {
  id: number
  title: string
  /** Only to indent the option, so a nested choice reads as nested. */
  depth: number
}

export interface AdminCollectionRow {
  id: number
  title: string
  description: string
  books: number
  /** 1 for a top-level shelf; deeper rows are indented by it. */
  depth: number
  /** The shelf this one stands on, or null. */
  parentId: number | null
  /** Books on this shelf *and* every shelf beneath it, as a reader sees it. */
  booksInSubtree: number
  /** Which shelves this one may legally be filed under. */
  parentOptions: ParentOption[]
  /** Whether it is first or last among its own siblings. */
  first: boolean
  last: boolean
}

/**
 * The shelves as editable cards.
 *
 * Collections nest, and the list arrives already flattened in tree
 * order with a depth on each row — parents immediately before their
 * children — so the nesting is drawn by indenting rather than by
 * rendering a tree of components. The arrows move a shelf among its own
 * siblings only; filing it somewhere else is the parent picker inside
 * the card, because those are different decisions and conflating them
 * into drag-and-drop would make both harder.
 *
 * Client-side only for the two things that genuinely need it: which
 * card is open for editing, and whether the "add" form is showing.
 * Every write is a form posting to a server action, so nothing here
 * holds a copy of the collections — the list comes from the server and
 * goes back to the server, and a save that fails leaves the card
 * showing what is actually stored rather than what someone hoped.
 */
export function CollectionsPanel({
  collections,
  newParentOptions,
}: {
  collections: AdminCollectionRow[]
  /** Where a collection that does not exist yet may be filed. */
  newParentOptions: ParentOption[]
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  const [createState, create, creating] = useActionState<CollectionsState, FormData>(
    createCollection,
    {},
  )

  return (
    <div className="admin-cards">
      {collections.map((collection) => (
        <CollectionCard
          key={collection.id}
          collection={collection}
          editing={editing === collection.id}
          onEdit={() => setEditing(collection.id)}
          onDone={() => setEditing(null)}
        />
      ))}

      {adding ? (
        <form action={create} className="admin-card admin-card--new">
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
          <div className="admin-card__actions">
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
        <button type="button" className="admin-card admin-card--add" onClick={() => setAdding(true)}>
          + Add a collection
        </button>
      )}
    </div>
  )
}

function CollectionCard({
  collection,
  editing,
  onEdit,
  onDone,
}: {
  collection: AdminCollectionRow
  editing: boolean
  onEdit: () => void
  onDone: () => void
}) {
  const [saveState, save, saving] = useActionState<CollectionsState, FormData>(saveCollection, {})
  const [moveState, move, moving] = useActionState<CollectionsState, FormData>(moveCollection, {})

  return (
    <div
      className={collection.depth > 1 ? 'admin-card admin-card--nested' : 'admin-card'}
      // Indented by depth rather than nested in the DOM, so a card is
      // the same card wherever it sits and the arrows keep working.
      style={{ '--depth': collection.depth - 1 } as React.CSSProperties}
    >
      <form action={move} className="admin-card__move">
        <input type="hidden" name="collectionId" value={collection.id} />
        <button
          type="submit"
          name="direction"
          value="up"
          disabled={collection.first || moving}
          aria-label={`Move ${collection.title} up, among its own siblings`}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M7 10.5V3.5M7 3.5L4 6.5M7 3.5L10 6.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="submit"
          name="direction"
          value="down"
          disabled={collection.last || moving}
          aria-label={`Move ${collection.title} down, among its own siblings`}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M7 3.5V10.5M7 10.5L4 7.5M7 10.5L10 7.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>

      <div className="admin-card__body">
        {editing ? (
          <form action={save} className="admin-card__edit">
            <input type="hidden" name="collectionId" value={collection.id} />
            <label className="visually-hidden" htmlFor={`title-${collection.id}`}>
              Name
            </label>
            <input
              id={`title-${collection.id}`}
              name="title"
              defaultValue={collection.title}
              required
            />
            <label className="visually-hidden" htmlFor={`description-${collection.id}`}>
              Description
            </label>
            <input
              id={`description-${collection.id}`}
              name="description"
              defaultValue={collection.description}
              placeholder="What is this shelf for? Readers see this."
            />
            <label className="visually-hidden" htmlFor={`parent-${collection.id}`}>
              Stands on
            </label>
            {/* Only shelves this one may legally stand on are offered,
                so an administrator is never shown a choice that will be
                refused when they save it. */}
            <select
              id={`parent-${collection.id}`}
              name="parentId"
              defaultValue={collection.parentId ?? ''}
            >
              <option value="">A shelf of its own</option>
              {collection.parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {'— '.repeat(option.depth - 1)}
                  Under {option.title}
                </option>
              ))}
            </select>
            <div className="admin-card__actions">
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
            <p className="admin-card__title">
              {collection.title}
              <span className="admin-quiet">
                {collection.books} {collection.books === 1 ? 'book' : 'books'}
                {/* A parent shelf shows everything beneath it, so the
                    direct count alone would understate what a reader
                    actually finds there. */}
                {collection.booksInSubtree > collection.books
                  ? ` · ${collection.booksInSubtree} with sub-shelves`
                  : null}
              </span>
            </p>
            {collection.description ? (
              <p className="admin-card__desc">{collection.description}</p>
            ) : (
              <p className="admin-card__desc admin-quiet">
                No description. Readers see this line under the shelf heading.
              </p>
            )}
          </>
        )}
        {moveState.error ? <p className="form-error">{moveState.error}</p> : null}
      </div>

      {editing ? null : (
        <button type="button" className="admin-linkbtn admin-card__edittoggle" onClick={onEdit}>
          Edit
        </button>
      )}
    </div>
  )
}
