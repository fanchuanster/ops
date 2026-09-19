import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { BookDetailsForm } from '../../../../../components/BookDetailsForm'
import { CoverImageUpload } from '../../../../../components/CoverImageUpload'
import { CoverPagePicker } from '../../../../../components/CoverPagePicker'
import { MakeCoverButton } from '../../../../../components/MakeCoverButton'
import { SendToKindleButton } from '../../../../../components/SendToKindleButton'
import { BookActions } from '../../../../../components/BookActions'
import { BookSources } from '../../../../../components/BookSources'
import { ConversionProgress } from '../../../../../components/ConversionProgress'
import { CorrectionReview } from '../../../../../components/CorrectionReview'
import { MasterFile } from '../../../../../components/MasterFile'
import { SubmitForReview } from '../../../../../components/SubmitForReview'
import { Stepper } from '../../../../../components/Stepper'
import { buildTree, flattenTree } from '../../../../../domain/collectionTree'
import {
  chosenCoverPage,
  coverAltFor,
  coverCandidatePages,
  coverImageUrl,
  coverSourceFrom,
  hasRenderedPages,
  uploadedCoverId,
} from '../../../../../domain/cover'
import {
  canRequestCorrection,
  readCorrectionState,
} from '../../../../../domain/correction'
import { isKindleDeliverableFormat } from '../../../../../domain/kindle'
import { isInPublicLibrary } from '../../../../../domain/moderation'
import { isConversionState, isInFlight, uploadStep } from '../../../../../domain/pipeline'
import { readSourceKind, readingFormat, resolvePlan } from '../../../../../domain/publication'
import { readSources } from '../../../../../domain/sources'
import { shareDescription } from '../../../../../domain/uploaderShare'
import { MONTHLY_PAGE_LIMIT, MONTHLY_UPLOAD_LIMIT } from '../../../../../domain/uploadQuota'
import { loadSuggestions } from '../../../actions/correction'
import { getCurrentUser } from '../../../../../lib/auth'
import { getCollections } from '../../../../../lib/catalog'
import { usageThisMonth } from '../../../../../lib/uploadQuota'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Book details' }

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

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) notFound()

  const collections = await getCollections()
  const draft = book.conversion?.state === 'draft'
  const readable = readingFormat((book.artifacts ?? []).map((a) => a.format)) !== null
  const hasMaster = (book.artifacts ?? []).some((a) => a.format === 'docx')

  const correctionState = readCorrectionState(book.conversion?.correction?.state)
  const suggestions =
    correctionState === 'ready' ? await loadSuggestions(Number(book.id)) : []
  const isAdmin = Boolean(user.roles?.includes('admin'))
  const usage = isAdmin ? null : await usageThisMonth(payload, user.id)
  const state = book.conversion?.state ?? 'none'

  const finished =
    book.review?.state === 'approved' && (state === 'ready' || state === 'none')

  const deliverable = (book.artifacts ?? [])
    .filter((artifact) => isKindleDeliverableFormat(artifact.format))
    .map((artifact) => ({ format: artifact.format, bytes: artifact.bytes }))

  const sourceKind = readSourceKind(book.conversion ?? {})
  const plan = resolvePlan(sourceKind, book.conversion?.plan)
  const share = shareDescription(book.rightsStatus)

  const sources = readSources(book.conversion ?? {}, book.artifacts)

  const uploadedCover = uploadedCoverId(book.cover)
  const generatedCover = book.generatedCover ?? {}
  const coverUrl = coverImageUrl({
    uploadedId: uploadedCover,
    bookId: book.id,
    generated: generatedCover,
  })
  const canMakeCover = coverSourceFrom(book.artifacts ?? []) !== null

  return (
    <>
      <div className="wizard-head">
        <h2>Upload a Book</h2>
        <p>Prepare your manuscript for NobleSee</p>
      </div>

      {finished ? null : (
        <Stepper step={uploadStep({ state, reviewState: book.review?.state })} />
      )}

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
          author: book.author ?? '',
          language: book.language ?? '',
          pageCount: book.pageCount ?? book.estimatedPages ?? null,
          pagesAreEstimated: !book.pageCount && Boolean(book.estimatedPages),
          collection:
            typeof book.collection === 'object' && book.collection
              ? Number(book.collection.id)
              : typeof book.collection === 'number'
                ? book.collection
                : null,
          collectionOrder:
            typeof book.collectionOrder === 'number' ? book.collectionOrder : null,
          sourceKind,
          plan,
          aiCorrection: book.conversion?.aiCorrection === true,
        }}
        collections={flattenTree(buildTree(collections)).map((node) => ({
          id: Number(node.collection.id),
          title: node.collection.title,
          depth: node.depth,
        }))}
        draft={draft}
        submitLabel={draft ? 'Next' : 'Save changes'}
        canOrderShelf={isAdmin}
      />

      {share && isInPublicLibrary(book) ? <p className="hint">{share}</p> : null}

      {finished ? null : (
        <ConversionProgress
          state={state}
          message={book.conversion?.message}
          queuedSince={book.conversion?.startedAt}
          sourceKind={sourceKind}
          plan={plan}
        />
      )}

      {draft ? null : (
        <>
          <section className="cover-panel">
            <h3>Cover</h3>
            <div className="cover-panel__body">
              {coverUrl ? (
                <img
                  className="cover-panel__img"
                  src={coverUrl}
                  alt={coverAltFor(book.title)}
                />
              ) : (
                <span className="cover-panel__img cover-panel__img--empty cjk" aria-hidden="true">
                  {Array.from(book.title.trim())[0] ?? '·'}
                </span>
              )}
              <div>
                {uploadedCover ? (
                  <p className="hint">
                    This book is wearing an uploaded image rather than a page of itself.
                  </p>
                ) : (
                  <>
                    <CoverPagePicker
                      bookId={Number(book.id)}
                      page={chosenCoverPage(generatedCover)}
                      pages={coverCandidatePages(generatedCover)}
                    />
                    {canMakeCover && !hasRenderedPages(generatedCover) ? (
                      <p className="cover-panel__make">
                        <MakeCoverButton
                          bookId={Number(book.id)}
                          className="cta cta--compact"
                        />
                      </p>
                    ) : null}
                  </>
                )}
                <CoverImageUpload
                  bookId={Number(book.id)}
                  hasUploadedCover={uploadedCover !== null}
                  bookIsPrivate={!isInPublicLibrary(book)}
                />
              </div>
            </div>
          </section>

          <BookSources
            bookId={Number(book.id)}
            sources={sources}
            selected={sourceKind}
            hasMaster={hasMaster}
            converting={isConversionState(state) && isInFlight(state)}
          />

          <MasterFile bookId={Number(book.id)} hasMaster={hasMaster} />

          {book.conversion?.aiCorrection === true ? (
            <CorrectionReview
              bookId={Number(book.id)}
              state={correctionState}
              suggestions={suggestions}
              count={book.conversion?.correction?.count}
              adopted={book.conversion?.correction?.adopted}
              message={book.conversion?.correction?.message}
              canRequest={canRequestCorrection({
                aiCorrection: book.conversion?.aiCorrection,
                hasMaster,
                state: correctionState,
              })}
            />
          ) : null}
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
