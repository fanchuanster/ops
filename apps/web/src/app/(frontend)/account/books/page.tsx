import React from 'react'

import { getCurrentUser } from '../../../../lib/auth'
import { getBooksOwnedBy } from '../../../../lib/catalog'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My books' }

/** Where an upload is in the pipeline, in the uploader's words. */
const CONVERSION_LABEL: Record<string, string> = {
  none: 'Ready',
  draft: 'Check the details',
  queued: 'Waiting to be converted',
  converting: 'Converting',
  ready: 'Ready',
  failed: 'Conversion failed',
}

export default async function MyBooksPage() {
  const user = await getCurrentUser()
  if (!user) return null

  const books = await getBooksOwnedBy(user.id)

  return (
    <>
      <div className="section-head">
        <h2>My books</h2>
        <a href="/account/upload">Upload another</a>
      </div>

      {books.length === 0 ? (
        <p className="empty">
          You have not uploaded anything yet. <a href="/account/upload">Upload a book</a> and it
          will be rebuilt as a clean EPUB and PDF you can read here or send to your Kindle.
        </p>
      ) : (
        <ul className="my-books">
          {books.map((book) => {
            const state = book.conversion?.state ?? 'none'
            const ready = state === 'none' || state === 'ready'
            const collections = (book.collections ?? [])
              .map((c) => (typeof c === 'object' && c ? c.title : null))
              .filter(Boolean)

            return (
              <li key={book.id} className="my-books__item">
                <div>
                  {/* Always its own page: that is where editing,
                      converting, submitting and deleting live, whatever
                      state the book is in. */}
                  <h3>
                    <a href={`/account/books/${book.id}`}>{book.title}</a>
                  </h3>
                  <p className="my-books__meta">
                    {[
                      book.visibility === 'public' ? 'In the public library' : 'Private to you',
                      book.pageCount ? `${book.pageCount} pages` : null,
                      collections.length > 0 ? collections.join(' · ') : null,
                    ]
                      .filter(Boolean)
                      .join(' — ')}
                  </p>
                  {/* A failure the uploader can do nothing about is still
                      a failure they are entitled to see the reason for. */}
                  {state === 'failed' && book.conversion?.message ? (
                    <p className="form-error">{book.conversion.message}</p>
                  ) : null}
                </div>
                <span className="my-books__right">
                  <span className={`pill pill--${state}`}>
                    {CONVERSION_LABEL[state] ?? state}
                  </span>
                  <span className="my-books__links">
                    <a href={`/account/books/${book.id}`}>Manage</a>
                    {ready ? <a href={`/read/${book.slug}`}>Read</a> : null}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <p className="hint" style={{ marginTop: '2rem' }}>
        An upload is private to you and stays that way. Putting one into the public library takes
        an administrator’s approval <em>and</em> a rights status that permits distribution — owning
        a copy of a book is not the right to publish it to everyone else.
      </p>
    </>
  )
}
