import config from '@payload-config'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import {
  DEFAULT_LIMIT_POLICY,
  distinctBooksInWindow,
  type DownloadRecord,
} from '../../../domain/downloadLimit'
import { KindleSettings } from '../../../components/KindleSettings'
import { getCurrentUser } from '../../../lib/auth'
import { logout } from '../actions/auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your account' }

export default async function AccountPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=%2Faccount')

  const payload = await getPayload({ config })
  const now = new Date()
  const cutoff = new Date(now.getTime() - DEFAULT_LIMIT_POLICY.windowHours * 60 * 60 * 1000)

  const rows = await payload.find({
    collection: 'downloads',
    where: {
      and: [
        { user: { equals: user.id } },
        { createdAt: { greater_than: cutoff.toISOString() } },
      ],
    },
    sort: '-createdAt',
    limit: 200,
    depth: 1,
    // Both are needed together. `overrideAccess: false` asks Payload to
    // apply the collection's access rule; `user` is what that rule sees
    // as `req.user`. Omitting `user` makes the local API look anonymous
    // to its own rules, and the Downloads rule correctly refuses — a
    // 403 on the reader's own history.
    overrideAccess: false,
    user,
  })

  const history: DownloadRecord[] = rows.docs.map((row) => ({
    bookId: String(typeof row.book === 'object' ? row.book.id : row.book),
    at: new Date(row.createdAt),
  }))
  const booksUsed = distinctBooksInWindow(history, now).size
  const remaining = Math.max(0, DEFAULT_LIMIT_POLICY.maxBooksPerWindow - booksUsed)

  // Titles rather than ids — the count is only meaningful if you can
  // see which books it refers to.
  const titles = new Map<string, string>()
  for (const row of rows.docs) {
    if (typeof row.book === 'object' && row.book) titles.set(String(row.book.id), row.book.title)
  }

  return (
    <main className="page auth-page">
      <h1>Your account</h1>
      <p className="auth-page__lede">
        {user.displayName ? `${user.displayName} · ` : ''}
        {user.email}
      </p>

      <div className="section-head">
        <h2>Deliveries</h2>
      </div>

      {/*
        One interpolated string rather than several expressions: React
        renders adjacent expressions as separate text nodes separated by
        comment markers, so "{a} of {b}" does not appear in the HTML as
        the phrase a reader (or a test) sees.
      */}
      <p>
        <strong>{`${remaining} of ${DEFAULT_LIMIT_POLICY.maxBooksPerWindow}`}</strong>
        {` books remaining in the last ${DEFAULT_LIMIT_POLICY.windowHours} hours.`}
      </p>
      <p className="hint">
        The limit counts books, not files, and applies to books sent to a device. Reading here
        is never limited — send the EPUB and all three PDF sizes of one book and it is still a
        single slot, because you read one book.
      </p>

      {titles.size > 0 ? (
        <ul className="plain-list">
          {[...titles.entries()].map(([id, title]) => (
            <li key={id}>{title}</li>
          ))}
        </ul>
      ) : (
        <p className="empty">Nothing sent in this window.</p>
      )}

      <KindleSettings current={user.kindleEmail ?? null} />

      <form action={logout} style={{ marginTop: '2.5rem' }}>
        <button type="submit" className="theme-toggle">
          Sign out
        </button>
      </form>
    </main>
  )
}
