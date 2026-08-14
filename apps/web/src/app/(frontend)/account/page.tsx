import config from '@payload-config'
import { getPayload } from 'payload'
import React from 'react'

import { KindleSettings } from '../../../components/KindleSettings'
import {
  SHARE_LICENSED,
  SHARE_PUBLIC_DOMAIN,
} from '../../../domain/uploaderShare'
import {
  ACTIVE_MONTH_GRANT,
  INACTIVE_MONTH_GRANT,
  MAX_BOOK_PRICE,
  MIN_BOOK_PRICE,
  PAGES_PER_CREDIT,
  RESEND_PRICE,
} from '../../../domain/credits'
import { getCurrentUser } from '../../../lib/auth'
import { logout } from '../actions/auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your account' }

/** Overview: what credits are, what you have, and where books go. */
export default async function AccountPage() {
  const user = await getCurrentUser()
  if (!user) return null

  const pendingShare = user.creditSharePoints ?? 0
  const payload = await getPayload({ config })
  const ledger = await payload.find({
    collection: 'credit-ledger',
    where: { user: { equals: user.id } },
    sort: '-createdAt',
    limit: 8,
    depth: 1,
    overrideAccess: true,
  })

  return (
    <>
      <div className="section-head">
        <h2>Credits</h2>
      </div>

      <p>
        Credits pay for sending a book to your Kindle. <strong>Reading is always free</strong> —
        no account needed, no limit, nothing to spend.
      </p>
      <ul className="plain-list">
        <li>
          {`A book costs 1 credit per ${PAGES_PER_CREDIT} pages — at least ${MIN_BOOK_PRICE}, never more than ${MAX_BOOK_PRICE}.`}
        </li>
        <li>{`Sending a book you already have costs ${RESEND_PRICE} credit.`}</li>
        <li>{`You get ${ACTIVE_MONTH_GRANT} credits for any month you sign in, and ${INACTIVE_MONTH_GRANT} for a month you are away.`}</li>
        <li>
          {`Upload a book and you earn a share of what readers spend sending it — ${SHARE_PUBLIC_DOMAIN}% for a public-domain text you digitised, ${SHARE_LICENSED}% for one you wrote or hold a licence to.`}
        </li>
      </ul>

      {pendingShare > 0 ? (
        <p className="hint">
          {`You have earned ${pendingShare} hundredths of a credit from readers sending your books. It becomes a whole credit at 100 — nothing is lost on the way.`}
        </p>
      ) : null}

      {ledger.docs.length > 0 ? (
        <table className="ledger">
          <thead>
            <tr>
              <th>When</th>
              <th>What</th>
              <th className="ledger__num">Credits</th>
              <th className="ledger__num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {ledger.docs.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                <td>
                  {LEDGER_LABEL[row.reason] ?? row.reason}
                  {typeof row.book === 'object' && row.book ? ` — ${row.book.title}` : ''}
                </td>
                <td className="ledger__num">{row.delta > 0 ? `+${row.delta}` : row.delta}</td>
                <td className="ledger__num">{row.balanceAfter ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <KindleSettings current={user.kindleEmail ?? null} />

      <form action={logout} style={{ marginTop: '2.5rem' }}>
        <button type="submit" className="button-quiet">
          Sign out
        </button>
      </form>
    </>
  )
}

const LEDGER_LABEL: Record<string, string> = {
  signup: 'Welcome credits',
  monthly_active: 'Monthly credits',
  monthly_inactive: 'Monthly credits (away)',
  unlock: 'Unlocked a book',
  resend: 'Sent again',
  uploader_share: 'Someone sent your book',
  adjustment: 'Adjustment',
}
