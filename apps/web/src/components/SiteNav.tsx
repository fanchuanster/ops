'use client'

import { usePathname } from 'next/navigation'
import React, { useState } from 'react'

const LINKS = [
  { href: '/books', label: 'Library' },
  { href: '/account/upload', label: 'Share a book' },
]

export function SiteNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <>
      <nav className="site-nav">
        {LINKS.map((link) => (
          <a key={link.href} href={link.href} aria-current={isCurrent(link.href) ? 'page' : undefined}>
            {link.label}
          </a>
        ))}
        {children}
      </nav>

      <button
        type="button"
        className="site-nav__toggle"
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span className="visually-hidden">{open ? 'Close menu' : 'Open menu'}</span>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          {open ? (
            <path
              d="M5 5L15 15M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M3 6h14M3 10h14M3 14h14"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>

      <div id="site-menu" className="site-nav__panel" data-open={open}>
        {LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            aria-current={isCurrent(link.href) ? 'page' : undefined}
            onClick={() => setOpen(false)}
          >
            {link.label}
          </a>
        ))}
        {children}
      </div>
    </>
  )
}
