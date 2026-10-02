'use server'

import config from '@payload-config'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import {
  checkPurchaseAmount,
  isCoin,
  newOrderId,
  priceInUsd,
  windowEndsAt,
} from '../../../domain/creditPurchases'
import { getCurrentUser } from '../../../lib/auth'
import { findPurchaseByOrder, settleFromProvider } from '../../../lib/creditPurchases'
import { logError } from '../../../lib/logError'
import {
  createProviderPayment,
  fetchProviderPayment,
  nowPaymentsConfig,
} from '../../../lib/nowpayments'
import { siteUrl } from '../../../lib/siteUrl'

export type Invoice = {
  orderId: string
  credits: number
  priceUsd: number
  payCurrency: string
  payAddress: string
  payAmount: string
  expiresAt: string
}

export type StartState = { error?: string; invoice?: Invoice }

export type CheckState = { status: 'pending' | 'paid' | 'failed' | 'expired'; balance?: number }

async function providerConfig() {
  const { env } = await getCloudflareContext({ async: true })
  return nowPaymentsConfig(
    env as { NOWPAYMENTS_API_KEY?: string; NOWPAYMENTS_IPN_SECRET?: string },
  )
}

export async function startPurchase(credits: unknown, coin: unknown): Promise<StartState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const amount = checkPurchaseAmount(credits)
  if (!amount.ok) return { error: amount.problem }
  if (!isCoin(coin)) return { error: 'Choose a currency to pay with.' }

  const provider = await providerConfig()
  if (!provider) return { error: 'Paying with crypto is not set up on this site yet.' }

  const payload = await getPayload({ config })
  const orderId = newOrderId(user.id, crypto.randomUUID().replaceAll('-', '').slice(0, 16))
  const priceUsd = priceInUsd(amount.credits)

  const created = await createProviderPayment(provider, {
    priceUsd,
    payCurrency: coin,
    orderId,
    description: `${amount.credits} NobleSee credits`,
    callbackUrl: `${siteUrl()}/api/nowpayments/ipn`,
  })
  if (!created.ok) {
    logError('credit purchase: create payment', new Error(created.error))
    return { error: `The payment service refused it: ${created.error}` }
  }

  const { payment } = created
  if (!payment.payAddress || !payment.payAmount) {
    return { error: 'The payment service returned no address. Try another currency.' }
  }

  const expiresAt = windowEndsAt(new Date()).toISOString()
  await payload.create({
    collection: 'credit-purchases',
    data: {
      user: Number(user.id),
      orderId,
      credits: amount.credits,
      priceUsd,
      payCurrency: coin,
      providerPaymentId: payment.paymentId,
      payAddress: payment.payAddress,
      payAmount: payment.payAmount,
      status: 'pending',
      expiresAt,
    },
    overrideAccess: true,
  })

  return {
    invoice: {
      orderId,
      credits: amount.credits,
      priceUsd,
      payCurrency: coin,
      payAddress: payment.payAddress,
      payAmount: payment.payAmount,
      expiresAt,
    },
  }
}

export async function checkPurchase(orderId: string): Promise<CheckState> {
  const user = await getCurrentUser()
  if (!user) return { status: 'failed' }

  const payload = await getPayload({ config })
  const purchase = await findPurchaseByOrder(payload, orderId)
  const owner = purchase && (typeof purchase.user === 'object' ? purchase.user.id : purchase.user)
  if (!purchase || String(owner) !== String(user.id)) return { status: 'failed' }

  const provider = await providerConfig()
  if (purchase.status === 'pending' && provider && purchase.providerPaymentId) {
    const fetched = await fetchProviderPayment(provider, purchase.providerPaymentId)
    if (fetched.ok) {
      try {
        const status = await settleFromProvider(payload, purchase, fetched.payment.status)
        return finish(status, user.id, payload)
      } catch (error) {
        logError('credit purchase: settle on check', error)
      }
    }
  }

  return finish(purchase.status, user.id, payload)
}

async function finish(
  status: CheckState['status'],
  userId: string | number,
  payload: Awaited<ReturnType<typeof getPayload>>,
): Promise<CheckState> {
  if (status !== 'paid') return { status }
  const fresh = await payload.findByID({
    collection: 'users',
    id: userId,
    depth: 0,
    overrideAccess: true,
  })
  revalidatePath('/account')
  revalidatePath('/account/credits')
  return { status, balance: fresh.credits ?? 0 }
}
