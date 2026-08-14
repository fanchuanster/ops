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
            // A draft has nothing to read yet; it has a question waiting.
            const href = state === 'draft' ? `/account/books/${book.id}` : `/books/${book.slug}`
            const collections = (book.collections ?? [])
              .map((c) => (typeof c === 'object' && c ? c.title : null))
              .filter(Boolean)

            return (
              <li key={book.id} className="my-books__item">
                <div>
                  <h3>
                    {ready || state === 'draft' ? <a href={href}>{book.title}</a> : book.title}
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
                <span className={`pill pill--${state}`}>
                  {CONVERSION_LABEL[state] ?? state}
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
