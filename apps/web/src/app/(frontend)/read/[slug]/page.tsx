import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { PdfReader } from '../../../../components/PdfReader'
import { Reader } from '../../../../components/Reader'
import { getCurrentUser } from '../../../../lib/auth'
import { authorizeReading, markBookStarted } from '../../../../lib/authorizeDownload'
import { getBookBySlug } from '../../../../lib/catalog'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const book = await getBookBySlug(slug, await getCurrentUser())
  return { title: book ? `Reading ${book.title}` : 'Not found' }
}

/**
 * Reading a book, whole.
 *
 * No sign-in, no credits, no limit. Credits pay for taking a book away
 * to a device; they never pay for reading, and this page is the reason
 * the whole project exists. A reader who arrives with no account and no
 * balance still gets every word.
 *
 * Signing in adds exactly one thing here: the book is recorded as
 * started, so it appears in their history.
 *
 * Which reader opens depends on what the book actually has. Almost
 * always the EPUB one; for a book published as it stands there is no
 * EPUB to reflow, so its own pages are shown instead rather than the
 * reader failing at a book that is sitting right there in storage.
 */
export default async function ReadPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const user = await getCurrentUser()

  // The session goes into the lookup, not just into the authorization
  // below it: a private upload is invisible to an anonymous query, and
  // an owner opening their own book would get a bare 404 here rather
  // than ever reaching a decision about it.
  const book = await getBookBySlug(slug, user)
  if (!book) notFound()

  const payload = await getPayload({ config })

  const decision = await authorizeReading({
    payload,
    bookId: book.id,
    userId: user?.id ?? null,
  })

  if (!decision.allowed) {
    return (
      <main className="page auth-page">
        <h1>Not available to read</h1>
        <p className="notice">
          {decision.refusal.reason === 'format_unavailable'
            ? 'No readable edition has been generated for this book yet.'
            : 'This book is not available to read online.'}
        </p>
        <p>
          <a href={`/books/${slug}`}>← Back to {book.title}</a>
        </p>
      </main>
    )
  }

  if (user) await markBookStarted(payload, { userId: user.id, bookId: book.id })

  return (
    <main className="reader-page">
      <nav className="reader-nav">
        <a href={`/books/${slug}`}>← {book.title}</a>
      </nav>

      {decision.format === 'epub' ? (
        <Reader
          epubUrl={`/read/${slug}/edition`}
          bookTitle={book.title}
          partTitle={book.author ?? ''}
          progressKey={`noblesee-position-${slug}`}
        />
      ) : (
        <PdfReader
          url={`/read/${slug}/edition`}
          bookTitle={book.title}
          subtitle={book.author ?? ''}
        />
      )}
    </main>
  )
}
