import React from 'react'

import { getCurrentUser } from '../../../../lib/auth'
import { getBooksOwnedBy } from '../../../../lib/catalog'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My books' }

/**
 * Where an upload is in the pipeline, in the uploader's words.
 *
 * Every state in `domain/pipeline.ts`, because anything missing here
 * falls through to the raw stored value — and the two-phase states are
 * exactly the ones a book now spends its visible minutes in.
 */
const CONVERSION_LABEL: Record<string, string> = {
  none: 'Ready',
  draft: 'Draft',
  queued: 'Waiting to be converted',
  ocr: 'Reading the pages',
  ocr_ready: 'Text ready',
  mastering: 'Building the master',
  master_ready: 'Building the EPUB',
  formatting: 'Building the EPUB',
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
          Nothing here yet. <a href="/account/upload">Upload a book</a> to get a clean EPUB and
          PDFs you can read here or send to your Kindle.
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
        Uploads stay private to you. Publishing one to the library needs an administrator’s
        approval and clear rights — owning a copy is not the right to publish it.
      </p>
    </>
  )
}
