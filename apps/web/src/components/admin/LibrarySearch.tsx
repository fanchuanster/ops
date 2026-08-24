'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Search over the library, settled before it navigates.
 *
 * A plain GET form underneath, so the state is in the URL and a
 * filtered view is a link somebody can send. The delay is the whole
 * reason this is a client component: without it every keystroke is a
 * round trip to D1 for the entire catalog.
 *
 * This replaced `LibraryFilters` when Books and Collections merged. The
 * collection select it used to carry is gone — the tree on the page
 * *is* the collection filter now, and a select naming one shelf beside
 * a tree showing all of them was two answers to the same question.
 */
export function LibrarySearch({ query }: { query: string }) {
  const router = useRouter()
  const [text, setText] = useState(query)

  // Only when the editor has actually changed it: this effect must not
  // fire on the navigation it just caused, or the two chase each other.
  useEffect(() => {
    if (text === query) return
    const timer = setTimeout(() => {
      const params = new URLSearchParams()
      if (text.trim()) params.set('q', text.trim())
      const search = params.toString()
      router.replace(search ? `/admin/library?${search}` : '/admin/library')
    }, 300)
    return () => clearTimeout(timer)
  }, [text, query, router])

  return (
    <form className="admin-filters" method="get" action="/admin/library">
      <label className="visually-hidden" htmlFor="library-search">
        Search the library
      </label>
      <input
        id="library-search"
        name="q"
        type="search"
        value={text}
        placeholder="Search…"
        onChange={(event) => setText(event.target.value)}
      />
      {/* Reachable by keyboard, invisible to a mouse: the form already
          submits on Enter, but a form with no submit control is one
          some browsers will not submit at all. */}
      <button type="submit" className="visually-hidden">
        Search
      </button>
    </form>
  )
}
