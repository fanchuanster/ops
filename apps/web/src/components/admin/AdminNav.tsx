'use client'

import { usePathname } from 'next/navigation'
import React from 'react'

/**
 * The admin's three destinations.
 *
 * Books and Collections merged into Library on 2026-08-24 — they were
 * never two subjects, and editing a book's shelf on one screen and the
 * shelf itself on another put the two halves of one job a navigation
 * apart.
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
    href: '/admin/library',
    label: 'Library',
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

    </nav>
  )
}
