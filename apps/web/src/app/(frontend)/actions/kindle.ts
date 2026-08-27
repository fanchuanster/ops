'use server'

import config from '@payload-config'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { checkKindleAddress, checkKindleDelivery, tooLargeMessage } from '../../../domain/kindle'
import { getCurrentUser } from '../../../lib/auth'
import { authorizeDownload, chargeForDelivery } from '../../../lib/authorizeDownload'
import { kindleTransport } from '../../../lib/kindle/transport'
import { artifactBytes } from '../../../lib/storage'

/**
 * Saving a delivery address, and sending a book to it.
 *
 * Both are server actions rather than route handlers because both are
 * form submissions from a page that already knows who the reader is.
 *
 * Sending goes through `authorizeDownload`: rights, availability and
 * price are decided there, and deciding them again here would create a
 * second answer free to drift from the first. Kindle delivery is a
 * download that happens to arrive by email, so it is authorized like
 * one and charged like one.
 *
 * The order below is deliberate and worth keeping: authorize, fetch,
 * send, *then* charge. Credits only ever leave a reader's balance after
 * a book has actually left the building.
 */

/**
 * `sent` is what the send button reads, rather than the presence of a
 * notice string. A delivery that succeeded is a state the UI reacts to;
 * making that depend on whether some prose happens to be non-empty
 * couples the button to the wording.
 */
export type KindleState = {
  error?: string
  notice?: string
  sent?: boolean
  /** Credits this send cost, so the button can say what was spent. */
  spent?: number
  /** The reader's balance afterwards, for the next confirmation. */
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

  // Empty clears it, which is how a reader turns delivery off.
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

  // Rights, availability and price, decided in one place.
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
        // Least-informative-first: a reader who may not see the book is
        // not told it exists.
        return { error: 'That book is not available to you.' }
    }
  }

  const bytes = await artifactBytes(decision.storageKey)
  if (!bytes) return { error: 'That file is missing from storage.' }

  // Size is only knowable once the bytes are in hand, so it is checked
  // here rather than in the eligibility pass above.
  const sizeCheck = checkKindleDelivery({
    kindleAddress: user.kindleEmail,
    format,
    bytes: bytes.byteLength,
    transportConfigured: true,
  })
  if (!sizeCheck.ok) {
    // Never "download it instead": there is no download. A book is read
    // here or sent to a device, which is a product decision rather than
    // a missing feature, so the refusal points at the reader that does
    // exist. The two sizes are both named because "too large" without a
    // number leaves a reader with nothing to act on — knowing the book
    // is 41 MB against a 25 MB limit at least explains the silence.
    return { error: tooLargeMessage(bytes.byteLength) }
  }

  const result = await transport!.send({
    to: eligibility.address,
    subject: decision.filename,
    attachment: { filename: decision.filename, content: bytes },
  })

  if (!result.sent) {
    // Nothing charged and nothing recorded: the book never left, and
    // billing a reader for our failure would be wrong. This ordering —
    // send first, charge second — is the whole reason the decision
    // above only decides.
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
  // No notice: the button turns green and says "Sent", which is the
  // whole message. A line of prose next to it said the same thing twice.
  return {
    sent: true,
    spent: decision.cost,
    balance: Math.max(0, (user.credits ?? 0) - decision.cost),
  }
}
