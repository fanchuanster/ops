'use client'

import { usePathname } from 'next/navigation'
import React from 'react'

/**
 * The admin's four destinations.
 *
 * A client component only because the current section is underlined,
 * which needs the path — the same reason and the same shape as
 * `SiteNav`. The links are plain anchors and the badge count is
 * rendered on the server and passed in, so nothing here is hydrated
 * that did not have to be.
 *
 * The icons are the design's own, copied path for path at the 16×16 it
 * draws them at.
 */

const SECTIONS = [
  {
    href: '/admin',
    label: 'Review queue',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 4h12M2 8h8M2 12h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/admin/books',
    label: 'Books',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2 3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3Z"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path
          d="M8 4.5c0 0 1.5-.5 3-.5s3 .5 3 .5v9s-1.5-.5-3-.5-3 .5-3 .5V4.5Z"
          stroke="currentColor"
          strokeWidth="1.3"
        />
      </svg>
    ),
  },
  {
    href: '/admin/collections',
    label: 'Collections',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
  {
    href: '/admin/users',
    label: 'Readers',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M2 14c0-3.314 2.686-5 6-5s6 1.686 6 5"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
]

export function AdminNav({ awaiting }: { awaiting: number }) {
  const pathname = usePathname()

  // Exact match for the queue, prefix for the rest: /admin is the
  // parent of every other section, so a prefix test would light it up
  // on all four.
  const isCurrent = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)

  return (
    <nav className="admin-nav">
      {SECTIONS.map(({ href, label, icon }) => (
        <a key={href} href={href} aria-current={isCurrent(href) ? 'page' : undefined}>
          <span className="admin-nav__icon">{icon}</span>
          {label}
          {href === '/admin' && awaiting > 0 ? (
            <span className="admin-nav__count">
              {awaiting}
              <span className="visually-hidden"> awaiting review</span>
            </span>
          ) : null}
        </a>
      ))}

      {/* Everything this UI has no screen for. Named plainly rather
          than hidden: an editor who needs Media or the credit ledger
          should not have to be told the URL by somebody. */}
      <a className="admin-nav__cms" href="/cms">
        <span className="admin-nav__icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M6 3h7M6 8h7M6 13h7M2.5 3h.01M2.5 8h.01M2.5 13h.01"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
        Everything else
      </a>
    </nav>
  )
}
