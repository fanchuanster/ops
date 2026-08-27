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

import { KINDLE_SENDER_ADDRESS, encodedSize } from '../../domain/kindle'

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
        body: requestBody({
          from: `NobleSee <${KINDLE_SENDER_ADDRESS}>`,
          to,
          subject,
          filename: attachment.filename,
          content: attachment.content,
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
 * The JSON Resend receives, assembled as bytes.
 *
 * **Base64 is not Resend's requirement and cannot be avoided.** An
 * attachment reaches a Kindle as MIME, and a MIME body has to be
 * 7-bit safe, so the file is base64 on the wire whichever provider or
 * protocol carries it. The 4/3 inflation is a property of email.
 *
 * What *was* avoidable is holding four copies of a book at once. The
 * previous shape encoded the whole file to a string, put that string in
 * an object, handed the object to `JSON.stringify`, and let `fetch`
 * serialise the result — the raw bytes plus three full-length copies,
 * which on a 128 MB Worker is what actually decided how large a book
 * could be.
 *
 * So the body is written once, into a buffer sized exactly:
 * `encodedSize` is arithmetic, not a guess, and the envelope is ASCII.
 * Peak memory is now the book plus its encoded form and nothing else,
 * which is the floor for anything that is not a streamed body — and a
 * streamed body would mean chunked transfer encoding, which is a bet on
 * the provider accepting it for a saving of one copy.
 *
 * The envelope is composed by hand rather than with `JSON.stringify` on
 * a whole object, because the whole object is the thing we are avoiding
 * building. Every interpolated value still goes through `JSON.stringify`
 * individually, so escaping is the standard library's job — a filename
 * with a quote or a CJK title must not be able to break the document.
 */
export function requestBody({
  from,
  to,
  subject,
  filename,
  content,
}: {
  from: string
  to: string
  subject: string
  filename: string
  content: Uint8Array
  // `Uint8Array<ArrayBuffer>` rather than the default
  // `Uint8Array<ArrayBufferLike>`: only the former satisfies `BodyInit`,
  // since a view over a SharedArrayBuffer cannot be sent.
}): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()

  // The body Amazon sees is irrelevant — Send to Kindle reads the
  // attachment and ignores the message — but an empty body makes the
  // mail look like spam to everything in between, so there is a short
  // one.
  const head = encoder.encode(
    `{"from":${JSON.stringify(from)},` +
      `"to":[${JSON.stringify(to)}],` +
      `"subject":${JSON.stringify(subject)},` +
      `"text":${JSON.stringify('Sent from NobleSee. The book is attached.')},` +
      `"attachments":[{"filename":${JSON.stringify(filename)},"content":"`,
  )
  const tail = encoder.encode('"}]}')

  const body = new Uint8Array(head.length + encodedSize(content.length) + tail.length)
  body.set(head, 0)

  let offset = head.length
  for (const chunk of base64Chunks(content)) {
    // `encodeInto` writes ASCII straight into the buffer, so no
    // full-length string of the encoded book ever exists.
    offset += encoder.encodeInto(chunk, body.subarray(offset)).written ?? 0
  }

  body.set(tail, offset)
  return body
}

/**
 * The file as base64, a chunk at a time.
 *
 * CHUNK must stay a multiple of 3. Base64 encodes three bytes to four
 * characters, so only on a 3-byte boundary can pieces be concatenated —
 * anywhere else `btoa` pads the chunk and the joined result decodes to
 * a corrupt file. That failure arrives as a book that reaches the
 * Kindle and will not open, which is worse than any refusal.
 *
 * The inner loop exists because `String.fromCharCode(...bytes)` blows
 * the call stack on a multi-megabyte array — the failure that only
 * shows up on a real book rather than the small ones used in testing.
 */
function* base64Chunks(bytes: Uint8Array): Generator<string> {
  const CHUNK = 3 * 8192
  const STACK = 0x8000

  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK)
    let binary = ''
    for (let j = 0; j < chunk.length; j += STACK) {
      binary += String.fromCharCode(...chunk.subarray(j, j + STACK))
    }
    yield btoa(binary)
  }
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
