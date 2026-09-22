'use client'

import { usePathname } from 'next/navigation'

const SECTIONS = [
  { href: '/account', label: 'Overview', hint: 'Credits and delivery' },
  { href: '/account/history', label: 'History', hint: 'Read, sent and paid' },
  { href: '/account/books', label: 'My books', hint: 'Upload and manage your own' },
  { href: '/account/tokens', label: 'Access tokens', hint: 'Let a script act as you' },
] as const

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
          const current =
            pathname === section.href ||
            (section.href === '/account/books' &&
              (pathname === '/account/upload' || pathname.startsWith('/account/books/')))
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
