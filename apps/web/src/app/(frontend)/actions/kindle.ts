'use server'

import config from '@payload-config'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import {
  checkKindleAddress,
  checkKindleDelivery,
  kindleSubject,
  tooLargeMessage,
} from '../../../domain/kindle'
import { getCurrentUser } from '../../../lib/auth'
import { authorizeDownload, chargeForDelivery } from '../../../lib/authorizeDownload'
import { kindleTransport } from '../../../lib/kindle/transport'
import { artifactBytes } from '../../../lib/storage'

export type KindleState = {
  error?: string
  notice?: string
  sent?: boolean
  converted?: boolean
  spent?: number
  balance?: number
}

export async function saveKindleAddress(
  _prev: KindleState,
  formData: FormData,
): Promise<KindleState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first.' }

  const raw = String(formData.get('kindleEmail') || '').trim()
  const payload = await getPayload({ config })

  if (!raw) {
    await payload.update({
      collection: 'users',
      id: user.id,
      data: { kindleEmail: null },
      overrideAccess: true,
    })
    revalidatePath('/account')
    return { notice: 'Kindle delivery turned off.' }
  }

  const check = checkKindleAddress(raw)
  if (!check.valid) {
    return {
      error:
        check.problem === 'wrong_domain'
          ? 'Use the address Amazon gave you — it ends in @kindle.com or @free.kindle.com.'
          : 'That does not look like an email address.',
    }
  }

  await payload.update({
    collection: 'users',
    id: user.id,
    data: { kindleEmail: check.address },
    overrideAccess: true,
  })
  revalidatePath('/account')
  return { notice: `Delivering to ${check.address}.` }
}

export async function sendToKindle(_prev: KindleState, formData: FormData): Promise<KindleState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in to send books to your Kindle.' }

  const bookId = String(formData.get('bookId') || '')
  const format = String(formData.get('format') || 'epub')
  const convert = formData.get('convert') === '1'
  if (!bookId) return { error: 'Nothing to send.' }

  const { env } = await getCloudflareContext({ async: true })
  const transport = kindleTransport(env as { RESEND_API_KEY?: string })

  const eligibility = checkKindleDelivery({
    kindleAddress: user.kindleEmail,
    format,
    transportConfigured: transport !== null,
  })
  if (!eligibility.ok) {
    switch (eligibility.refusal) {
      case 'no_address':
        return { error: 'Add your Kindle address on your account page first.' }
      case 'format_not_deliverable':
        return { error: 'That format cannot be sent to a Kindle.' }
      case 'delivery_unavailable':
        return { error: 'Kindle delivery is not configured on this site yet.' }
      default:
        return { error: 'That file cannot be sent to a Kindle.' }
    }
  }

  const payload = await getPayload({ config })

  const decision = await authorizeDownload({
    payload,
    bookId,
    format,
    userId: user.id,
  })

  if (!decision.allowed) {
    const refusal = decision.refusal
    switch (refusal.reason) {
      case 'insufficient_credits':
        return {
          error: refusal.isResend
            ? `Sending this again costs ${refusal.cost} credit. You do not have one.`
            : `This book costs ${refusal.cost} credits and you are ${refusal.short} short.`,
        }
      case 'format_unavailable':
        return { error: 'That format is not available for this book.' }
      default:
        return { error: 'That book is not available to you.' }
    }
  }

  const bytes = await artifactBytes(decision.storageKey)
  if (!bytes) return { error: 'That file is missing from storage.' }

  const sizeCheck = checkKindleDelivery({
    kindleAddress: user.kindleEmail,
    format,
    bytes: bytes.byteLength,
    transportConfigured: true,
  })
  if (!sizeCheck.ok) {
    return { error: tooLargeMessage(bytes.byteLength) }
  }

  const result = await transport!.send({
    to: eligibility.address,
    subject: kindleSubject({ filename: decision.filename, convert }),
    attachment: { filename: decision.filename, content: bytes },
  })

  if (!result.sent) {
    return { error: 'Could not send it just now. Try again in a moment.' }
  }

  await chargeForDelivery(payload, {
    userId: user.id,
    bookId: decision.bookId,
    format,
    cost: decision.cost,
    isResend: decision.isResend,
  })

  revalidatePath('/account')
  revalidatePath('/account/history')
  return {
    sent: true,
    converted: convert,
    spent: decision.cost,
    balance: Math.max(0, (user.credits ?? 0) - decision.cost),
  }
}
