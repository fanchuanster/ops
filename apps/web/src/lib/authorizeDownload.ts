import type { Payload } from 'payload'

import { type DeliveryDecision, decideDelivery, priceInCredits } from '../domain/credits'
import type { Book } from '../payload-types'
import { readingFormat } from '../domain/publication'
import { canAccessArtifact, canReadOnline, isPubliclyDistributable } from '../domain/rights'
import { logError } from './logError'

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
      cost: number
      isResend: boolean
    }
  | { allowed: false; refusal: DownloadRefusal }

const EXTENSION: Record<string, string> = {
  docx: 'docx',
  epub: 'epub',
  pdf: 'pdf',
  txt: 'txt',
}

export function filenameFor(bookTitle: string, format: string): string {
  const stem = bookTitle
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  const suffix = format.startsWith('pdf_') ? `-${format.slice(4)}` : ''
  return `${stem || 'book'}${suffix}.${EXTENSION[format] ?? 'bin'}`
}

export async function authorizeReading({
  payload,
  bookId,
  userId,
}: {
  payload: Payload
  bookId: string | number
  userId: string | number | null
}): Promise<
  | { allowed: true; storageKey: string; format: 'epub' | 'pdf' | 'txt' }
  | { allowed: false; refusal: DownloadRefusal }
> {
  const book = await loadBook(payload, bookId)
  if (!book) return { allowed: false, refusal: { reason: 'not_found' } }

  const gate = gateBook(book, userId, canReadOnline)
  if (gate) return { allowed: false, refusal: gate }

  const artifacts = (book.artifacts ?? []).filter((a) => Boolean(a.storageKey))
  const format = readingFormat(artifacts.map((a) => a.format))

  if (!format) return { allowed: false, refusal: { reason: 'format_unavailable' } }

  return {
    allowed: true,
    storageKey: artifacts.find((a) => a.format === format)!.storageKey!,
    format,
  }
}

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

  const artifact = (book.artifacts ?? []).find((a) => a.format === format)
  if (!artifact || artifact.downloadable === false || !artifact.storageKey) {
    return { allowed: false, refusal: { reason: 'format_unavailable' } }
  }

  const ownerId = typeof book.owner === 'object' ? book.owner?.id : book.owner
  const isOwnUpload = Boolean(ownerId) && String(ownerId) === String(userId)

  const { ownsBook } = await import('./credits')
  const alreadyOwned = await ownsBook(payload, userId, book.id)

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
    return await payload.findByID({
      collection: 'books',
      id: bookId,
      depth: 1,
      overrideAccess: true,
    })
  } catch (error) {
    logError('authorizeDownload: load book', error)
    return null
  }
}

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

  if (!isResend) {
    await recordEntitlement(payload, { userId, bookId, creditsPaid: cost })
  }

  await payload.create({
    collection: 'downloads',
    data: { user: Number(userId), book: Number(bookId), format, creditsPaid: cost },
    overrideAccess: true,
  })

  await payUploaderShare(payload, { bookId, creditsSpent: cost, paidBy: userId })
}

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
  }
}
