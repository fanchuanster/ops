'use client'

import { useActionState, useState } from 'react'

import {
  createCollection,
  moveCollection,
  renameCollection,
  type CollectionsState,
} from '../../app/(admin)/actions/collections'

export interface AdminCollectionRow {
  id: number
  title: string
  description: string
  books: number
}

/**
 * The shelves as editable cards.
 *
 * Client-side only for the two things that genuinely need it: which
 * card is open for editing, and whether the "add" form is showing.
 * Every write is a form posting to a server action, so nothing here
 * holds a copy of the collections — the list comes from the server and
 * goes back to the server, and a save that fails leaves the card
 * showing what is actually stored rather than what someone hoped.
 */
export function CollectionsPanel({ collections }: { collections: AdminCollectionRow[] }) {
  const [editing, setEditing] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  const [createState, create, creating] = useActionState<CollectionsState, FormData>(
    createCollection,
    {},
  )

  return (
    <div className="admin-cards">
      {collections.map((collection, index) => (
        <CollectionCard
          key={collection.id}
          collection={collection}
          first={index === 0}
          last={index === collections.length - 1}
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
  first,
  last,
  editing,
  onEdit,
  onDone,
}: {
  collection: AdminCollectionRow
  first: boolean
  last: boolean
  editing: boolean
  onEdit: () => void
  onDone: () => void
}) {
  const [renameState, rename, renaming] = useActionState<CollectionsState, FormData>(
    renameCollection,
    {},
  )
  const [moveState, move, moving] = useActionState<CollectionsState, FormData>(moveCollection, {})

  return (
    <div className="admin-card">
      <form action={move} className="admin-card__move">
        <input type="hidden" name="collectionId" value={collection.id} />
        <button
          type="submit"
          name="direction"
          value="up"
          disabled={first || moving}
          aria-label={`Move ${collection.title} up`}
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
          disabled={last || moving}
          aria-label={`Move ${collection.title} down`}
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
          <form action={rename} className="admin-card__edit">
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
            <div className="admin-card__actions">
              <button type="submit" className="admin-btn admin-btn--small" disabled={renaming}>
                {renaming ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="admin-linkbtn" onClick={onDone} disabled={renaming}>
                Cancel
              </button>
            </div>
            {renameState.error ? <p className="form-error">{renameState.error}</p> : null}
          </form>
        ) : (
          <>
            <p className="admin-card__title">
              {collection.title}
              <span className="admin-quiet">
                {collection.books} {collection.books === 1 ? 'book' : 'books'}
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
