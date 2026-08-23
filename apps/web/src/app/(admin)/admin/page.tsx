import React from 'react'

import { ReviewDecision } from '../../../components/admin/ReviewDecision'
import { LEVEL_LABELS, levelFromId } from '../../../domain/levels'
import {
  REVIEW_LABELS,
  REVIEW_QUEUE_STATES,
  canPublishToLibrary,
  type ReviewState,
} from '../../../domain/moderation'
import { readSourceKind, readingFormat } from '../../../domain/publication'
import {
  RIGHTS_LABELS,
  isPubliclyDistributable,
  rightsRisk,
  type RightsStatus,
} from '../../../domain/rights'
import { getQueueBook, getReviewQueue } from '../../../lib/adminData'
import { requireAdmin } from '../../../lib/adminAuth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Review queue' }

/**
 * The submissions waiting on an editor.
 *
 * A list and a detail panel, and the panel is chosen with `?book=`
 * rather than with client-side selection. That is a deliberate
 * departure from the design's implementation, not from its layout: a
 * query parameter renders on the server, survives a decision being
 * saved, gives every row a real link, and means the whole screen needs
 * no client state at all. Only the decision form itself is interactive.
 *
 * What a reviewer is deciding *about* is the finished book, so the
 * panel's main affordance is Read it — `/read/<slug>`, which the Books
 * access rule opens to an administrator whatever the book's visibility.
 * `CLAUDE.md` section 3 says reviewing means reading the book, and a
 * screen that only offered files to download would be asking for a
 * judgement on something nobody had opened.
 */

const FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  ...REVIEW_QUEUE_STATES.map((state) => ({ value: state, label: REVIEW_LABELS[state] })),
]

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; book?: string }>
}) {
  const admin = await requireAdmin()
  const params = await searchParams

  const filter = (REVIEW_QUEUE_STATES as readonly string[]).includes(params.state ?? '')
    ? (params.state as ReviewState)
    : null

  const books = await getReviewQueue({ state: filter })

  // The panel's book is fetched separately rather than picked out of
  // the list: a decision saved a moment ago may have moved it out of
  // the current filter, and the panel should still show what happened
  // rather than closing itself.
  const selectedId = Number(params.book)
  const selected = Number.isInteger(selectedId) ? await getQueueBook(selectedId) : null

  const awaiting = books.filter((book) => book.review?.state === 'submitted').length
  const query = (extra: Record<string, string | null>) => {
    const next = new URLSearchParams()
    if (filter) next.set('state', filter)
    if (params.book) next.set('book', params.book)
    for (const [key, value] of Object.entries(extra)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const s = next.toString()
    return s ? `/admin?${s}` : '/admin'
  }

  return (
    <div className="admin-split">
      <div className="admin-pane">
        <header className="admin-head">
          <div>
            <h1>Review queue</h1>
            <p>
              {awaiting === 0
                ? 'Nothing awaiting a decision.'
                : `${awaiting} awaiting decision`}
            </p>
          </div>
          <div className="admin-filters">
            {FILTERS.map(({ value, label }) => {
              const on = value === 'all' ? filter === null : filter === value
              return (
                <a
                  key={value}
                  className="admin-chip"
                  aria-current={on ? 'true' : undefined}
                  href={query({ state: value === 'all' ? null : value })}
                >
                  {label}
                </a>
              )
            })}
          </div>
        </header>

        <div className="admin-scroll">
          {books.length === 0 ? (
            <p className="admin-empty">
              No submissions here. A reader’s upload stays private until they offer it, and most
              of them stay private for good.
            </p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Book</th>
                  <th className="admin-col--md">Submitted by</th>
                  <th className="admin-col--lg">Rights</th>
                  <th className="admin-col--lg admin-num">Pages</th>
                  <th>Status</th>
                  <th className="admin-col--md">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {books.map((book) => {
                  const state = (book.review?.state ?? 'unsubmitted') as ReviewState
                  const rights = (book.rightsStatus ?? 'unknown') as RightsStatus
                  const owner = typeof book.owner === 'object' ? book.owner : null
                  const kind = readSourceKind(book.conversion ?? {})
                  const face = Array.from((book.originalTitle || book.title).trim())[0] ?? '·'

                  return (
                    <tr
                      key={book.id}
                      className="admin-row"
                      data-selected={selected?.id === book.id ? 'true' : undefined}
                    >
                      <td>
                        <span className="admin-bookcell">
                          <span className="admin-face cjk" aria-hidden="true">
                            {face}
                          </span>
                          <span>
                            {/* The stretched link is what makes the
                                whole row clickable while still being
                                one link a keyboard can reach. */}
                            <a className="admin-rowlink" href={query({ book: String(book.id) })}>
                              {book.title}
                            </a>
                            <em>
                              {[book.author, kind === 'text' ? 'txt' : kind.toUpperCase()]
                                .filter(Boolean)
                                .join(' · ')}
                            </em>
                          </span>
                        </span>
                      </td>
                      <td className="admin-col--md admin-quiet">{owner?.email ?? '—'}</td>
                      <td className="admin-col--lg">
                        <span className={`admin-rights admin-rights--${rightsRisk(rights)}`}>
                          {RIGHTS_LABELS[rights]}
                        </span>
                      </td>
                      <td className="admin-col--lg admin-quiet admin-num">
                        {book.pageCount ? book.pageCount.toLocaleString() : '—'}
                      </td>
                      <td>
                        <span className={`admin-chip-status admin-chip-status--${state}`}>
                          {REVIEW_LABELS[state]}
                        </span>
                      </td>
                      <td className="admin-col--md admin-quiet">{shortDate(book.review?.submittedAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selected ? (
        <SubmissionPanel
          book={selected}
          adminId={admin.id}
          closeHref={query({ book: null })}
        />
      ) : null}
    </div>
  )
}

function SubmissionPanel({
  book,
  adminId,
  closeHref,
}: {
  book: Awaited<ReturnType<typeof getQueueBook>> & object
  /** Who is reviewing, so a book they uploaded themselves is recognised. */
  adminId: number | string
  closeHref: string
}) {
  const state = (book.review?.state ?? 'unsubmitted') as ReviewState
  const rights = (book.rightsStatus ?? 'unknown') as RightsStatus
  const risk = rightsRisk(rights)
  const owner = typeof book.owner === 'object' ? book.owner : null
  const kind = readSourceKind(book.conversion ?? {})
  const readable = readingFormat((book.artifacts ?? []).map((a) => a.format)) !== null

  // The Publish button appears only when it would actually work. The
  // gate is the domain's, so the button and the write agree by
  // construction rather than by being kept in step.
  //
  // `byAdmin` is unconditional here: this page is behind `requireAdmin`,
  // so there is nobody else looking at it. It is what makes Publish
  // available on a book that has been submitted but not yet approved —
  // the approval and the publication are one act by one person, and the
  // write records the approval either way.
  const publication = canPublishToLibrary({
    reviewState: state,
    rightsStatus: rights,
    byAdmin: true,
    ownedByRequester: String(owner?.id ?? '') === String(adminId),
  })
  const alreadyPublic = book.visibility === 'public'

  return (
    <aside className="admin-panel">
      <header className="admin-panel__head">
        <div>
          <p className="admin-panel__kind">
            {(kind === 'text' ? 'txt' : kind).toUpperCase()}
            {book.pageCount ? ` · ${book.pageCount.toLocaleString()} pp` : ''}
          </p>
          <h2>{book.title}</h2>
          {book.author ? <p className="admin-panel__author">{book.author}</p> : null}
        </div>
        <a className="admin-panel__close" href={closeHref} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </a>
      </header>

      <div className="admin-panel__body">
        <section>
          <h3>Submitted by</h3>
          <p>{owner?.displayName || owner?.email || 'Unknown'}</p>
          {owner?.displayName && owner.email ? <p className="admin-quiet">{owner.email}</p> : null}
          <p className="admin-quiet">Submitted {shortDate(book.review?.submittedAt) || '—'}</p>
        </section>

        <section>
          <h3>Rights declaration</h3>
          <div className={`admin-note admin-note--${risk}`}>
            <strong>{RIGHTS_LABELS[rights]}</strong>
            {risk === 'block' ? (
              <p>
                Owning a copy is not the right to publish it to everyone else. This book can be
                approved, but it cannot go into the public library — and nothing on this screen can
                change that.
              </p>
            ) : null}
            {risk === 'warn' ? (
              <p>
                Nobody has said where this came from. Only the uploader can answer it, so the
                honest move is to ask rather than to guess.
              </p>
            ) : null}
          </div>
        </section>

        {book.review?.proposedLevel ? (
          <section>
            <h3>Uploader’s suggestion</h3>
            <p>
              They think it belongs in{' '}
              <strong>{LEVEL_LABELS[levelFromId(book.review.proposedLevel)]}</strong>. Nothing
              applies it — set the level yourself on{' '}
              <a href="/admin/books">Books</a>, whether or not you agree.
            </p>
          </section>
        ) : null}

        <section>
          <h3>Read it</h3>
          {readable ? (
            <p>
              <a className="admin-read" href={`/read/${book.slug}`}>
                Open the edition
              </a>
            </p>
          ) : (
            <p className="admin-quiet">
              No edition has been built yet, so there is nothing to read. Decide once there is.
            </p>
          )}
        </section>

        <ReviewDecision
          bookId={book.id}
          reviewState={state}
          note={book.review?.note ?? ''}
          canPublish={publication.allowed && !alreadyPublic}
          alreadyPublic={alreadyPublic}
          rightsCleared={isPubliclyDistributable(rights)}
        />
      </div>
    </aside>
  )
}

/** 2026-08-21, or nothing at all. Never "Invalid Date". */
function shortDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}
