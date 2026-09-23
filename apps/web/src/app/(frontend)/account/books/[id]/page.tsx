import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { BookDetailsForm } from '../../../../../components/BookDetailsForm'
import { BookCover } from '../../../../../components/BookCover'
import { SendToKindleButton } from '../../../../../components/SendToKindleButton'
import { RetryConversion } from '../../../../../components/RetryConversion'
import { BookBuild } from '../../../../../components/BookBuild'
import { BookSources } from '../../../../../components/BookSources'
import { ConversionProgress } from '../../../../../components/ConversionProgress'
import { CorrectionReview } from '../../../../../components/CorrectionReview'
import { BookFiles } from '../../../../../components/BookFiles'
import { SubmitForReview } from '../../../../../components/SubmitForReview'
import { Stepper } from '../../../../../components/Stepper'
import { buildTree, flattenTree } from '../../../../../domain/collectionTree'
import { byDisplayOrder } from '../../../../../domain/conversion'
import {
  chosenCoverPage,
  coverAltFor,
  coverCandidatePages,
  coverImageUrl,
  bookCoverSource,
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
import { loadSuggestions } from '../../../actions/correction'
import { getCurrentUser } from '../../../../../lib/auth'
import { getCollections } from '../../../../../lib/catalog'

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
  const state = book.conversion?.state ?? 'none'

  const finished =
    book.review?.state === 'approved' && (state === 'ready' || state === 'none')

  const deliverable = (book.artifacts ?? [])
    .filter((artifact) => isKindleDeliverableFormat(artifact.format))
    .sort(byDisplayOrder)
    .map((artifact) => ({ format: artifact.format, bytes: artifact.bytes }))

  const sourceKind = readSourceKind(book.conversion ?? {})
  const plan = resolvePlan(sourceKind, book.conversion?.plan)
  const share = shareDescription(book.rightsStatus)

  const sources = readSources(book.conversion ?? {}, book.artifacts)

  const shelfTitle =
    typeof book.collection === 'object' && book.collection ? book.collection.title : null

  const uploadedCover = uploadedCoverId(book.cover)
  const generatedCover = book.generatedCover ?? {}
  const coverUrl = coverImageUrl({
    uploadedId: uploadedCover,
    bookId: book.id,
    generated: generatedCover,
  })
  const canMakeCover = bookCoverSource(book) !== null
  const reviewState = book.review?.state ?? 'unsubmitted'

  const cover = (
    <BookCover
      bookId={Number(book.id)}
      title={book.title}
      coverUrl={coverUrl}
      alt={coverAltFor(book.title)}
      uploaded={uploadedCover !== null}
      page={chosenCoverPage(generatedCover)}
      pages={coverCandidatePages(generatedCover)}
      canMake={canMakeCover && !hasRenderedPages(generatedCover)}
      isPrivate={!isInPublicLibrary(book)}
    />
  )

  return (
    <>
      {finished ? (
        <div className="wizard-head">
          <p className="wizard-head__status">
            {isInPublicLibrary(book) ? 'Published' : 'Approved'}
          </p>
          <h2 className="cjk">{book.title}</h2>
          <p>{[book.author, shelfTitle].filter(Boolean).join(' · ')}</p>
        </div>
      ) : (
        <div className="wizard-head">
          <h2>Process &amp; review details</h2>
          {draft ? <p>Check the details we auto-filled from your file.</p> : null}
        </div>
      )}

      {finished ? null : (
        <Stepper step={uploadStep({ reviewState: book.review?.state })} />
      )}

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
          proposedLevel: book.review?.proposedLevel ?? null,
          canProposeLevel: reviewState === 'unsubmitted' || reviewState === 'rejected',
          sourceKind,
          plan,
          aiCorrection: book.conversion?.aiCorrection === true,
        }}
        collections={flattenTree(buildTree(collections)).map((node) => ({
          id: Number(node.collection.id),
          title: node.collection.title,
          depth: node.depth,
        }))}
        sources={sources}
        cover={draft ? cover : undefined}
        needsFirstPage={canMakeCover && !hasRenderedPages(generatedCover)}
        draft={draft}
        byAdmin={isAdmin}
      />

      {draft ? null : (
        <BookBuild
          bookId={Number(book.id)}
          sourceKind={sourceKind}
          sources={sources}
          hasMaster={hasMaster}
          aiCorrection={book.conversion?.aiCorrection === true}
          converting={isConversionState(state) && isInFlight(state)}
        />
      )}

      {share && isInPublicLibrary(book) ? <p className="hint">{share}</p> : null}

      {finished || draft ? null : (
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
            {cover}
          </section>

          <BookSources
            bookId={Number(book.id)}
            sources={sources}
            selected={sourceKind}
            hasMaster={hasMaster}
            converting={isConversionState(state) && isInFlight(state)}
          />

          <BookFiles
            bookId={Number(book.id)}
            slug={book.slug ?? ''}
            sourceKind={sourceKind}
            hasMaster={hasMaster}
            hasEpub={(book.artifacts ?? []).some((artifact) => artifact.format === 'epub')}
          />

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
            reviewState={reviewState}
            reviewNote={book.review?.note}
            proposedLevel={book.review?.proposedLevel}
            byAdmin={isAdmin}
          />
        </>
      )}

      {state === 'failed' ? <RetryConversion bookId={Number(book.id)} /> : null}
    </>
  )
}
