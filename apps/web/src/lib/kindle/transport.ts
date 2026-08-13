/**
 * Sending a document to a Kindle.
 *
 * Behind an interface because the provider is an implementation detail
 * that should not reach the rest of the application, and because
 * Workers cannot speak SMTP at all — there is no raw mail socket, so
 * every option here is somebody's HTTP API. Swapping Resend for SES
 * later should be a new file and a changed factory, nothing more.
 *
 * Configuration is by environment variable, never hard-coded: the key
 * is a Worker secret (`wrangler secret put RESEND_API_KEY`) and the
 * sender is a domain constant, so nothing sensitive is in the
 * repository.
 */

import { KINDLE_SENDER_ADDRESS } from '../../domain/kindle'

export interface KindleAttachment {
  filename: string
  /** Raw bytes; the transport handles any encoding the provider wants. */
  content: Uint8Array
}

export type KindleSendResult =
  | { sent: true; providerId?: string }
  | { sent: false; error: string }

export interface KindleTransport {
  send(args: { to: string; subject: string; attachment: KindleAttachment }): Promise<KindleSendResult>
}

/**
 * Resend, over its REST API.
 *
 * The body Amazon sees is irrelevant — Send to Kindle reads the
 * attachment and ignores the message — but an empty body makes the mail
 * look like spam to everything in between, so there is a short one.
 */
class ResendTransport implements KindleTransport {
  constructor(private readonly apiKey: string) {}

  async send({
    to,
    subject,
    attachment,
  }: {
    to: string
    subject: string
    attachment: KindleAttachment
  }): Promise<KindleSendResult> {
    let response: Response
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `NobleSee <${KINDLE_SENDER_ADDRESS}>`,
          to: [to],
          subject,
          text: 'Sent from NobleSee. The book is attached.',
          attachments: [
            {
              filename: attachment.filename,
              content: base64(attachment.content),
            },
          ],
        }),
      })
    } catch (error) {
      // A network failure is not the reader's fault and must not look
      // like a refusal — the caller distinguishes the two.
      return { sent: false, error: error instanceof Error ? error.message : 'Network error' }
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return { sent: false, error: `Resend returned ${response.status}: ${detail.slice(0, 200)}` }
    }

    const body = (await response.json().catch(() => null)) as { id?: string } | null
    return { sent: true, providerId: body?.id }
  }
}

/**
 * Base64 without Buffer, which does not exist on Workers.
 *
 * Chunked because `String.fromCharCode(...bytes)` on a multi-megabyte
 * array blows the call stack — the exact failure mode that only shows
 * up on a real book rather than the small ones used in testing.
 */
function base64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * The configured transport, or null when delivery is switched off.
 *
 * Returning null rather than throwing is what lets the feature be
 * absent cleanly: with no key set, the UI says delivery is unavailable
 * instead of offering a button that fails.
 */
export function kindleTransport(env: { RESEND_API_KEY?: string }): KindleTransport | null {
  const key = env.RESEND_API_KEY
  if (!key) return null
  return new ResendTransport(key)
}
