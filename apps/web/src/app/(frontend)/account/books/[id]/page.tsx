import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { BookDetailsForm } from '../../../../../components/BookDetailsForm'
import { MasterFile } from '../../../../../components/MasterFile'
import { MONTHLY_PAGE_LIMIT, MONTHLY_UPLOAD_LIMIT } from '../../../../../domain/uploadQuota'
import { getCurrentUser } from '../../../../../lib/auth'
import { getCollections } from '../../../../../lib/catalog'
import { usageThisMonth } from '../../../../../lib/uploadQuota'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Book details' }

/**
 * The summary page an upload lands on.
 *
 * Everything here was read out of the file. The reader's job is to
 * correct it, answer the one question the file cannot answer — where
 * the book came from — and decide whether they are asking for it to be
 * published.
 */
export default async function BookDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) return null

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: Number(id), depth: 1, overrideAccess: true })
    .catch(() => null)

  // Not found and not yours give the same answer: whether a book exists
  // is not something to leak through a URL someone can guess.
  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) notFound()

  const collections = await getCollections()
  const draft = book.conversion?.state === 'draft'
  const readable = (book.artifacts ?? []).some((a) => a.format === 'epub')
  const hasMaster = (book.artifacts ?? []).some((a) => a.format === 'docx')
  const isAdmin = Boolean(user.roles?.includes('admin'))
  const usage = isAdmin ? null : await usageThisMonth(payload, user.id)

  return (
    <>
      <div className="section-head">
        <h2>{draft ? 'Check the details' : 'Book details'}</h2>
      </div>

      {draft ? (
        <p>
          We read these from <strong>{book.conversion?.sourceFilename ?? 'your file'}</strong>.
          Correct anything that is wrong — files are often vague about themselves — then choose
          what happens next.
        </p>
      ) : null}

      {readable ? (
        <p className="book-actions">
          <a className="book-actions__read" href={`/read/${book.slug}`}>
            Read it
          </a>
          <span className="hint">
            Private to you. Nobody else can open this, whatever the link.
          </span>
        </p>
      ) : null}

      {usage && draft ? (
        <p className="hint">
          {`This month you have converted ${usage.uploads} of ${MONTHLY_UPLOAD_LIMIT} books and ${usage.pages} of ${MONTHLY_PAGE_LIMIT} pages.`}
          {book.estimatedPages
            ? ` This one looks like about ${book.estimatedPages} pages.`
            : ' We could not tell how long this one is, so it counts as one book and no pages.'}
        </p>
      ) : null}

      <BookDetailsForm
        book={{
          id: Number(book.id),
          title: book.title,
          originalTitle: book.originalTitle ?? '',
          author: book.author ?? '',
          translator: book.translator ?? '',
          description: book.description ?? '',
          language: book.language ?? '',
          rightsStatus: book.rightsStatus,
          collections: (book.collections ?? [])
            .map((c) => (typeof c === 'object' && c ? Number(c.id) : Number(c)))
            .filter(Number.isFinite),
        }}
        collections={collections.map((c) => ({ id: Number(c.id), title: c.title }))}
      />

      {/* Only once the book has been through the pipeline: there is
          nothing to correct until something has been generated. */}
      {draft ? null : <MasterFile bookId={Number(book.id)} hasMaster={hasMaster} />}
    </>
  )
}
