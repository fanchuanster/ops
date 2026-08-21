import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { BookDetailsForm } from '../../../../../components/BookDetailsForm'
import { BookActions } from '../../../../../components/BookActions'
import { ConversionProgress } from '../../../../../components/ConversionProgress'
import { MasterFile } from '../../../../../components/MasterFile'
import { SubmitForReview } from '../../../../../components/SubmitForReview'
import { isConversionState } from '../../../../../domain/pipeline'
import { readSourceKind, readingFormat, resolvePlan } from '../../../../../domain/publication'
import { UPLOADER_RIGHTS } from '../../../../../domain/rights'
import { shareDescription } from '../../../../../domain/uploaderShare'
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
  // The same rule the reader authorizes with: a book published as it
  // stands has no EPUB and is still read in the browser, and this is
  // the page its owner opens it from (`domain/publication.ts`).
  const readable = readingFormat((book.artifacts ?? []).map((a) => a.format)) !== null
  const hasMaster = (book.artifacts ?? []).some((a) => a.format === 'docx')
  const isAdmin = Boolean(user.roles?.includes('admin'))
  const usage = isAdmin ? null : await usageThisMonth(payload, user.id)
  const state = book.conversion?.state ?? 'none'

  // What was uploaded, and what its owner chose to do with it. Both
  // decide which stages this book will actually pass through, so they
  // are read once here and shared by the form and the progress list.
  const sourceKind = readSourceKind(book.conversion ?? {})
  const plan = resolvePlan(sourceKind, book.conversion?.plan)
  const rightsDeclared = UPLOADER_RIGHTS.some((o) => o.value === book.rightsStatus)
  const share = shareDescription(book.rightsStatus)

  return (
    <>
      <div className="section-head">
        <h2>{draft ? 'Check the details' : 'Book details'}</h2>
      </div>

      {draft ? (
        <p>
          Read from <strong>{book.conversion?.sourceFilename ?? 'your file'}</strong>. Correct
          anything wrong, then convert.
        </p>
      ) : null}

      {readable ? (
        <p className="book-actions">
          <a className="book-actions__read" href={`/read/${book.slug}`}>
            Read it
          </a>
          <span className="hint">Private to you.</span>
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
          author: book.author ?? '',
          language: book.language ?? '',
          rightsStatus: book.rightsStatus,
          collections: (book.collections ?? [])
            .map((c) => (typeof c === 'object' && c ? Number(c.id) : Number(c)))
            .filter(Number.isFinite),
          sourceKind,
          plan,
        }}
        collections={collections.map((c) => ({ id: Number(c.id), title: c.title }))}
        submitLabel={draft ? 'Convert this book' : 'Save changes'}
      />

      {share && book.visibility === 'public' ? <p className="hint">{share}</p> : null}

      <ConversionProgress
        state={state}
        message={book.conversion?.message}
        queuedSince={book.conversion?.startedAt}
        sourceKind={sourceKind}
        plan={plan}
      />

      {/* Only once the book has been through the pipeline: there is
          nothing to correct, and nothing to judge, until something has
          been generated. */}
      {draft ? null : (
        <>
          <MasterFile bookId={Number(book.id)} hasMaster={hasMaster} />
          <SubmitForReview
            bookId={Number(book.id)}
            reviewState={book.review?.state ?? 'unsubmitted'}
            rightsDeclared={rightsDeclared}
          />
        </>
      )}

      <BookActions
        bookId={Number(book.id)}
        title={book.title}
        canRetry={state === 'failed'}
      />
    </>
  )
}
