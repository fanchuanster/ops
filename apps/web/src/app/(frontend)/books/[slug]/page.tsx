import { notFound } from 'next/navigation'
import React from 'react'

import { SendToKindleButton } from '../../../../components/SendToKindleButton'
import { isKindleDeliverableFormat } from '../../../../domain/kindle'
import { effectiveRightsStatus, isPubliclyDistributable } from '../../../../domain/rights'
import { releaseState } from '../../../../domain/stagedRelease'
import { getCurrentUser } from '../../../../lib/auth'
import { getBookBySlug, getPartsForBook } from '../../../../lib/catalog'

export const dynamic = 'force-dynamic'

/** Order shown to readers: EPUB first, because EPUB is the point. */
const FORMAT_ORDER = ['epub', 'pdf_standard', 'pdf_large', 'pdf_xl', 'docx']

/*
  Labels, not links. A reader should be able to see what a book is
  available as before signing in — otherwise the page is silent about
  the thing it is offering. These became invisible when the download
  links went, which was an accident rather than a decision.
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

  const parts = await getPartsForBook(book.id)
  const cover = typeof book.cover === 'object' && book.cover !== null ? book.cover : null

  const staged = {
    enabled: Boolean(book.stagedRelease?.enabled),
    unlockDelayHours: book.stagedRelease?.unlockDelayHours ?? 24,
  }

  // Reading progress is per-reader and lands with reader accounts; until
  // then every visitor is treated as having started nothing, which is
  // the correct reading for a signed-out visitor anyway — they cannot
  // download at all without an account.
  const progress = { startedAt: new Map<number, Date>() }
  const now = new Date()

  // Only to decide whether the Kindle button is worth showing. The
  // action re-checks it, so this is presentation, not authorization.
  const reader = await getCurrentUser()
  const kindleReady = Boolean(reader?.kindleEmail)

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
              <span>Rights: {book.rightsStatus.replace(/_/g, ' ')}</span>
              <span>
                {parts.length} {parts.length === 1 ? 'part' : 'parts'}
              </span>
              {staged.enabled ? <span>Released in parts</span> : null}
            </div>
          </div>
        </header>

        <div className="section-head">
          <h2>Read &amp; download</h2>
        </div>

        {parts.length === 0 ? (
          <p className="empty">This book is still in production. No parts published yet.</p>
        ) : (
          <ul className="parts">
            {parts.map((part) => {
              // A part may be more restricted than its book, never less.
              const rights = effectiveRightsStatus(book.rightsStatus, part.rightsStatus ?? undefined)
              const distributable = isPubliclyDistributable(rights)
              const release = releaseState(part.order, progress, staged, now)

              const artifacts = (part.artifacts ?? [])
                .filter((a) => a.downloadable !== false)
                .sort(
                  (a, b) => FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format),
                )

              return (
                <li className="part" key={part.id}>
                  <span className="part__order">Part {part.order}</span>
                  <h3 className="part__title cjk">{part.title}</h3>

                  {!distributable ? (
                    <span className="locked">Not available for distribution.</span>
                  ) : release.state === 'locked' ? (
                    <span className="locked">Opens after the previous part.</span>
                  ) : release.state === 'waiting' ? (
                    <span className="locked">
                      Opens {release.opensAt.toLocaleDateString()}.
                    </span>
                  ) : (
                    <span className="formats">
                      {artifacts.some((a) => a.format === 'epub') ? (
                        <a className="read" href={`/read/${book.slug}/${part.order}`}>
                          Read online
                        </a>
                      ) : null}

                      {/*
                        No download links. A book is read here or sent to
                        the reader's device; it is not a file to collect.
                      */}
                      {artifacts
                        .filter((a) => isKindleDeliverableFormat(a.format))
                        .map((a) => (
                          <span className="format-tag" key={a.format}>
                            {FORMAT_LABEL[a.format] ?? a.format}
                          </span>
                        ))}

                      {artifacts.length === 0 ? (
                        <span className="locked">No formats generated yet.</span>
                      ) : kindleReady ? (
                        <SendToKindleButton
                          partId={part.id}
                          formats={artifacts
                            .map((a) => a.format)
                            .filter((f) => isKindleDeliverableFormat(f))}
                        />
                      ) : (
                        <a className="send-hint" href="/account">
                          {reader ? 'Add a Kindle address to send' : 'Sign in to send to Kindle'}
                        </a>
                      )}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {staged.enabled ? (
          <p className="notice" style={{ marginTop: '2rem' }}>
            This book is released in parts. The next part opens {staged.unlockDelayHours} hours
            after you start the one before it — a reading rhythm, not a paywall. Nothing here
            expires, and starting late costs you nothing.
          </p>
        ) : null}
      </article>
    </main>
  )
}
