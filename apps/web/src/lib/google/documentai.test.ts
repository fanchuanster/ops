/**
 * Turning Document AI output back into pages.
 *
 * The load-bearing test is the sharded one. Document AI returns text
 * offsets relative to the whole document while each shard carries only
 * its own slice of the text, so a shard has to be indexed by
 * (segment − textOffset). On a single-shard document the offset is 0 and
 * the bug is invisible; it appears only on books long enough to shard,
 * which are exactly the ones where re-running OCR is most expensive.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { pagesFromShard, startBatchOcr } from './documentai'

// The token exchange is a signed JWT against real WebCrypto, which needs
// a real private key. That is `auth.test.ts`'s subject, not this file's —
// here it is a precondition, so it is stubbed.
vi.mock('./auth', () => ({
  googleAccessToken: async () => 'test-access-token',
}))

/** Build the layout wrapper Document AI puts around every segment. */
const paragraph = (startIndex: string, endIndex: string) => ({
  layout: { textAnchor: { textSegments: [{ startIndex, endIndex }] } },
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a single shard', () => {
  it('slices paragraphs out of the document text', () => {
    const pages = pagesFromShard({
      text: '學而第一子曰學而時習之',
      pages: [{ pageNumber: 1, paragraphs: [paragraph('0', '4'), paragraph('4', '11')] }],
    })

    expect(pages).toEqual([{ number: 1, paragraphs: ['學而第一', '子曰學而時習之'] }])
  })

  it('keeps the page number the engine reported', () => {
    const pages = pagesFromShard({
      text: 'later',
      pages: [{ pageNumber: 47, paragraphs: [paragraph('0', '5')] }],
    })
    expect(pages[0]!.number).toBe(47)
  })

  it('drops a page whose paragraphs sliced to nothing', () => {
    const pages = pagesFromShard({
      text: 'abc',
      pages: [{ pageNumber: 2, paragraphs: [paragraph('99', '120')] }],
    })
    expect(pages[0]!.paragraphs).toEqual([])
  })
})

describe('a sharded document', () => {
  it('rebases offsets onto the shard that carries the text', () => {
    // The second shard's text begins at document offset 11. Its
    // paragraph is document offsets 11..15 — which is 0..4 within this
    // shard's own string.
    const pages = pagesFromShard({
      text: '溫故而知新',
      shardInfo: { textOffset: '11' },
      pages: [{ pageNumber: 2, paragraphs: [paragraph('11', '16')] }],
    })

    expect(pages).toEqual([{ number: 2, paragraphs: ['溫故而知新'] }])
  })

  it('would slice the wrong text if the offset were ignored', () => {
    // Guards the specific regression: without rebasing, this slices from
    // index 11 of a 5-character string and yields nothing.
    const pages = pagesFromShard({
      text: '溫故而知新',
      shardInfo: { textOffset: '11' },
      pages: [{ pageNumber: 2, paragraphs: [paragraph('11', '16')] }],
    })
    expect(pages[0]!.paragraphs[0]).not.toBe('')
  })

  it('does not drift after a CJK Extension B character', () => {
    // 𠀀 is U+20000: one code point to Document AI, two UTF-16 units to
    // JavaScript. Indexing the raw string would shift every paragraph
    // after it by one — on exactly the historical texts this library is
    // for.
    const pages = pagesFromShard({
      text: '𠀀子曰學而時習之',
      pages: [{ pageNumber: 1, paragraphs: [paragraph('0', '1'), paragraph('1', '8')] }],
    })

    expect(pages[0]!.paragraphs).toEqual(['𠀀', '子曰學而時習之'])
  })

  it('handles a textOffset that arrived as a number', () => {
    const pages = pagesFromShard({
      text: 'second',
      shardInfo: { textOffset: 6 },
      pages: [{ pageNumber: 2, paragraphs: [paragraph('6', '12')] }],
    })
    expect(pages[0]!.paragraphs).toEqual(['second'])
  })
})

describe('submitting a batch job', () => {
  function acceptWith(capture: { url?: string; body?: unknown }) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capture.url = String(input)
        capture.body = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ name: 'projects/p/locations/l/operations/op' }), {
          status: 200,
        })
      }),
    )
  }

  const KEY = 'stubbed-by-the-auth-mock'

  it('calls the regional endpoint, not the global one', async () => {
    // A processor is reachable only through its own region's host;
    // the global host 404s about the processor rather than the host.
    const capture: { url?: string; body?: unknown } = {}
    acceptWith(capture)

    await startBatchOcr({
      encodedKey: KEY,
      processor: 'projects/p/locations/asia-southeast1/processors/abc',
      location: 'asia-southeast1',
      bucket: 'scratch',
      inputName: 'input/books/7/source.pdf',
      mimeType: 'application/pdf',
      outputPrefix: 'output/7/',
    })

    expect(capture.url).toContain('https://asia-southeast1-documentai.googleapis.com/v1/')
    expect(capture.url).toContain(':batchProcess')
  })

  it('points input and output at gs:// URIs in the scratch bucket', async () => {
    const capture: { url?: string; body?: unknown } = {}
    acceptWith(capture)

    await startBatchOcr({
      encodedKey: KEY,
      processor: 'projects/p/locations/asia-southeast1/processors/abc',
      location: 'asia-southeast1',
      bucket: 'scratch',
      inputName: 'input/books/7/source.pdf',
      mimeType: 'application/pdf',
      outputPrefix: 'output/7/',
    })

    const body = capture.body as {
      inputDocuments: { gcsDocuments: { documents: { gcsUri: string }[] } }
      documentOutputConfig: { gcsOutputConfig: { gcsUri: string } }
      skipHumanReview: boolean
    }
    expect(body.inputDocuments.gcsDocuments.documents[0]!.gcsUri).toBe(
      'gs://scratch/input/books/7/source.pdf',
    )
    expect(body.documentOutputConfig.gcsOutputConfig.gcsUri).toBe('gs://scratch/output/7/')
    // Google's review queue reviews extraction against a schema and has
    // nothing to say about a scanned book. Our review is an editor on
    // the DOCX master.
    expect(body.skipHumanReview).toBe(true)
  })

  it('reports what the API actually said rather than a generic failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('processor not found', { status: 404 })),
    )

    await expect(
      startBatchOcr({
        encodedKey: KEY,
        processor: 'projects/p/locations/asia-southeast1/processors/gone',
        location: 'asia-southeast1',
        bucket: 'scratch',
        inputName: 'input/x.pdf',
        mimeType: 'application/pdf',
        outputPrefix: 'output/x/',
      }),
    ).rejects.toThrow('processor not found')
  })
})
