import config from '@payload-config'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { Reader } from '../../../../../components/Reader'
import { getCurrentUser } from '../../../../../lib/auth'
import { authorizeDownload, markPartStarted } from '../../../../../lib/authorizeDownload'
import { getBookBySlug, getPartsForBook } from '../../../../../lib/catalog'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; order: string }>
}) {
  const { slug } = await params
  const book = await getBookBySlug(slug)
  return { title: book ? `Reading ${book.title}` : 'Not found' }
}

export default async function ReadPage({
  params,
}: {
  params: Promise<{ slug: string; order: string }>
}) {
  const { slug, order } = await params
  const partOrder = Number(order)
  if (!Number.isInteger(partOrder) || partOrder < 1) notFound()

  const book = await getBookBySlug(slug)
  if (!book) notFound()

  const parts = await getPartsForBook(book.id)
  const part = parts.find((p) => p.order === partOrder)
  if (!part) notFound()

  const user = await getCurrentUser()
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/read/${slug}/${partOrder}`)}`)
  }

  // The same authorization as a download, minus the limit: reading
  // online is not downloading, and should not spend a slot.
  const decision = await authorizeDownload({
    payload: await getPayload({ config }),
    partId: String(part.id),
    format: 'epub',
    userId: user.id,
    enforceDownloadLimit: false,
  })

  if (!decision.allowed) {
    const { refusal } = decision
    return (
      <main className="page auth-page">
        <h1>Not available yet</h1>
        <p className="notice">
          {refusal.reason === 'part_not_released'
            ? refusal.opensAt
              ? `This part opens for you on ${refusal.opensAt.toLocaleString()}.`
              : 'This part opens once you have started the one before it.'
            : refusal.reason === 'format_unavailable'
              ? 'No EPUB edition has been generated for this part yet.'
              : 'This part is not available to read online.'}
        </p>
        <p>
          <a href={`/books/${slug}`}>← Back to {book.title}</a>
        </p>
      </main>
    )
  }

  // Opening a part starts this reader's clock on the next one.
  await markPartStarted(await getPayload({ config }), {
    userId: user.id,
    bookId: book.id,
    partOrder,
  })

  const previous = parts.find((p) => p.order === partOrder - 1)
  const next = parts.find((p) => p.order === partOrder + 1)

  return (
    <main className="reader-page">
      <nav className="reader-nav">
        <a href={`/books/${slug}`}>← {book.title}</a>
        <span>
          {previous ? <a href={`/read/${slug}/${previous.order}`}>Previous part</a> : null}
          {next ? <a href={`/read/${slug}/${next.order}`}>Next part</a> : null}
        </span>
      </nav>

      <Reader
        epubUrl={`/read/${slug}/${partOrder}/epub`}
        bookTitle={book.title}
        partTitle={part.title}
        progressKey={`noblesee-position-${slug}-${partOrder}`}
      />
    </main>
  )
}
