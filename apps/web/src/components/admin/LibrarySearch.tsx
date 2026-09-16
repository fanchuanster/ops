'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export function LibrarySearch({ query }: { query: string }) {
  const router = useRouter()
  const [text, setText] = useState(query)

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
      <button type="submit" className="visually-hidden">
        Search
      </button>
    </form>
  )
}
