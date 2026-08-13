'use server'

import config from '@payload-config'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import { checkKindleAddress, checkKindleDelivery } from '../../../domain/kindle'
import { getCurrentUser } from '../../../lib/auth'
import { authorizeDownload, recordDownload } from '../../../lib/authorizeDownload'
import { kindleTransport } from '../../../lib/kindle/transport'
import { artifactBytes } from '../../../lib/storage'

/**
 * Saving a delivery address, and sending a book to it.
 *
 * Both are server actions rather than route handlers because both are
 * form submissions from a page that already knows who the reader is.
 *
 * Sending deliberately goes through `authorizeDownload`: rights,
 * staged release and the per-reader limit are decided there for the
 * download path, and deciding them again here would create a second
 * answer free to drift from the first. Kindle delivery is a download
 * that happens to arrive by email, so it is authorized like one and
 * recorded in the same ledger — a reader who takes the EPUB and also
 * sends it to their Kindle has still read one book, and the limit
 * counts books.
 */

export type KindleState = { error?: string; notice?: string }

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

  const partId = String(formData.get('partId') || '')
  const format = String(formData.get('format') || 'epub')
  if (!partId) return { error: 'Nothing to send.' }

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

  // The same decision the download button gets, for the same reasons —
  // including consuming a slot, since this is a download.
  const decision = await authorizeDownload({
    payload,
    partId,
    format,
    userId: user.id,
  })

  if (!decision.allowed) {
    switch (decision.refusal.reason) {
      case 'limit_reached':
        return { error: 'You have reached your download limit for now.' }
      case 'part_not_released':
        return { error: 'That part has not opened for you yet.' }
      case 'format_unavailable':
        return { error: 'That format is not available for this part.' }
      default:
        // Least-informative-first, matching the download route: a
        // reader who may not see the book is not told it exists.
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
    return { error: 'That file is too large to email. Download it directly instead.' }
  }

  const result = await transport!.send({
    to: eligibility.address,
    subject: decision.filename,
    attachment: { filename: decision.filename, content: bytes },
  })

  if (!result.sent) {
    // Not recorded against the limit: nothing was delivered, and
    // charging a reader for our failure would be wrong.
    return { error: 'Could not send it just now. Try again in a moment.' }
  }

  await recordDownload(payload, {
    userId: user.id,
    bookId: decision.bookId,
    partId: decision.partId,
    format,
  })

  revalidatePath('/account')
  return { notice: `Sent to ${eligibility.address}. It may take a few minutes to appear.` }
}
