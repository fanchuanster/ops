import { redirect } from 'next/navigation'
import React from 'react'

import { AccountNav } from '../../../components/AccountNav'
import { Avatar } from '../../../components/Avatar'
import { readerName, type ReaderIdentity } from '../../../domain/avatar'
import { getCurrentUser } from '../../../lib/auth'

export const dynamic = 'force-dynamic'

/**
 * The shell every account page shares: who you are, what you have, and
 * the sections down the left.
 *
 * The sign-in check lives here rather than in each page. One gate for
 * the whole area means a section added later cannot be the one that
 * forgot it.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=%2Faccount')

  const identity: ReaderIdentity = {
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  }
  const credits = user.credits ?? 0

  return (
    <main className="page account">
      <header className="account-identity">
        <Avatar identity={identity} size={56} />
        <div>
          <strong>{readerName(identity)}</strong>
          <span>{user.email}</span>
        </div>
        <p className="account-balance">
          <strong>{credits}</strong>
          <span>{credits === 1 ? 'credit' : 'credits'}</span>
        </p>
      </header>

      <div className="account__body">
        <AccountNav />
        <section className="account__panel">{children}</section>
      </div>
    </main>
  )
}
