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
  } catch {
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
