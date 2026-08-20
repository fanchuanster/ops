/**
 * Moving credits.
 *
 * The only module permitted to change a reader's balance. Everything
 * that spends or grants goes through `applyCredits`, which writes the
 * ledger row and the new balance together — so the account of how a
 * reader got their credits can never disagree with the number the
 * delivery check reads.
 *
 * The decisions themselves are in `domain/credits.ts`: what a book
 * costs, what a month is worth, whether a reader can afford a send.
 * This module loads the state those functions need and records what
 * they decided.
 */

import type { Payload } from 'payload'

import {
  type CreditGrant,
  type CreditReason,
  SIGNUP_GRANT,
  accrualFor,
  monthKey,
  totalCredits,
} from '../domain/credits'
import { settleShare, shareForDelivery } from '../domain/uploaderShare'
import { logError } from './logError'

export interface CreditMovement {
  delta: number
  reason: CreditReason
  bookId?: string | number
  month?: string
}

/**
 * Apply one movement: ledger row plus balance, in that order.
 *
 * Ledger first, so a crash between the two leaves an explained credit
 * that was never spendable rather than a balance nobody can account
 * for. Under-crediting a reader is a bug we can find and fix; a balance
 * with no story behind it is one we cannot.
 *
 * D1 has no transaction across these two writes through Payload's local
 * API, which is why the ordering carries the weight instead.
 */
export async function applyCredits(
  payload: Payload,
  userId: string | number,
  movements: readonly CreditMovement[],
): Promise<number> {
  const user = await payload.findByID({ collection: 'users', id: userId, overrideAccess: true })
  let balance = user.credits ?? 0

  for (const movement of movements) {
    if (movement.delta === 0) continue
    balance += movement.delta

    await payload.create({
      collection: 'credit-ledger',
      data: {
        user: Number(userId),
        delta: movement.delta,
        reason: movement.reason,
        ...(movement.bookId ? { book: Number(movement.bookId) } : {}),
        ...(movement.month ? { month: movement.month } : {}),
        balanceAfter: balance,
      },
      overrideAccess: true,
    })
  }

  await payload.update({
    collection: 'users',
    id: userId,
    data: { credits: balance },
    overrideAccess: true,
  })

  return balance
}

/**
 * Record the opening balance for a newly created account.
 *
 * The `credits` field already defaults to `SIGNUP_GRANT`, so this does
 * not move the balance — it writes the ledger row that explains it, and
 * sets the accrual baseline so the reader's first month is not also
 * granted a moment later as a backdated inactive one.
 */
export async function grantSignupCredits(
  payload: Payload,
  userId: string | number,
  now = new Date(),
): Promise<void> {
  await payload.create({
    collection: 'credit-ledger',
    data: {
      user: Number(userId),
      delta: SIGNUP_GRANT,
      reason: 'signup',
      balanceAfter: SIGNUP_GRANT,
    },
    overrideAccess: true,
  })
  await payload.update({
    collection: 'users',
    id: userId,
    data: { credits: SIGNUP_GRANT, creditsGrantedThrough: monthKey(now) },
    overrideAccess: true,
  })
}

/**
 * Pay a reader whatever the calendar owes them.
 *
 * Called on sign-in. Cheap and idempotent in the common case: a reader
 * who has already been granted for this month causes one read and no
 * writes, which matters because it runs on every sign-in.
 *
 * Never throws. A reader must be able to sign in even if their grant
 * cannot be recorded; they will get it on the next attempt.
 */
export async function accrueMonthlyCredits(
  payload: Payload,
  userId: string | number,
  now = new Date(),
): Promise<{ granted: number; grants: CreditGrant[] }> {
  try {
    const user = await payload.findByID({ collection: 'users', id: userId, overrideAccess: true })
    const grants = accrualFor({ grantedThrough: user.creditsGrantedThrough, now })
    if (grants.length === 0) return { granted: 0, grants: [] }

    await applyCredits(
      payload,
      userId,
      grants.map((grant) => ({
        delta: grant.credits,
        reason: grant.reason as CreditReason,
        month: grant.month,
      })),
    )

    // Written after the grants, so an interrupted accrual is retried
    // rather than skipped. The month key is what makes the retry safe:
    // `accrualFor` will not re-grant a month already recorded here.
    await payload.update({
      collection: 'users',
      id: userId,
      data: { creditsGrantedThrough: monthKey(now) },
      overrideAccess: true,
    })

    return { granted: totalCredits(grants), grants }
  } catch (error) {
    // A reader silently not being paid is exactly the kind of fault
    // nobody reports, because nobody knows what their balance should
    // have been.
    logError('credits: accrue monthly grant', error)
    return { granted: 0, grants: [] }
  }
}

/** Does this reader already own this book? */
export async function ownsBook(
  payload: Payload,
  userId: string | number,
  bookId: string | number,
): Promise<boolean> {
  const found = await payload.find({
    collection: 'entitlements',
    where: { and: [{ user: { equals: userId } }, { book: { equals: bookId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return found.docs.length > 0
}

/** The books this reader has bought, newest first. */
export async function ownedBooks(payload: Payload, userId: string | number, limit = 200) {
  const found = await payload.find({
    collection: 'entitlements',
    where: { user: { equals: userId } },
    sort: '-createdAt',
    limit,
    depth: 1,
    overrideAccess: true,
  })
  return found.docs
}

/** Records the purchase that a first delivery represents. */
export async function recordEntitlement(
  payload: Payload,
  {
    userId,
    bookId,
    creditsPaid,
  }: { userId: string | number; bookId: string | number; creditsPaid: number },
): Promise<void> {
  await payload.create({
    collection: 'entitlements',
    data: { user: Number(userId), book: Number(bookId), creditsPaid },
    overrideAccess: true,
  })
}

/**
 * Pay an uploader their share of a delivery someone else paid for.
 *
 * Called after the reader has been charged, and only then — the share
 * is a fraction of credits that actually moved, so paying it before the
 * charge succeeded would create credits out of nothing.
 *
 * Never throws. A share that cannot be recorded must not fail the
 * delivery the reader already paid for; the loss is one fraction of one
 * credit, and the book still arrives.
 */
export async function payUploaderShare(
  payload: Payload,
  {
    bookId,
    creditsSpent,
    paidBy,
  }: {
    bookId: string | number
    creditsSpent: number
    /** The reader who paid, so an uploader is never paid by themselves. */
    paidBy: string | number
  },
): Promise<void> {
  try {
    if (creditsSpent <= 0) return

    const book = await payload.findByID({
      collection: 'books',
      id: bookId,
      depth: 0,
      overrideAccess: true,
    })
    const ownerId = typeof book.owner === 'object' ? book.owner?.id : book.owner

    // No uploader, or the uploader is the one sending it. Their own
    // delivery is free anyway, so this is belt and braces.
    if (!ownerId || String(ownerId) === String(paidBy)) return

    const points = shareForDelivery({
      creditsSpent,
      rightsStatus: book.rightsStatus,
      hasUploader: true,
    })
    if (points <= 0) return

    const owner = await payload.findByID({
      collection: 'users',
      id: ownerId,
      overrideAccess: true,
    })

    const settled = settleShare({ carry: owner.creditSharePoints ?? 0, points })

    // The carry always moves; the balance only when a whole credit has
    // accumulated. Written together so the two cannot disagree about
    // what has been paid.
    await payload.update({
      collection: 'users',
      id: ownerId,
      data: { creditSharePoints: settled.carry },
      overrideAccess: true,
    })

    if (settled.credits > 0) {
      await applyCredits(payload, ownerId, [
        { delta: settled.credits, reason: 'uploader_share', bookId },
      ])
    }
  } catch (error) {
    // See above: never at the cost of the delivery — but an uploader
    // quietly losing their share is worth knowing about.
    logError('credits: settle uploader share', error)
  }
}
