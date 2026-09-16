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

    await payload.update({
      collection: 'users',
      id: userId,
      data: { creditsGrantedThrough: monthKey(now) },
      overrideAccess: true,
    })

    return { granted: totalCredits(grants), grants }
  } catch (error) {
    logError('credits: accrue monthly grant', error)
    return { granted: 0, grants: [] }
  }
}

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

export async function payUploaderShare(
  payload: Payload,
  {
    bookId,
    creditsSpent,
    paidBy,
  }: {
    bookId: string | number
    creditsSpent: number
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
    logError('credits: settle uploader share', error)
  }
}
