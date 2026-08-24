import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { BookDetailsForm } from '../../../../../components/BookDetailsForm'
import { SendToKindleButton } from '../../../../../components/SendToKindleButton'
import { BookActions } from '../../../../../components/BookActions'
import { ConversionProgress } from '../../../../../components/ConversionProgress'
import { MasterFile } from '../../../../../components/MasterFile'
import { SubmitForReview } from '../../../../../components/SubmitForReview'
import { Stepper } from '../../../../../components/Stepper'
import { buildTree, flattenTree } from '../../../../../domain/collectionTree'
import { isKindleDeliverableFormat } from '../../../../../domain/kindle'
import { uploadStep } from '../../../../../domain/pipeline'
import { readSourceKind, readingFormat, resolvePlan } from '../../../../../domain/publication'
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

  // An approved book that has stopped converting is finished, and every
  // step list on this page is then a row of ticks describing a journey
  // that is over. The lists are hidden rather than the page redesigned,
  // because a corrected master puts the book back in the pipeline and
  // the progress list becomes the point of the page again.
  const finished =
    book.review?.state === 'approved' && (state === 'ready' || state === 'none')

  // What was uploaded, and what its owner chose to do with it. Both
  // decide which stages this book will actually pass through, so they
  // are read once here and shared by the form and the progress list.
  // Everything this book can be delivered as. A reader's own upload is
  // free to send — it is their book (CLAUDE.md section 5.2) — so the
  // price is zero here without consulting the ledger. The action
  // re-derives all of it regardless; this only decides what the button
  // says.
  const deliverable = (book.artifacts ?? [])
    .map((artifact) => artifact.format)
    .filter((format) => isKindleDeliverableFormat(format))

  const sourceKind = readSourceKind(book.conversion ?? {})
  const plan = resolvePlan(sourceKind, book.conversion?.plan)
  const share = shareDescription(book.rightsStatus)

  return (
    <>
      <div className="wizard-head">
        <h2>Upload a Book</h2>
        <p>Prepare your manuscript for NobleSee</p>
      </div>

      {finished ? null : (
        <Stepper step={uploadStep({ state, reviewState: book.review?.state })} />
      )}

      {/* The file this book came from, kept in view at every stage. The
          page changes shape as the book converts; which file it is does
          not, and for a reader with several drafts open that is the one
          thing worth never having to go and check. */}
      <p className="file-chip">
        <span className={`fmt fmt--${sourceKind === 'text' ? 'txt' : sourceKind}`}>
          {sourceKind === 'text' ? 'txt' : sourceKind}
        </span>
        <span className="file-chip__name">
          {book.conversion?.sourceFilename ?? 'your file'}
        </span>
      </p>

      {draft ? (
        <div className="wizard-step-head">
          <h3>We read these from your file</h3>
          <p>Correct anything wrong.</p>
        </div>
      ) : null}

      {/* The finished book, offered in the order the reading mission
          puts them in: read it here first, take it away second. Sending
          is only shown once there is something to send *and* somewhere
          to send it — otherwise the reader is pointed at the setting
          that would make it work. */}
      {readable || deliverable.length > 0 ? (
        <p className="book-actions">
          {readable ? (
            <a className="book-actions__read" href={`/read/${book.slug}`}>
              Read it
            </a>
          ) : null}

          {deliverable.length === 0 ? null : user.kindleEmail ? (
            <SendToKindleButton
              bookId={Number(book.id)}
              formats={deliverable}
              price={0}
              balance={user.credits ?? 0}
            />
          ) : (
            <a className="send-hint" href="/account">
              Add a Kindle address to send
            </a>
          )}

          <span className="hint">Private to you, and free to send.</span>
        </p>
      ) : null}

      {usage && draft ? (
        <p className="hint hint--quota">
          {`This month you have converted ${usage.uploads} of ${MONTHLY_UPLOAD_LIMIT} books and ${usage.pages.toLocaleString('en-US')} of ${MONTHLY_PAGE_LIMIT.toLocaleString('en-US')} pages.`}
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
          language: book.language ?? '',
          // The counted length once there is one, the estimate read
          // from the file before that. Both are shown the same way and
          // labelled differently, because the difference is real: the
          // estimate is what the monthly allowance was charged against.
          pageCount: book.pageCount ?? book.estimatedPages ?? null,
          pagesAreEstimated: !book.pageCount && Boolean(book.estimatedPages),
          collection:
            typeof book.collection === 'object' && book.collection
              ? Number(book.collection.id)
              : typeof book.collection === 'number'
                ? book.collection
                : null,
          sourceKind,
          plan,
        }}
        // Flattened in tree order so a sub-shelf appears directly under
        // the shelf it stands on, indented (`domain/collectionTree.ts`).
        collections={flattenTree(buildTree(collections)).map((node) => ({
          id: Number(node.collection.id),
          title: node.collection.title,
          depth: node.depth,
        }))}
        draft={draft}
        submitLabel={draft ? 'Next' : 'Save changes'}
      />

      {share && book.visibility === 'public' ? <p className="hint">{share}</p> : null}

      {finished ? null : (
        <ConversionProgress
          state={state}
          message={book.conversion?.message}
          queuedSince={book.conversion?.startedAt}
          sourceKind={sourceKind}
          plan={plan}
        />
      )}

      {/* Only once the book has been through the pipeline: there is
          nothing to correct, and nothing to judge, until something has
          been generated. */}
      {draft ? null : (
        <>
          <MasterFile bookId={Number(book.id)} hasMaster={hasMaster} />
          <SubmitForReview
            bookId={Number(book.id)}
            reviewState={book.review?.state ?? 'unsubmitted'}
            rightsStatus={book.rightsStatus}
            reviewNote={book.review?.note}
            proposedLevel={book.review?.proposedLevel}
            byAdmin={isAdmin}
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
