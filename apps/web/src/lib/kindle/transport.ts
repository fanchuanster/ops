import { KINDLE_SENDER_ADDRESS, encodedSize } from '../../domain/kindle'

export interface KindleAttachment {
  filename: string
  content: Uint8Array
}

export type KindleSendResult =
  | { sent: true; providerId?: string }
  | { sent: false; error: string }

export interface KindleTransport {
  send(args: { to: string; subject: string; attachment: KindleAttachment }): Promise<KindleSendResult>
}

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
}): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()

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
    offset += encoder.encodeInto(chunk, body.subarray(offset)).written ?? 0
  }

  body.set(tail, offset)
  return body
}

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

export function kindleTransport(env: { RESEND_API_KEY?: string }): KindleTransport | null {
  const key = env.RESEND_API_KEY
  if (!key) return null
  return new ResendTransport(key)
}
