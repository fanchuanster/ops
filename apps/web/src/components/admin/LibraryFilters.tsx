'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Search and shelf filter for the Books screen.
 *
 * A plain GET form underneath — the state is in the URL, so a filtered
 * view is a link somebody can send — with two conveniences on top: the
 * select submits on change, and typing settles for a moment before it
 * navigates. Without the delay every keystroke would be a round trip
 * to D1 for a list of two hundred books.
 */
export function LibraryFilters({
  query,
  collectionId,
  collections,
}: {
  query: string
  collectionId: number | null
  collections: { id: number; title: string }[]
}) {
  const router = useRouter()
  const [text, setText] = useState(query)
  const form = useRef<HTMLFormElement>(null)

  // Only when the reader has actually changed it: this effect must not
  // fire on the navigation it just caused, or the two chase each other.
  useEffect(() => {
    if (text === query) return
    const timer = setTimeout(() => {
      const params = new URLSearchParams()
      if (text.trim()) params.set('q', text.trim())
      if (collectionId !== null) params.set('collection', String(collectionId))
      const search = params.toString()
      router.replace(search ? `/admin/books?${search}` : '/admin/books')
    }, 300)
    return () => clearTimeout(timer)
  }, [text, query, collectionId, router])

  return (
    <form className="admin-filters" method="get" action="/admin/books" ref={form}>
      <label className="visually-hidden" htmlFor="admin-search">
        Search books
      </label>
      <input
        id="admin-search"
        name="q"
        type="search"
        value={text}
        placeholder="Search…"
        onChange={(event) => setText(event.target.value)}
      />

      <label className="visually-hidden" htmlFor="admin-collection">
        Collection
      </label>
      <select
        id="admin-collection"
        name="collection"
        defaultValue={collectionId === null ? '' : String(collectionId)}
        onChange={() => form.current?.requestSubmit()}
      >
        <option value="">All collections</option>
        {collections.map((collection) => (
          <option key={collection.id} value={collection.id}>
            {collection.title}
          </option>
        ))}
      </select>

      {/* Reachable by keyboard, invisible to a mouse: the form already
          submits on Enter and on change, but a form with no submit
          control is one some browsers will not submit at all. */}
      <button type="submit" className="visually-hidden">
        Filter
      </button>
    </form>
  )
}
