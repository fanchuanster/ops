'use client'

import { useActionState, useRef } from 'react'

import { setBookCollection, type LibraryState } from '../../app/(admin)/actions/library'

/**
 * Which shelf a book is on, changed in place.
 *
 * Saves on change, which needs a client component — but only one line
 * of it. Everything else is a plain form posting to a server action, so
 * a book still moves shelf with JavaScript disabled: the select is a
 * real form control, and the fallback is that the change needs the
 * Enter key rather than a save button that would otherwise sit in every
 * row unused.
 */
export function CollectionSelect({
  bookId,
  current,
  collections,
}: {
  bookId: number
  current: number | null
  collections: { id: number; title: string }[]
}) {
  const [state, act, pending] = useActionState<LibraryState, FormData>(setBookCollection, {})
  const form = useRef<HTMLFormElement>(null)

  return (
    <form action={act} ref={form} className="admin-shelf">
      <input type="hidden" name="bookId" value={bookId} />
      <label className="visually-hidden" htmlFor={`shelf-${bookId}`}>
        Collection
      </label>
      <select
        id={`shelf-${bookId}`}
        name="collectionId"
        defaultValue={current === null ? '' : String(current)}
        disabled={pending}
        onChange={() => form.current?.requestSubmit()}
      >
        <option value="">No collection</option>
        {collections.map((collection) => (
          <option key={collection.id} value={collection.id}>
            {collection.title}
          </option>
        ))}
      </select>
      {state.error ? <span className="admin-shelf__error">{state.error}</span> : null}
    </form>
  )
}
