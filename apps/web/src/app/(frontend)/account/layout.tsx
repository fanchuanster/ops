import { redirect } from 'next/navigation'
import React from 'react'

import { AccountNav } from '../../../components/AccountNav'
import { Avatar } from '../../../components/Avatar'
import { readerName, type ReaderIdentity } from '../../../domain/avatar'
import { isAdmin } from '../../../lib/adminAuth'
import { getCurrentUser } from '../../../lib/auth'
import { logout } from '../actions/auth'

export const dynamic = 'force-dynamic'

/**
 * The shell every account page shares: who you are, what you have, and
 * the sections down the left.
 *
 * The sign-in check lives here rather than in each page. One gate for
 * the whole area means a section added later cannot be the one that
 * forgot it.
 *
 * Sign out sits with the sections for the same reason. It was at the
 * foot of the Overview page, under the ledger and the Kindle settings,
 * which made leaving something a reader had to scroll past their own
 * credit history to find — and made it the one thing about their
 * account reachable from only one of its four pages.
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
        <div className="account__side">
          <AccountNav isAdmin={isAdmin(user)} />
          <form action={logout} className="account-signout">
            <button type="submit" className="button-quiet">
              Sign out
            </button>
          </form>
        </div>
        <section className="account__panel">{children}</section>
      </div>
    </main>
  )
}
