import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { PdfReader } from '../../../../components/PdfReader'
import { Reader } from '../../../../components/Reader'
import { TextReader } from '../../../../components/TextReader'
import { getCurrentUser } from '../../../../lib/auth'
import { authorizeReading, markBookStarted } from '../../../../lib/authorizeDownload'
import { getBookBySlug } from '../../../../lib/catalog'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const book = await getBookBySlug(slug, await getCurrentUser())
  return { title: book ? `Reading ${book.title}` : 'Not found' }
}

export default async function ReadPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ format?: string }>
}) {
  const { slug } = await params
  const { format: wanted } = await searchParams

  const user = await getCurrentUser()

  const book = await getBookBySlug(slug, user)
  if (!book) notFound()

  const payload = await getPayload({ config })

  const decision = await authorizeReading({
    payload,
    bookId: book.id,
    userId: user?.id ?? null,
    format: wanted,
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

  const edition = `/read/${slug}/edition?format=${decision.format}`

  return (
    <main className="reader-page">
      <nav className="reader-nav">
        <a href={`/books/${slug}`}>← {book.title}</a>
      </nav>

      {decision.format === 'epub' ? (
        <Reader
          epubUrl={edition}
          bookTitle={book.title}
          partTitle={book.author ?? ''}
          progressKey={`noblesee-position-${slug}`}
        />
      ) : decision.format === 'txt' ? (
        <TextReader
          url={edition}
          bookTitle={book.title}
          subtitle={book.author ?? ''}
          progressKey={`noblesee-position-${slug}`}
          lang={book.language ?? undefined}
        />
      ) : (
        <PdfReader
          url={edition}
          bookTitle={book.title}
          subtitle={book.author ?? ''}
        />
      )}
    </main>
  )
}
