/**
 * Where the rules meet, for a book leaving the site.
 *
 * Rights clearance and the credit price are each decided by a
 * framework-independent function in `src/domain`. This module does the
 * part those functions deliberately refuse to do: load the state they
 * need, and act on their answers.
 *
 * Two things changed on 2026-08-14 and both are load-bearing here:
 *
 *   - **Books are whole.** Parts are gone, so authorization is per book
 *     and there is no staged release to consult.
 *   - **Credits are the gate.** The rolling 24-hour cap is gone. The
 *     first delivery of a book costs its price; every later one costs
 *     the flat resend rate, which is now the only thing bounding how
 *     fast an account can pull the library.
 *
 * Reading online does not come through here at all. It is free,
 * unlimited, and needs no account — see `authorizeReading`.
 *
 * Order matters, and it is least-informative-first. A reader who may
 * not see a book is told "not found" rather than "you cannot afford it"
 * — the second answer confirms the book exists.
 */

import type { Payload } from 'payload'

import { type DeliveryDecision, decideDelivery, priceInCredits } from '../domain/credits'
import type { Book } from '../payload-types'
import { canAccessArtifact, canReadOnline, isPubliclyDistributable } from '../domain/rights'

export type DownloadRefusal =
  | { reason: 'not_found' }
  | { reason: 'authentication_required' }
  | { reason: 'rights_not_cleared' }
  | { reason: 'not_owner' }
  | { reason: 'format_unavailable' }
  | { reason: 'insufficient_credits'; cost: number; short: number; isResend: boolean }

export type DownloadDecision =
  | {
      allowed: true
      storageKey: string
      filename: string
      bookId: string | number
      bookTitle: string
      /** What this send costs. Zero only for a reader's own upload. */
      cost: number
      isResend: boolean
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
export function filenameFor(bookTitle: string, format: string): string {
  const stem = bookTitle
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  const suffix = format.startsWith('pdf_') ? `-${format.slice(4)}` : ''
  return `${stem || 'book'}${suffix}.${EXTENSION[format] ?? 'bin'}`
}

/**
 * Whether a book may be read in the browser.
 *
 * Free, unlimited, and open to signed-out visitors: reading is the
 * mission, and nothing in the economy may stand in front of it. The
 * only questions are whether the book is publishable at all and, for a
 * private upload, whether this is the reader who owns it.
 */
export async function authorizeReading({
  payload,
  bookId,
  userId,
}: {
  payload: Payload
  bookId: string | number
  userId: string | number | null
}): Promise<
  { allowed: true; storageKey: string } | { allowed: false; refusal: DownloadRefusal }
> {
  const book = await loadBook(payload, bookId)
  if (!book) return { allowed: false, refusal: { reason: 'not_found' } }

  const gate = gateBook(book, userId, canReadOnline)
  if (gate) return { allowed: false, refusal: gate }

  const artifact = (book.artifacts ?? []).find((a) => a.format === 'epub')
  if (!artifact?.storageKey) {
    return { allowed: false, refusal: { reason: 'format_unavailable' } }
  }

  return { allowed: true, storageKey: artifact.storageKey }
}

/**
 * Whether a book may be sent to this reader's device, and what it costs.
 *
 * Decides only. Nothing is charged and nothing is recorded here —
 * `chargeForDelivery` does that, after the send has actually succeeded,
 * so a reader is never billed for an email that never left.
 */
export async function authorizeDownload({
  payload,
  bookId,
  format,
  userId,
}: {
  payload: Payload
  bookId: string | number
  format: string
  userId: string | number | null
}): Promise<DownloadDecision> {
  if (!userId) return { allowed: false, refusal: { reason: 'authentication_required' } }

  const book = await loadBook(payload, bookId)
  if (!book) return { allowed: false, refusal: { reason: 'not_found' } }

  const gate = gateBook(book, userId)
  if (gate) return { allowed: false, refusal: gate }

  // The format must exist and be one readers may have. The DOCX master
  // is the editorial source of truth, not a reader download.
  const artifact = (book.artifacts ?? []).find((a) => a.format === format)
  if (!artifact || artifact.downloadable === false || !artifact.storageKey) {
    return { allowed: false, refusal: { reason: 'format_unavailable' } }
  }

  const ownerId = typeof book.owner === 'object' ? book.owner?.id : book.owner
  const isOwnUpload = Boolean(ownerId) && String(ownerId) === String(userId)

  const { ownsBook } = await import('./credits')
  const alreadyOwned = await ownsBook(payload, userId, book.id)

  // Your own upload is yours. Charging a reader credits for the book
  // they supplied would be absurd.
  const decision: DeliveryDecision = isOwnUpload
    ? { allowed: true, cost: 0, isResend: alreadyOwned, balanceAfter: 0 }
    : decideDelivery({
        price: book.priceCredits ?? priceInCredits(book.pageCount),
        balance: await balanceOf(payload, userId),
        alreadyOwned,
      })

  if (!decision.allowed) {
    return {
      allowed: false,
      refusal: {
        reason: 'insufficient_credits',
        cost: decision.cost,
        short: decision.short,
        isResend: decision.isResend,
      },
    }
  }

  return {
    allowed: true,
    storageKey: artifact.storageKey,
    filename: filenameFor(book.title, format),
    bookId: book.id,
    bookTitle: book.title,
    cost: decision.cost,
    isResend: decision.isResend,
  }
}

async function loadBook(payload: Payload, bookId: string | number) {
  try {
    // Access overridden so this module — not Payload's collection
    // rules — is the thing that decides, and a refusal is a considered
    // answer rather than an incidental 403.
    return await payload.findByID({
      collection: 'books',
      id: bookId,
      depth: 1,
      overrideAccess: true,
    })
  } catch {
    return null
  }
}

/**
 * The checks common to reading and sending: rights, visibility, and
 * whether an unpublished book belongs to the person asking.
 *
 * Returns a refusal, or null to continue.
 */
function gateBook(
  book: Book,
  userId: string | number | null,
  rule: typeof canAccessArtifact = canAccessArtifact,
): DownloadRefusal | null {
  const ownerId =
    book.owner && typeof book.owner === 'object'
      ? (book.owner as { id: string | number }).id
      : (book.owner as string | number | undefined)

  const access = rule({
    book: { rightsStatus: book.rightsStatus, visibility: book.visibility },
    userId: userId ? String(userId) : null,
    ownerId: ownerId ? String(ownerId) : undefined,
  })

  if (!access.allowed) {
    // A private book that isn't yours, or an uncleared one, should not
    // be distinguishable from one that does not exist.
    if (access.reason === 'not_owner') return { reason: 'not_found' }
    return { reason: access.reason }
  }

  const isOwn = Boolean(ownerId) && String(ownerId) === String(userId)
  if ((book.status !== 'published' || !isPubliclyDistributable(book.rightsStatus)) && !isOwn) {
    return { reason: 'not_found' }
  }

  return null
}

async function balanceOf(payload: Payload, userId: string | number): Promise<number> {
  const user = await payload.findByID({ collection: 'users', id: userId, overrideAccess: true })
  return user.credits ?? 0
}

/**
 * Charge for a delivery that actually happened, and record it.
 *
 * Called only after the transport reports success. A reader is never
 * charged for a send that failed — see the ordering in the Kindle
 * action.
 */
export async function chargeForDelivery(
  payload: Payload,
  {
    userId,
    bookId,
    format,
    cost,
    isResend,
  }: {
    userId: string | number
    bookId: string | number
    format: string
    cost: number
    isResend: boolean
  },
): Promise<void> {
  const { applyCredits, payUploaderShare, recordEntitlement } = await import('./credits')

  if (cost > 0) {
    await applyCredits(payload, userId, [
      { delta: -cost, reason: isResend ? 'resend' : 'unlock', bookId },
    ])
  }

  // The purchase, recorded once. A resend is a delivery of a book the
  // reader already bought, so it adds no entitlement.
  if (!isResend) {
    await recordEntitlement(payload, { userId, bookId, creditsPaid: cost })
  }

  await payload.create({
    collection: 'downloads',
    data: { user: Number(userId), book: Number(bookId), format, creditsPaid: cost },
    overrideAccess: true,
  })

  // The uploader's cut, after the reader's credits have actually moved.
  // A share is a fraction of what was spent, so paying it any earlier
  // would be creating credits from a charge that might not have landed.
  await payUploaderShare(payload, { bookId, creditsSpent: cost, paidBy: userId })
}

/**
 * Marks a book as opened by this reader, if it was not already.
 *
 * Never moves an existing `startedAt` forward, so it keeps meaning
 * "first opened" — which is what the account history shows.
 */
export async function markBookStarted(
  payload: Payload,
  {
    userId,
    bookId,
    now = new Date(),
  }: { userId: string | number; bookId: string | number; now?: Date },
) {
  const existing = await payload.find({
    collection: 'reading-progress',
    where: { and: [{ user: { equals: userId } }, { book: { equals: bookId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (existing.docs.length > 0) return

  try {
    await payload.create({
      collection: 'reading-progress',
      data: { user: Number(userId), book: Number(bookId), startedAt: now.toISOString() },
      overrideAccess: true,
    })
  } catch {
    // The unique index on (user, book) is the real guard against a
    // double-open race; losing that race is not an error worth showing
    // someone who is trying to read a book.
  }
}
