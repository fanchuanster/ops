import type { Payload } from 'payload'

import { QUOTA_COUNTED_STATES } from '../domain/pipeline'
import { type QuotaDecision, type QuotaUsage, checkUploadQuota } from '../domain/uploadQuota'

export async function usageThisMonth(
  payload: Payload,
  userId: string | number,
  now = new Date(),
  excludeBookId?: string | number,
): Promise<QuotaUsage> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const converted = await payload.find({
    collection: 'books',
    where: {
      and: [
        { owner: { equals: userId } },
        ...(excludeBookId === undefined ? [] : [{ id: { not_equals: excludeBookId } }]),
        { 'conversion.state': { in: QUOTA_COUNTED_STATES } },
        { 'conversion.startedAt': { greater_than_equal: monthStart.toISOString() } },
      ],
    },
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })

  return {
    uploads: converted.docs.length,
    pages: converted.docs.reduce(
      (total, book) => total + (book.pageCount ?? book.estimatedPages ?? 0),
      0,
    ),
  }
}

export async function checkQuotaFor(
  payload: Payload,
  {
    userId,
    pagesRequested,
    isAdmin,
    now = new Date(),
    excludeBookId,
  }: {
    userId: string | number
    pagesRequested: number
    isAdmin: boolean
    now?: Date
    excludeBookId?: string | number
  },
): Promise<QuotaDecision> {
  if (isAdmin) return checkUploadQuota({ uploads: 0, pages: 0, pagesRequested, isAdmin: true })

  const usage = await usageThisMonth(payload, userId, now, excludeBookId)
  return checkUploadQuota({ ...usage, pagesRequested })
}
