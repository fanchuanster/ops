import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { SendToKindleButton } from '../../../../components/SendToKindleButton'
import { priceInCredits } from '../../../../domain/credits'
import { isKindleDeliverableFormat } from '../../../../domain/kindle'
import { isPubliclyDistributable } from '../../../../domain/rights'
import { getCurrentUser } from '../../../../lib/auth'
import { getBookBySlug } from '../../../../lib/catalog'
import { ownsBook } from '../../../../lib/credits'

export const dynamic = 'force-dynamic'

/** Order shown to readers: EPUB first, because EPUB is the point. */
const FORMAT_ORDER = ['epub', 'pdf_standard', 'pdf_large', 'pdf_xl', 'docx']

/*
  Labels, not links. A reader should be able to see what a book is
  available as before signing in — otherwise the page is silent about
  the thing it is offering.
*/
const FORMAT_LABEL: Record<string, string> = {
  epub: 'EPUB',
  pdf_standard: 'PDF — Standard',
  pdf_large: 'PDF — Large',
  pdf_xl: 'PDF — Extra Large',
}

const LANGUAGE_LABEL: Record<string, string> = {
  'zh-Hant': 'Traditional Chinese',
  'zh-Hans': 'Simplified Chinese',
  en: 'English',
  'zh-en': 'Chinese / English',
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const book = await getBookBySlug(slug)
  if (!book) return { title: 'Not found' }
  return { title: book.title, description: book.description ?? undefined }
}

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const book = await getBookBySlug(slug)
  if (!book) notFound()

  const cover = typeof book.cover === 'object' && book.cover !== null ? book.cover : null

  const reader = await getCurrentUser()
  const kindleReady = Boolean(reader?.kindleEmail)

  const artifacts = (book.artifacts ?? [])
    .filter((a) => a.downloadable !== false)
    .sort((a, b) => FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format))

  const readable = artifacts.some((a) => a.format === 'epub')
  const distributable = isPubliclyDistributable(book.rightsStatus)

  // Stored on the book, but recomputed as a fallback so a record saved
  // before the price rule existed still shows something honest.
  const price = book.priceCredits ?? priceInCredits(book.pageCount)

  const ownerId = typeof book.owner === 'object' ? book.owner?.id : book.owner
  const isOwnUpload = Boolean(ownerId) && String(ownerId) === String(reader?.id)

  // Only to decide what the send control should say. The action
  // re-checks all of it, so this is presentation, not authorization.
  const payload = await getPayload({ config })
  const alreadyOwned = reader ? await ownsBook(payload, reader.id, book.id) : false

  return (
    <main className="page">
      <article>
        <header className="book-head">
          <div className="book-card__cover">
            {cover?.url ? (
              <img src={cover.url} alt={cover.alt || `Cover of ${book.title}`} />
            ) : (
              <span className="book-card__cover--empty cjk" aria-hidden="true">
                {book.originalTitle || book.title}
              </span>
            )}
          </div>

          <div>
            <h1>{book.title}</h1>
            {book.originalTitle ? (
              <p className="original-title cjk" lang="zh">
                {book.originalTitle}
              </p>
            ) : null}
            <p className="byline">
              {[book.author, book.translator ? `trans. ${book.translator}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {book.description ? <p className="description">{book.description}</p> : null}

            <div className="meta">
              {book.language ? <span>{LANGUAGE_LABEL[book.language] ?? book.language}</span> : null}
              {book.pageCount ? <span>{`${book.pageCount} pages`}</span> : null}
              <span>Rights: {book.rightsStatus.replace(/_/g, ' ')}</span>
              {/* The price is a property of the book, like its length —
                  visible before signing in, so nobody discovers the cost
                  only after committing to the book. */}
              <span className="meta__price">
                {isOwnUpload
                  ? 'Your upload — free to send'
                  : `${price} credit${price === 1 ? '' : 's'} to send`}
              </span>
            </div>
          </div>
        </header>

        <div className="section-head">
          <h2>Read &amp; send</h2>
        </div>

        {!distributable && !isOwnUpload ? (
          <p className="locked">This book is not available for distribution.</p>
        ) : (
          <div className="book-actions">
            {readable ? (
              <a className="book-actions__read" href={`/read/${book.slug}`}>
                Read online
              </a>
            ) : (
              <span className="locked">No readable edition has been generated yet.</span>
            )}

            <span className="formats">
              {artifacts
                .filter((a) => isKindleDeliverableFormat(a.format))
                .map((a) => (
                  <span className="format-tag" key={a.format}>
                    {FORMAT_LABEL[a.format] ?? a.format}
                  </span>
                ))}

              {artifacts.length === 0 ? (
                <span className="locked">No formats generated yet.</span>
              ) : kindleReady && reader ? (
                <SendToKindleButton
                  bookId={book.id}
                  formats={artifacts
                    .map((a) => a.format)
                    .filter((f) => isKindleDeliverableFormat(f))}
                  price={isOwnUpload ? 0 : alreadyOwned ? 1 : price}
                  balance={reader.credits ?? 0}
                />
              ) : (
                <a className="send-hint" href="/account">
                  {reader ? 'Add a Kindle address to send' : 'Sign in to send to Kindle'}
                </a>
              )}
            </span>
          </div>
        )}

        <p className="notice" style={{ marginTop: '2rem' }}>
          Reading online is free and unlimited — no account, no credits, nothing to spend.
          Credits pay only for sending a book to a device.
        </p>
      </article>
    </main>
  )
}
