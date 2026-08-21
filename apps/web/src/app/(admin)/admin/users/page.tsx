import React from 'react'

import { getAdminUsers } from '../../../../lib/adminData'
import { isAdmin, requireAdmin } from '../../../../lib/adminAuth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Readers' }

/**
 * Who is here, and what they have contributed.
 *
 * Read-only, deliberately. The design carries a Suspend / Restore
 * control and there is no account state behind it — adding one is a
 * migration plus a refusal at sign-in plus a decision about what a
 * suspended reader is told, and a button that only *looks* like it
 * suspends someone is worse than no button. It is a separate change,
 * not a corner of this screen.
 *
 * Everything a person legitimately needs to *do* to an account —
 * granting the admin role, correcting an email, adjusting credits — is
 * in the CMS, one link away in the sidebar, where each of those has a
 * real form and an audit trail.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await requireAdmin()
  const params = await searchParams
  const query = (params.q ?? '').trim()

  const rows = await getAdminUsers(query)

  return (
    <div className="admin-pane">
      <header className="admin-head">
        <div>
          <h1>Readers</h1>
          <p>
            {rows.length} {rows.length === 1 ? 'account' : 'accounts'}
            {query ? ' matching' : ''}
          </p>
        </div>
        <form className="admin-filters" method="get" action="/admin/users">
          <label className="visually-hidden" htmlFor="reader-search">
            Search readers
          </label>
          <input
            id="reader-search"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search…"
          />
          <button type="submit" className="visually-hidden">
            Search
          </button>
        </form>
      </header>

      <div className="admin-scroll">
        {rows.length === 0 ? (
          <p className="admin-empty">No accounts match that.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Reader</th>
                <th className="admin-col--md admin-num">Uploads</th>
                <th className="admin-col--md admin-num">Public</th>
                <th className="admin-col--lg admin-num">Credits</th>
                <th className="admin-col--md">Joined</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ user, uploads, published }) => {
                const name = user.displayName || user.email
                return (
                  <tr key={user.id}>
                    <td>
                      <span className="admin-bookcell">
                        <span className="admin-avatar" aria-hidden="true">
                          {Array.from(name.trim())[0] ?? '·'}
                        </span>
                        <span>
                          <a className="admin-rowlink" href={`/cms/collections/users/${user.id}`}>
                            {name}
                          </a>
                          {user.displayName ? <em>{user.email}</em> : null}
                        </span>
                      </span>
                    </td>
                    <td className="admin-col--md admin-quiet admin-num">{uploads}</td>
                    <td className="admin-col--md admin-quiet admin-num">{published}</td>
                    <td className="admin-col--lg admin-quiet admin-num">{user.credits ?? 0}</td>
                    <td className="admin-col--md admin-quiet">{shortDate(user.createdAt)}</td>
                    <td>
                      {isAdmin(user) ? (
                        <span className="admin-chip-status admin-chip-status--approved">Admin</span>
                      ) : (
                        <span className="admin-quiet">Reader</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function shortDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10)
}
