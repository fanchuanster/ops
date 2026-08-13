/**
 * The single place where all three domain rules meet.
 *
 * Rights clearance, per-reader download limits and staged release are
 * each decided by a framework-independent function in `src/domain`.
 * This module does the part those functions deliberately refuse to do:
 * load the state they need, and act on their answers. Keeping the
 * decisions there and the plumbing here is what makes the rules
 * testable without a database.
 *
 * Order matters, and it is least-informative-first. A reader who is not
 * allowed to see a book at all is told "not found" rather than "you
 * have hit your limit" — the second answer confirms the book exists and
 * that they nearly had it, which is more than a refused request should
 * reveal.
 */

import type { Payload } from 'payload'

import {
  checkDownloadLimit,
  DEFAULT_LIMIT_POLICY,
  type DownloadRecord,
  type LimitPolicy,
} from '../domain/downloadLimit'
import { canAccessArtifact, effectiveRightsStatus, isPubliclyDistributable } from '../domain/rights'
import { releaseState } from '../domain/stagedRelease'

export type DownloadRefusal =
  | { reason: 'not_found' }
  | { reason: 'authentication_required' }
  | { reason: 'rights_not_cleared' }
  | { reason: 'not_owner' }
  | { reason: 'format_unavailable' }
  | { reason: 'part_not_released'; opensAt?: Date }
  | { reason: 'limit_reached'; retryAfter: Date }

export type DownloadDecision =
  | {
      allowed: true
      storageKey: string
      filename: string
      bookId: string | number
      partId: string | number
    }
  | { allowed: false; refusal: DownloadRefusal }

const EXTENSION: Record<string, string> = {
  docx: 'docx',
  epub: 'epub',
  pdf_standard: 'pdf',
  pdf_large: 'pdf',
  pdf_xl: 'pdf',
}

/** Filesystem-safe, readable, and stable across a book's re-editing. */
function filenameFor(bookTitle: string, partOrder: number, format: string): string {
  const stem = bookTitle
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  const suffix = format.startsWith('pdf_') ? `-${format.slice(4)}` : ''
  return `${stem || 'book'}-part-${partOrder}${suffix}.${EXTENSION[format] ?? 'bin'}`
}

export async function authorizeDownload({
  payload,
  partId,
  format,
  userId,
  now = new Date(),
  policy = DEFAULT_LIMIT_POLICY,
  enforceDownloadLimit = true,
}: {
  payload: Payload
  partId: string
  format: string
  userId: string | number | null
  now?: Date
  policy?: LimitPolicy
  /**
   * Reading online does not consume a slot. The limit exists to keep
   * bulk *downloading* fair; charging someone for opening a book in the
   * browser would penalise exactly the behaviour the site is for.
   */
  enforceDownloadLimit?: boolean
}): Promise<DownloadDecision> {
  // Loaded with access overridden so this module — not Payload's
  // collection rules — is the thing that decides, and so a refusal is a
  // considered answer rather than an incidental 403.
  let part
  try {
    part = await payload.findByID({
      collection: 'parts',
      id: partId,
      depth: 1,
      overrideAccess: true,
    })
  } catch {
    return { allowed: false, refusal: { reason: 'not_found' } }
  }
  if (!part) return { allowed: false, refusal: { reason: 'not_found' } }

  const book = typeof part.book === 'object' ? part.book : null
  if (!book) return { allowed: false, refusal: { reason: 'not_found' } }

  const ownerId = typeof book.owner === 'object' ? book.owner?.id : book.owner

  // 1. Rights and ownership. A part may be more restricted than its
  //    book, never less, so the effective status is what governs.
  const rights = effectiveRightsStatus(book.rightsStatus, part.rightsStatus ?? undefined)
  const access = canAccessArtifact({
    book: { rightsStatus: rights, visibility: book.visibility },
    userId: userId ? String(userId) : null,
    ownerId: ownerId ? String(ownerId) : undefined,
  })

  if (!access.allowed) {
    // A private book that isn't yours, or an uncleared one, should not
    // be distinguishable from one that does not exist.
    if (access.reason === 'not_owner') return { allowed: false, refusal: { reason: 'not_found' } }
    return { allowed: false, refusal: { reason: access.reason } }
  }

  if (part.status !== 'published' || !isPubliclyDistributable(rights)) {
    if (!ownerId || String(ownerId) !== String(userId)) {
      return { allowed: false, refusal: { reason: 'not_found' } }
    }
  }

  // 2. The format must exist and be one readers may have. The DOCX
  //    master is the editorial source of truth, not a reader download.
  const artifact = (part.artifacts ?? []).find((a) => a.format === format)
  if (!artifact || artifact.downloadable === false || !artifact.storageKey) {
    return { allowed: false, refusal: { reason: 'format_unavailable' } }
  }

  // 3. Staged release, on this reader's clock.
  const progress = await readerProgress(payload, userId!, book.id)
  const release = releaseState(
    part.order,
    progress,
    {
      enabled: Boolean(book.stagedRelease?.enabled),
      unlockDelayHours: book.stagedRelease?.unlockDelayHours ?? 24,
    },
    now,
  )
  if (release.state === 'waiting') {
    return { allowed: false, refusal: { reason: 'part_not_released', opensAt: release.opensAt } }
  }
  if (release.state === 'locked') {
    return { allowed: false, refusal: { reason: 'part_not_released' } }
  }

  // 4. The rolling per-reader limit, counting books rather than files.
  if (enforceDownloadLimit) {
    const history = await downloadHistory(payload, userId!, now, policy)
    const limit = checkDownloadLimit(String(book.id), history, now, policy)
    if (!limit.allowed) {
      return { allowed: false, refusal: { reason: 'limit_reached', retryAfter: limit.retryAfter } }
    }
  }

  return {
    allowed: true,
    storageKey: artifact.storageKey,
    filename: filenameFor(book.title, part.order, format),
    bookId: book.id,
    partId: part.id,
  }
}

async function readerProgress(payload: Payload, userId: string | number, bookId: string | number) {
  const rows = await payload.find({
    collection: 'reading-progress',
    where: { and: [{ user: { equals: userId } }, { book: { equals: bookId } }] },
    limit: 500,
    overrideAccess: true,
  })
  return {
    startedAt: new Map(rows.docs.map((row) => [row.partOrder, new Date(row.startedAt)])),
  }
}

async function downloadHistory(
  payload: Payload,
  userId: string | number,
  now: Date,
  policy: LimitPolicy,
): Promise<DownloadRecord[]> {
  // Only the window is loaded, not the reader's whole history — the
  // ledger grows without bound and the rule only ever looks back
  // `windowHours`.
  const cutoff = new Date(now.getTime() - policy.windowHours * 60 * 60 * 1000)
  const rows = await payload.find({
    collection: 'downloads',
    where: {
      and: [{ user: { equals: userId } }, { createdAt: { greater_than: cutoff.toISOString() } }],
    },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  return rows.docs.map((row) => ({
    bookId: String(typeof row.book === 'object' ? row.book.id : row.book),
    at: new Date(row.createdAt),
  }))
}

/** Records an authorized download. Called only after a positive decision. */
export async function recordDownload(
  payload: Payload,
  {
    userId,
    bookId,
    partId,
    format,
  }: {
    userId: string | number
    bookId: string | number
    partId: string | number
    format: string
  },
) {
  await payload.create({
    collection: 'downloads',
    // Ids are numeric in Postgres; callers hand them through as they
    // received them, so normalise here rather than at every call site.
    data: { user: Number(userId), book: Number(bookId), part: Number(partId), format },
    overrideAccess: true,
  })
}

/**
 * Marks a part as started for this reader, if it was not already.
 *
 * Never moves an existing `startedAt` forward: re-opening a part must
 * not restart the delay on the next one.
 */
export async function markPartStarted(
  payload: Payload,
  {
    userId,
    bookId,
    partOrder,
    now = new Date(),
  }: {
    userId: string | number
    bookId: string | number
    partOrder: number
    now?: Date
  },
) {
  const existing = await payload.find({
    collection: 'reading-progress',
    where: {
      and: [
        { user: { equals: userId } },
        { book: { equals: bookId } },
        { partOrder: { equals: partOrder } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })
  if (existing.docs.length > 0) return

  await payload.create({
    collection: 'reading-progress',
    data: {
      user: Number(userId),
      book: Number(bookId),
      partOrder,
      startedAt: now.toISOString(),
    },
    overrideAccess: true,
  })
}
