import config from '@payload-config'
import { getPayload } from 'payload'
import React from 'react'

import { getCurrentUser } from '../../../../lib/auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'History' }

interface Entry {
  key: string
  at: Date
  kind: 'read' | 'sent' | 'paid'
  title: string
  slug?: string
  detail: string
}

const KIND_LABEL: Record<Entry['kind'], string> = {
  read: 'Read',
  sent: 'Sent',
  paid: 'Paid',
}

/**
 * One timeline of everything this reader has done with books.
 *
 * Three ledgers feed it — reading progress, deliveries and the credit
 * ledger — merged and sorted rather than shown as three separate lists.
 * A reader thinking "when did I get that book?" does not know or care
 * which table the answer is in.
 *
 * All three are read with `overrideAccess: true` *and* an explicit
 * filter on this reader's id. The filter is the security boundary here;
 * the override only stops Payload's own rule turning the reader's own
 * history into a 403.
 */
export default async function HistoryPage() {
  const user = await getCurrentUser()
  if (!user) return null

  const payload = await getPayload({ config })
  const mine = { user: { equals: user.id } }

  const [read, sent, paid] = await Promise.all([
    payload.find({
      collection: 'reading-progress',
      where: mine,
      sort: '-startedAt',
      limit: 100,
      depth: 1,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'downloads',
      where: mine,
      sort: '-createdAt',
      limit: 100,
      depth: 1,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'credit-ledger',
      where: { and: [mine, { reason: { in: ['unlock', 'resend'] } }] },
      sort: '-createdAt',
      limit: 100,
      depth: 1,
      overrideAccess: true,
    }),
  ])

  const titleOf = (book: unknown) =>
    typeof book === 'object' && book !== null ? (book as { title: string }).title : 'A book'
  const slugOf = (book: unknown) =>
    typeof book === 'object' && book !== null ? (book as { slug?: string }).slug : undefined

  const entries: Entry[] = [
    ...read.docs.map((row) => ({
      key: `read-${row.id}`,
      at: new Date(row.startedAt),
      kind: 'read' as const,
      title: titleOf(row.book),
      slug: slugOf(row.book),
      detail: 'Opened in the reader',
    })),
    ...sent.docs.map((row) => ({
      key: `sent-${row.id}`,
      at: new Date(row.createdAt),
      kind: 'sent' as const,
      title: titleOf(row.book),
      slug: slugOf(row.book),
      detail: `Sent as ${String(row.format).replace(/_/g, ' ')}`,
    })),
    ...paid.docs.map((row) => ({
      key: `paid-${row.id}`,
      at: new Date(row.createdAt),
      kind: 'paid' as const,
      title: titleOf(row.book),
      slug: slugOf(row.book),
      detail:
        row.reason === 'resend'
          ? `${Math.abs(row.delta)} credit to send again`
          : `${Math.abs(row.delta)} credit${Math.abs(row.delta) === 1 ? '' : 's'} to unlock`,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime())

  return (
    <>
      <div className="section-head">
        <h2>History</h2>
      </div>

      {entries.length === 0 ? (
        <p className="empty">
          Nothing yet. <a href="/books">Find something to read</a> — it costs nothing.
        </p>
      ) : (
        <ul className="history">
          {entries.map((entry) => (
            <li key={entry.key} className={`history__item history__item--${entry.kind}`}>
              <span className="history__kind">{KIND_LABEL[entry.kind]}</span>
              <span className="history__what">
                {entry.slug ? <a href={`/books/${entry.slug}`}>{entry.title}</a> : entry.title}
                <span>{entry.detail}</span>
              </span>
              <time dateTime={entry.at.toISOString()}>{entry.at.toLocaleDateString()}</time>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
