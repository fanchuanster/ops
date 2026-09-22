'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'

function leavesThisWindow(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0) return false
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false

  const target = event.target
  const link = target instanceof Element ? target.closest('a[href]') : null
  if (!(link instanceof HTMLAnchorElement)) return false
  if (link.target && link.target !== '_self') return false
  if (link.hasAttribute('download')) return false

  const href = link.getAttribute('href') ?? ''
  if (href.startsWith('#')) return false
  return link.href !== window.location.href
}

export function SiteSearch() {
  const pathname = usePathname()
  const params = useSearchParams()
  const field = useRef<HTMLInputElement>(null)

  const inLibrary = pathname === '/books'
  const collection = inLibrary ? params.get('collection') : null
  const level = inLibrary ? params.get('level') : null
  const asked = (inLibrary ? params.get('q') : null) ?? ''

  useEffect(() => {
    const clearOnLeaving = (event: MouseEvent) => {
      if (!leavesThisWindow(event)) return
      if (field.current) field.current.value = ''
    }
    document.addEventListener('click', clearOnLeaving)
    return () => document.removeEventListener('click', clearOnLeaving)
  }, [])

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
        ref={field}
        type="search"
        name="q"
        defaultValue={asked}
        placeholder="Search titles, authors or collections"
        aria-label="Search the library"
      />
    </form>
  )
}
