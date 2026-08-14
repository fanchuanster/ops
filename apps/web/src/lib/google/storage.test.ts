/**
 * Staging books into the conversion bucket.
 *
 * The behaviour under test is "do not send a file that is already
 * there". A book is tens of megabytes, and a retried job re-uploading
 * it spends bandwidth and minutes to arrive at bytes already in the
 * bucket.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { statObject, uploadIfAbsent } from './storage'

const BUCKET = 'noblesee-conversion-296702'
let calls: { url: string; method: string }[] = []

function respondWith(handler: (url: string, method: string) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method })
      return handler(url, method)
    }),
  )
}

const uploads = () => calls.filter((call) => call.method === 'POST')

beforeEach(() => {
  calls = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checking before sending', () => {
  it('does not upload when the object is already there', async () => {
    respondWith(() => Response.json({ name: 'input/books/1/source.pdf', size: '978315' }))

    const outcome = await uploadIfAbsent({
      token: 't',
      bucket: BUCKET,
      name: 'input/books/1/source.pdf',
      body: new Uint8Array(10),
      contentType: 'application/pdf',
    })

    expect(outcome).toBe('already-there')
    expect(uploads()).toHaveLength(0)
  })

  it('uploads when it is not', async () => {
    respondWith((_url, method) =>
      method === 'POST' ? Response.json({ name: 'x' }) : new Response(null, { status: 404 }),
    )

    const outcome = await uploadIfAbsent({
      token: 't',
      bucket: BUCKET,
      name: 'input/books/1/source.pdf',
      body: new Uint8Array(10),
      contentType: 'application/pdf',
    })

    expect(outcome).toBe('uploaded')
    expect(uploads()).toHaveLength(1)
  })

  it('sends ifGenerationMatch=0, so a race cannot double-write', async () => {
    respondWith((_url, method) =>
      method === 'POST' ? Response.json({ name: 'x' }) : new Response(null, { status: 404 }),
    )

    await uploadIfAbsent({
      token: 't',
      bucket: BUCKET,
      name: 'input/a.pdf',
      body: new Uint8Array(1),
      contentType: 'application/pdf',
    })

    expect(uploads()[0]!.url).toContain('ifGenerationMatch=0')
  })

  it('treats losing that race as success', async () => {
    // 412 means another job uploaded it between our check and our write.
    // That is the outcome we wanted, reached by someone else.
    respondWith((_url, method) =>
      method === 'POST' ? new Response(null, { status: 412 }) : new Response(null, { status: 404 }),
    )

    await expect(
      uploadIfAbsent({
        token: 't',
        bucket: BUCKET,
        name: 'input/a.pdf',
        body: new Uint8Array(1),
        contentType: 'application/pdf',
      }),
    ).resolves.toBe('already-there')
  })

  it('raises anything else, rather than reporting a phantom upload', async () => {
    respondWith((_url, method) =>
      method === 'POST'
        ? new Response('no permission', { status: 403 })
        : new Response(null, { status: 404 }),
    )

    await expect(
      uploadIfAbsent({
        token: 't',
        bucket: BUCKET,
        name: 'input/a.pdf',
        body: new Uint8Array(1),
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow(/403/)
  })
})

describe('stat', () => {
  it('returns null for a missing object rather than throwing', async () => {
    respondWith(() => new Response(null, { status: 404 }))
    expect(await statObject('t', BUCKET, 'nope')).toBeNull()
  })

  it('escapes slashes in the object name', async () => {
    respondWith(() => new Response(null, { status: 404 }))
    await statObject('t', BUCKET, 'input/books/1/source.pdf')
    expect(calls[0]!.url).toContain('input%2Fbooks%2F1%2Fsource.pdf')
  })

  it('reports the size, so a truncated upload is detectable', async () => {
    respondWith(() => Response.json({ name: 'a', size: '978315' }))
    expect(await statObject('t', BUCKET, 'a')).toEqual({ name: 'a', size: 978315 })
  })
})
