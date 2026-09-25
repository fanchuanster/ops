'use server'

import config from '@payload-config'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { releasedExportHandle, statusOnQueue } from '../../../domain/pipeline'
import { needsConverter, resolvePlan } from '../../../domain/publication'
import { canMasterFrom, readSources, switchedToSource } from '../../../domain/sources'
import { quotaMessage } from '../../../domain/uploadQuota'
import { getCurrentUser } from '../../../lib/auth'
import { logError } from '../../../lib/logError'
import { settleQueuedBook } from '../../../lib/masterPipeline'
import { checkQuotaFor } from '../../../lib/uploadQuota'

export type SourceState = { error?: string }

export async function chooseMasterSource(
  _prev: SourceState,
  formData: FormData,
): Promise<SourceState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const bookId = Number(formData.get('bookId'))
  if (!Number.isInteger(bookId)) return { error: 'Nothing to convert.' }

  const payload = await getPayload({ config })
  const book = await payload
    .findByID({ collection: 'books', id: bookId, depth: 0, overrideAccess: true })
    .catch(() => null)

  const ownerId = typeof book?.owner === 'object' ? book?.owner?.id : book?.owner
  if (!book || !ownerId || String(ownerId) !== String(user.id)) {
    return { error: 'That book is not yours to edit.' }
  }

  const conversion = book.conversion ?? {}
  const wanted = String(formData.get('kind') || '')

  const source = readSources(conversion, book.artifacts).find(
    (candidate) => candidate.kind === wanted,
  )
  if (!source) return { error: 'That file is not one of this book’s sources.' }
  if (!canMasterFrom(source.kind)) {
    return {
      error:
        'An EPUB is already a reading edition, so there is nothing to build from it. Choose the scan or the text.',
    }
  }

  if (conversion.sourceKind === source.kind) return {}

  const plan = resolvePlan(source.kind, 'convert')

  if (needsConverter(source.kind, plan)) {
    const quota = await checkQuotaFor(payload, {
      userId: user.id,
      pagesRequested: book.estimatedPages ?? 0,
      isAdmin: Boolean(user.roles?.includes('admin')),
      excludeBookId: bookId,
    })
    if (!quota.allowed) {
      return { error: quotaMessage(quota) ?? 'You have reached this month’s limit.' }
    }
  }

  const observed = book.conversion?.state ?? 'none'

  let switched
  try {
    switched = await payload.update({
      collection: 'books',
      where: { and: [{ id: { equals: bookId } }, { 'conversion.state': { equals: observed } }] },
      data: {
        status: statusOnQueue((book.artifacts ?? []).map((artifact) => artifact.format)),
        conversion: {
          ...conversion,
          ...switchedToSource(source),
          state: 'queued',
          ...releasedExportHandle('queued'),
          goal: 'editions',
          plan,
          message: null,
          correction: {
            ...(conversion.correction ?? {}),
            state: 'none' as const,
            count: null,
            adopted: null,
            message: null,
          },
          startedAt: new Date().toISOString(),
        },
      },
      overrideAccess: true,
    })
  } catch (error) {
    logError('sources: choose master source', error)
    return { error: 'Could not switch to that file. Please try again.' }
  }

  if (switched.docs.length === 0) {
    return {
      error: 'This book moved on while you were choosing. Reload the page and try again.',
    }
  }

  await settleQueuedBook(payload, bookId)

  revalidatePath(`/account/books/${bookId}`)
  revalidatePath('/account/books')
  return {}
}
