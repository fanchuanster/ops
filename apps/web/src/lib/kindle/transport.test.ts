import { describe, expect, it } from 'vitest'

import { requestBody } from './transport'

/**
 * The body is written into an exactly-sized buffer a chunk at a time,
 * which buys the memory headroom the size limit is set from. Two things
 * can go wrong in that shape and both are silent:
 *
 *  - chunking base64 off a 3-byte boundary pads each piece
 *    independently, and the book arrives on the Kindle unopenable;
 *  - a mis-sized buffer or a bad offset leaves the JSON truncated or
 *    zero-padded, which Resend rejects with a 4xx a reader reads as
 *    "try again".
 *
 * So the test parses the body Resend would parse and decodes the
 * attachment Amazon would receive.
 */
function parse(body: Uint8Array) {
  const json = JSON.parse(new TextDecoder().decode(body))
  const content: string = json.attachments[0].content
  return { json, bytes: Uint8Array.from(atob(content), (c) => c.charCodeAt(0)) }
}

const envelope = {
  from: 'NobleSee <kindle@noblesee.com>',
  to: 'reader@kindle.com',
  subject: 'book.epub',
  filename: 'book.epub',
}

describe('requestBody', () => {
  it('round-trips the file at every length around the chunk boundary', () => {
    const CHUNK = 3 * 8192
    const source = new Uint8Array(CHUNK * 2 + 16)
    for (let i = 0; i < source.length; i++) source[i] = (i * 31 + (i >> 8)) & 0xff

    for (const length of [0, 1, 2, 3, 4, CHUNK - 1, CHUNK, CHUNK + 1, CHUNK + 2, CHUNK * 2 + 5]) {
      const content = source.slice(0, length)
      const { bytes } = parse(requestBody({ ...envelope, content }))
      expect(Array.from(bytes), `length ${length}`).toEqual(Array.from(content))
    }
  })

  it('carries bytes no text encoding would survive', () => {
    // A real EPUB is a zip: high bytes, nulls, nothing text-shaped.
    const content = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80, 0x7f, 0x01])
    const { bytes } = parse(requestBody({ ...envelope, content }))
    expect(Array.from(bytes)).toEqual(Array.from(content))
  })

  it('escapes a title that would otherwise break the document', () => {
    // Composing the envelope by hand is what makes this worth pinning:
    // a quote in a filename must not end the JSON string, and a CJK
    // title must survive as itself.
    const { json } = parse(
      requestBody({
        ...envelope,
        subject: '論語 "選"',
        filename: 'a"b\\c.epub',
        content: new Uint8Array([1, 2, 3]),
      }),
    )
    expect(json.subject).toBe('論語 "選"')
    expect(json.attachments[0].filename).toBe('a"b\\c.epub')
    expect(json.to).toEqual(['reader@kindle.com'])
  })

  it('sizes the buffer exactly, leaving no padding to truncate the JSON', () => {
    const content = new Uint8Array(3 * 8192 + 7)
    const body = requestBody({ ...envelope, content })
    expect(body[body.length - 1]).toBe('}'.charCodeAt(0))
    expect(body.indexOf(0)).toBe(-1)
  })
})
