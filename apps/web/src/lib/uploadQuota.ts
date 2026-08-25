/**
 * Counting a reader's conversions this month.
 *
 * The rule is `domain/uploadQuota.ts`; this loads the numbers it needs.
 *
 * What counts is a book that has *entered conversion*, not one that was
 * uploaded — a draft sitting on the summary page has cost nothing, and
 * refusing an upload because of drafts the reader may never convert
 * would be charging them for a decision they have not made. That is
 * also why a refused conversion leaves the draft intact: the book waits
 * for next month rather than being thrown away.
 */

import type { Payload } from 'payload'

import { QUOTA_COUNTED_STATES } from '../domain/pipeline'
import { type QuotaDecision, type QuotaUsage, checkUploadQuota } from '../domain/uploadQuota'

/** Conversions started since the first of the current month, UTC. */
export async function usageThisMonth(
  payload: Payload,
  userId: string | number,
  now = new Date(),
  /**
   * A book to leave out of the count.
   *
   * For the one case where the book being decided about is already in
   * the month's usage: a PDF published as it stands has settled past
   * `draft`, so when its owner changes their mind and asks for a
   * conversion, counting it as existing usage *and* as the request
   * would charge it twice and refuse a long scan on the strength of
   * itself.
   */
  excludeBookId?: string | number,
): Promise<QuotaUsage> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const converted = await payload.find({
    collection: 'books',
    where: {
      and: [
        { owner: { equals: userId } },
        ...(excludeBookId === undefined ? [] : [{ id: { not_equals: excludeBookId } }]),
        // Anything past `draft` has been through the pipeline, or is in
        // it. A failed conversion still consumed the work. Derived from
        // the state list rather than spelled out here, so a new phase
        // state cannot be forgotten and silently under-count.
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
      // The real count once it is known, the estimate until then.
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
    /** See `usageThisMonth`: the book being decided about, if it is already counted. */
    excludeBookId?: string | number
  },
): Promise<QuotaDecision> {
  // Skip the query entirely for an administrator; there is no answer it
  // could give that would change the outcome.
  if (isAdmin) return checkUploadQuota({ uploads: 0, pages: 0, pagesRequested, isAdmin: true })

  const usage = await usageThisMonth(payload, userId, now, excludeBookId)
  return checkUploadQuota({ ...usage, pagesRequested })
}
