'use client'

import { usePathname } from 'next/navigation'

/**
 * The sections down the left of the account area.
 *
 * A client component for one reason: marking the current section. That
 * needs the pathname, and `aria-current` on the active link is what
 * makes the highlight mean something to a screen reader rather than
 * being a colour a sighted reader has to infer from.
 */
const SECTIONS = [
  { href: '/account', label: 'Overview', hint: 'Credits and delivery' },
  { href: '/account/history', label: 'History', hint: 'Read, sent and paid' },
  { href: '/account/books', label: 'My books', hint: 'What you uploaded' },
  { href: '/account/upload', label: 'Upload a book', hint: 'Convert your own' },
] as const

export function AccountNav() {
  const pathname = usePathname()

  return (
    <nav className="account-nav" aria-label="Account sections">
      <ul>
        {SECTIONS.map((section) => {
          // Exact match only. A prefix match would light up Overview on
          // every page, since every path here starts with /account.
          const current = pathname === section.href
          return (
            <li key={section.href}>
              <a href={section.href} aria-current={current ? 'page' : undefined}>
                <strong>{section.label}</strong>
                <span>{section.hint}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
