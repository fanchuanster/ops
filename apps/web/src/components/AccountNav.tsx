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
  { href: '/account/books', label: 'My books', hint: 'Upload and manage your own' },
] as const

/**
 * The way in to the editorial admin, for the people who have one.
 *
 * Nothing on the public site linked to `/admin` at all — an editor had
 * to know the URL and type it, which meant the review queue was, in
 * practice, missing. It belongs here rather than in the header: the
 * header is a reader's, and this is the one place already given over to
 * "things about you".
 *
 * Rendered only for an administrator, and that is presentation, not
 * access control — `requireAdmin` guards the pages themselves, and a
 * reader who guesses the URL is sent home either way.
 */
const ADMIN_SECTION = {
  href: '/admin',
  label: 'Editors’ desk',
  hint: 'Review, publish and curate',
} as const

export function AccountNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname()
  const sections = isAdmin ? [...SECTIONS, ADMIN_SECTION] : SECTIONS

  return (
    <nav className="account-nav" aria-label="Account sections">
      <ul>
        {sections.map((section) => {
          // Exact match only. A prefix match would light up Overview on
          // every page, since every path here starts with /account.
          // Upload is the one exception: it has no entry of its own any
          // more — it is reached by the button on My books — so it is
          // that section a reader is inside while uploading.
          const current =
            pathname === section.href ||
            (section.href === '/account/books' && pathname === '/account/upload')
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
