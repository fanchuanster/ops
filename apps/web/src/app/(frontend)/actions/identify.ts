'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { type ShelfChoice } from '../../../domain/bookIdentity'
import { ancestryOf } from '../../../domain/collectionTree'
import { isInPublicLibrary } from '../../../domain/moderation'
import { bookSlug } from '../../../domain/slug'
import { readSources } from '../../../domain/sources'
import { getCurrentUser } from '../../../lib/auth'
import { freeBookSlug } from '../../../lib/bookSlug'
import { getCollections } from '../../../lib/catalog'
import { identifyFromFirstPage } from '../../../lib/identifyBook'
import { logError } from '../../../lib/logError'
import type { Book } from '../../../payload-types'

function uploadedNames(book: Book): string[] {
  const names = readSources(book.conversion ?? {}, book.artifacts).map((source) => source.filename)
  const fallback = book.conversion?.sourceFilename ?? book.title
  return names.some(Boolean) ? names : [fallback]
}

export type IdentifyResult = 'filled' | 'nothing' | 'failed'

export async function identifyUpload(bookId: number): Promise<IdentifyResult> {
  const user = await getCurrentUser()
  if (!user || !Number.isInteger(bookId)) return 'failed'

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) return 'failed'

  const collections = await getCollections()
  const shelves: ShelfChoice[] = collections.map((shelf) => ({
    id: shelf.id,
    path: ancestryOf(collections, shelf.id)
      .map((step) => step.title)
      .join(' / '),
    description: shelf.description,
  }))

  const found = await identifyFromFirstPage({
    shelves,
    filenames: uploadedNames(book),
    sourceKind: book.conversion?.sourceKind,
    sourceKey: book.conversion?.sourceKey,
    coverKey: book.generatedCover?.state === 'ready' ? book.generatedCover.key : null,
  })

  if (found === null) return 'failed'

  const data: {
    title?: string
    slug?: string
    author?: string
    language?: typeof book.language
    collection?: number
  } = {}

  if (found.title && found.title !== book.title) {
    const taken = await payload.find({
      collection: 'books',
      where: { and: [{ title: { equals: found.title } }, { id: { not_equals: book.id } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (taken.docs.length === 0) {
      data.title = found.title
      data.slug = await freeBookSlug(payload, bookSlug(found.title), book.id)
    }
  }
  if (found.author) data.author = found.author
  if (found.language) data.language = found.language
  if (found.collection) data.collection = found.collection

  if (Object.keys(data).length === 0) return 'nothing'

  try {
    await payload.update({ collection: 'books', id: book.id, data, overrideAccess: true })
  } catch (error) {
    logError('identifyUpload: update book', error)
    return 'failed'
  }
  revalidatePath('/account/books')
  revalidatePath(`/account/books/${book.id}`)
  if (isInPublicLibrary(book)) {
    revalidatePath('/')
    revalidatePath('/books')
    revalidatePath(`/books/${book.slug}`)
    if (data.slug) revalidatePath(`/books/${data.slug}`)
  }
  return 'filled'
}
