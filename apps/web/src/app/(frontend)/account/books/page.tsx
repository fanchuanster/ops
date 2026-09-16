import React from 'react'

import { readSourceKind } from '../../../../domain/publication'
import { getCurrentUser } from '../../../../lib/auth'
import { getBooksOwnedBy } from '../../../../lib/catalog'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My books' }

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
        <h2>My Books</h2>
        <a className="cta cta--compact" href="/account/upload">
          Upload a book
        </a>
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
            const kind = readSourceKind(book.conversion ?? {})
            const badge = kind === 'text' ? 'txt' : kind
            const ready = state === 'none' || state === 'ready'
            const shelf =
              typeof book.collection === 'object' && book.collection
                ? book.collection.title
                : null

            return (
              <li key={book.id} className="my-books__item">
                <div>
                  <span className={`fmt fmt--${badge}`}>{badge}</span>
                  <h3>
                    <a href={`/account/books/${book.id}`}>{book.title}</a>
                  </h3>
                  <p className="my-books__meta">
                    {[
                      book.visibility === 'public' ? 'In the public library' : 'Private to you',
                      book.pageCount ? `${book.pageCount} pages` : null,
                      shelf,
                    ]
                      .filter(Boolean)
                      .join(' — ')}
                  </p>
                  {book.conversion?.message ? (
                    <p className={state === 'failed' ? 'form-error' : 'hint'}>
                      {book.conversion.message}
                    </p>
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

      <p className="hint" style={{ marginTop: '2rem', textAlign: 'center' }}>
        Reviewed by an editor before joining the public library.
      </p>
    </>
  )
}
