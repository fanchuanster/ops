import config from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { BookDetailsForm } from '../../../../../components/BookDetailsForm'
import { getCurrentUser } from '../../../../../lib/auth'
import { getCollections } from '../../../../../lib/catalog'

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
    </>
  )
}
