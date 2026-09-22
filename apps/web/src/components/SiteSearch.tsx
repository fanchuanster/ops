'use client'

import { usePathname, useSearchParams } from 'next/navigation'

export function SiteSearch() {
  const pathname = usePathname()
  const params = useSearchParams()

  const inLibrary = pathname === '/books'
  const collection = inLibrary ? params.get('collection') : null
  const level = inLibrary ? params.get('level') : null
  const asked = (inLibrary ? params.get('q') : null) ?? ''

  return (
    <form className="site-search" action="/books" method="get" role="search">
      {collection ? <input type="hidden" name="collection" value={collection} /> : null}
      {level ? <input type="hidden" name="level" value={level} /> : null}

      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.75" />
        <path d="M21 21l-4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>

      <input
        key={asked}
        type="search"
        name="q"
        defaultValue={asked}
        placeholder="Search titles, authors or collections"
        aria-label="Search the library"
      />
    </form>
  )
}
