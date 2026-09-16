import config from '@payload-config'
import { getPayload } from 'payload'
import React from 'react'

import { AccessToken } from '../../../../components/AccessToken'
import { isAdmin } from '../../../../lib/adminAuth'
import { getCurrentUser } from '../../../../lib/auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Access tokens' }

export default async function TokensPage() {
  const user = await getCurrentUser()
  if (!user) return null

  const payload = await getPayload({ config })
  const row = await payload.findByID({
    collection: 'users',
    id: user.id,
    depth: 0,
    overrideAccess: true,
  })

  const token = row.enableAPIKey && row.apiKey ? row.apiKey : null

  return (
    <>
      <div className="section-head">
        <h2>Access tokens</h2>
      </div>

      <p>
        A personal access token lets a script act as you. It carries{' '}
        <strong>exactly your own privileges</strong> — nothing more, and it can be
        revoked here at any time.
      </p>

      <AccessToken current={token} />

      <div className="section-head">
        <h3>Using it</h3>
      </div>

      <p>
        Send it as an <code>Authorization</code> header. The <code>users</code> prefix
        is part of the format and is required.
      </p>

      <pre className="code-block">
        <code>{`curl -H 'Authorization: users API-Key <token>' \\\n     ${process.env.NEXT_PUBLIC_SERVER_URL || 'https://noblesee.com'}/api/books`}</code>
      </pre>

      {isAdmin(user) ? (
        <p className="hint">
          As an administrator your token also reaches the curation API —{' '}
          <code>GET</code> and <code>PATCH</code> on <code>/api/admin/books/&lt;id&gt;</code>{' '}
          and <code>/api/admin/collections/&lt;id&gt;</code>. The same rules apply as in
          the editors’ desk: a book whose rights do not permit distribution is refused
          there too.
        </p>
      ) : null}

      <p className="hint">
        Treat it like your password. Anyone holding it can do anything you can do —
        read your private uploads, and spend your credits. If it leaks, replace it.
      </p>
    </>
  )
}
