import type { Payload } from 'payload'

import { statusFromProvider } from '../domain/creditPurchases'
import type { CreditPurchase } from '../payload-types'
import { applyCredits } from './credits'
import { logError } from './logError'

export async function findPurchaseByOrder(
  payload: Payload,
  orderId: string,
): Promise<CreditPurchase | null> {
  const found = await payload.find({
    collection: 'credit-purchases',
    where: { orderId: { equals: orderId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return found.docs[0] ?? null
}

async function creditOnce(payload: Payload, purchase: CreditPurchase): Promise<void> {
  const claimed = await payload.update({
    collection: 'credit-purchases',
    where: { and: [{ id: { equals: purchase.id } }, { status: { not_equals: 'paid' } }] },
    data: { status: 'paid', creditedAt: new Date().toISOString() },
    overrideAccess: true,
  })
  if (claimed.docs.length === 0) return

  try {
    await applyCredits(payload, typeof purchase.user === 'object' ? purchase.user.id : purchase.user, [
      { delta: purchase.credits, reason: 'purchase' },
    ])
  } catch (error) {
    logError('credit purchase: apply credits', error)
    await payload.update({
      collection: 'credit-purchases',
      id: purchase.id,
      data: { status: 'pending', creditedAt: null },
      overrideAccess: true,
    })
    throw error
  }
}

export async function settleFromProvider(
  payload: Payload,
  purchase: CreditPurchase,
  providerStatus: string,
): Promise<CreditPurchase['status']> {
  const next = statusFromProvider(providerStatus)
  if (purchase.status === 'paid') return 'paid'
  if (next === 'paid') {
    await creditOnce(payload, purchase)
    return 'paid'
  }
  if (next === purchase.status) return purchase.status

  await payload.update({
    collection: 'credit-purchases',
    where: { and: [{ id: { equals: purchase.id } }, { status: { not_equals: 'paid' } }] },
    data: { status: next },
    overrideAccess: true,
  })
  return next
}
