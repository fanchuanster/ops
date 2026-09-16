import { redirect } from 'next/navigation'
import React from 'react'

import { AccountNav } from '../../../components/AccountNav'
import { Avatar } from '../../../components/Avatar'
import { readerName, type ReaderIdentity } from '../../../domain/avatar'
import { isAdmin } from '../../../lib/adminAuth'
import { getCurrentUser } from '../../../lib/auth'
import { logout } from '../actions/auth'

export const dynamic = 'force-dynamic'

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
