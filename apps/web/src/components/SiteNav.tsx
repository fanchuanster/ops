'use client'

import { usePathname } from 'next/navigation'
import React, { useState } from 'react'

/**
 * The site header's navigation, at both widths.
 *
 * Three destinations, which is what the design carries: the library,
 * the way to contribute to it, and the way in. Collections and About
 * were here until 2026-08-21 — About no longer exists, and collections
 * are reached through the shelf headings they label.
 *
 * A client component for two reasons: the narrow layout collapses to a
 * button that opens a panel, and the current page is underlined, which
 * needs the path. The links are plain anchors and the account slot is
 * rendered on the server and passed in as `children`, so nothing here
 * is hydrated that did not have to be.
 *
 * Both layouts are in the markup at every width and the 48rem query in
 * `styles.css` decides which one shows. Mounting and unmounting them
 * instead would lose the panel's state on a resize, and would mean the
 * server rendering a layout it cannot know is right.
 */

const LINKS = [
  { href: '/books', label: 'Library' },
  { href: '/account/upload', label: 'Share a book' },
]

export function SiteNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Prefix rather than equality: /books/analects is still the library.
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

      {/* Always rendered, shown by the media query only when open — so
          the panel's contents are in the document for a screen reader
          that ignores the visual breakpoint. */}
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
