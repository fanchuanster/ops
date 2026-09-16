import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { SendToKindleButton } from '../../../../components/SendToKindleButton'
import { coverAltFor, coverImageUrl, uploadedCoverId } from '../../../../domain/cover'
import { priceInCredits } from '../../../../domain/credits'
import { isKindleDeliverableFormat } from '../../../../domain/kindle'
import { readingFormat } from '../../../../domain/publication'
import { isPubliclyDistributable } from '../../../../domain/rights'
import { getCurrentUser } from '../../../../lib/auth'
import { getBookBySlug } from '../../../../lib/catalog'
import { ownsBook } from '../../../../lib/credits'

export const dynamic = 'force-dynamic'

const FORMAT_ORDER = ['epub', 'pdf', 'docx']

const RIGHTS_LABEL: Record<string, string> = {
  public_domain: 'Public domain',
  licensed: 'Licensed',
  permission_granted: 'Published with permission',
  user_owned: 'Reader’s own copy',
  restricted: 'Restricted',
  unknown: 'Rights unknown',
}

const LANGUAGE_LABEL: Record<string, string> = {
  'zh-Hant': 'Traditional Chinese',
  'zh-Hans': 'Simplified Chinese',
  en: 'English',
  'zh-en': 'Chinese / English',
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const book = await getBookBySlug(slug, await getCurrentUser())
  if (!book) return { title: 'Not found' }
  return { title: book.title, description: book.description ?? undefined }
}

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const reader = await getCurrentUser()
  const book = await getBookBySlug(slug, reader)
  if (!book) notFound()

  const cover = coverImageUrl({
    uploadedId: uploadedCoverId(book.cover),
    bookId: book.id,
    generated: book.generatedCover ?? {},
  })

  const kindleReady = Boolean(reader?.kindleEmail)

  const artifacts = (book.artifacts ?? [])
    .filter((a) => a.downloadable !== false)
    .sort((a, b) => FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format))

  const readable = readingFormat(artifacts.map((a) => a.format)) !== null
  const distributable = isPubliclyDistributable(book.rightsStatus)

  const price = book.priceCredits ?? priceInCredits(book.pageCount)

  const ownerId = typeof book.owner === 'object' ? book.owner?.id : book.owner
  const isOwnUpload = Boolean(ownerId) && String(ownerId) === String(reader?.id)

  const payload = await getPayload({ config })
  const alreadyOwned = reader ? await ownsBook(payload, reader.id, book.id) : false

  return (
    <main className="page">
      <article>
        <header className="book-head">
          <div className="book-card__cover">
            {cover ? (
              <img src={cover} alt={coverAltFor(book.title)} />
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
            <p className="byline">{book.author}</p>
            {book.description ? <p className="description">{book.description}</p> : null}

            <div className="meta">
              {book.language ? <span>{LANGUAGE_LABEL[book.language] ?? book.language}</span> : null}
              {book.pageCount ? <span>{`${book.pageCount} pages`}</span> : null}
              <span>{RIGHTS_LABEL[book.rightsStatus] ?? book.rightsStatus}</span>
              <span className="meta__price">
                {isOwnUpload
                  ? 'Your upload — free to send'
                  : `${price} credit${price === 1 ? '' : 's'} to send`}
              </span>
            </div>
          </div>
        </header>

        <div className="section-head">
          <h2>Send to a device</h2>
        </div>

        {!distributable && !isOwnUpload ? (
          <p className="locked">This book is not available for distribution.</p>
        ) : (
          <div className="book-actions">
            {readable ? null : (
              <span className="locked">No readable edition has been generated yet.</span>
            )}

            <span className="formats">
              {artifacts
                .filter((a) => isKindleDeliverableFormat(a.format))
                .map((a) => (
                  <span className={`fmt fmt--${a.format}`} key={a.format}>
                    {a.format}
                  </span>
                ))}

              {artifacts.length === 0 ? (
                <span className="locked">No formats generated yet.</span>
              ) : kindleReady && reader ? (
                <SendToKindleButton
                  bookId={book.id}
                  formats={artifacts
                    .filter((a) => isKindleDeliverableFormat(a.format))
                    .map((a) => ({ format: a.format, bytes: a.bytes }))}
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
          Reading is free and unlimited — no account needed. Credits pay only for sending a book
          to a device.
        </p>
      </article>
    </main>
  )
}
