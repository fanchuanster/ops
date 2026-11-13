import config from '@payload-config'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getPayload } from 'payload'

import { findPurchaseByOrder, settleFromProvider } from '../../../../../lib/creditPurchases'
import { logError } from '../../../../../lib/logError'
import {
  nowPaymentsConfig,
  readNotification,
  verifyNotification,
} from '../../../../../lib/nowpayments'

export async function POST(request: Request): Promise<Response> {
  const { env } = await getCloudflareContext({ async: true })
  const provider = nowPaymentsConfig(
    env as { NOWPAYMENTS_API_KEY?: string; NOWPAYMENTS_IPN_SECRET?: string },
  )
  if (!provider?.ipnSecret) return new Response('not configured', { status: 503 })

  const body = await request.json().catch(() => null)
  const signature = request.headers.get('x-nowpayments-sig')
  if (!(await verifyNotification(provider.ipnSecret, body, signature))) {
    return new Response('bad signature', { status: 401 })
  }

  const notification = readNotification(body)
  if (!notification?.orderId) return new Response('ignored', { status: 200 })

  try {
    const payload = await getPayload({ config })
    const purchase = await findPurchaseByOrder(payload, notification.orderId)
    if (!purchase) return new Response('unknown order', { status: 200 })
    await settleFromProvider(payload, purchase, notification.status)
    return new Response('ok', { status: 200 })
  } catch (error) {
    logError('credit purchase: notification', error)
    return new Response('retry', { status: 500 })
  }
}
