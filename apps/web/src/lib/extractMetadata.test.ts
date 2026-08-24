import { describe, expect, it } from 'vitest'

import { type ByteSource, extractMetadata } from './extractMetadata'

/**
 * Which source wins when a file and its name disagree about the title.
 *
 * Worth its own suite because the answer is counter-intuitive and was
 * the other way round until 2026-08-24. `domain/metadata.test.ts`
 * covers the parsers; this covers the *choice between* them, which is
 * the part that actually decides what an uploader sees.
 *
 * Testable at all only because extraction reads through a `ByteSource`
 * — there is no `File` in a Worker test, and no R2 either.
 */
function bytes(name: string, type: string, body: Uint8Array): ByteSource {
  return {
    name,
    type,
    size: body.length,
    async read(start, end) {
      return body.subarray(start, Math.min(end, body.length))
    },
  }
}

/** A PDF small enough that extraction reads all of it, with an Info title. */
function pdf(title: string, pages = 3): Uint8Array {
  // UTF-16BE with a BOM, in the `<hex>` form — how a Chinese scan
  // routinely carries its title.
  const utf16 = [0xfe, 0xff]
  for (const char of title) {
    const code = char.charCodeAt(0)
    utf16.push(code >> 8, code & 0xff)
  }
  const info = `<< /Title <${utf16.map((b) => b.toString(16).padStart(2, '0')).join('')}> >>`
  const doc =
    `%PDF-1.4\n` +
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Count ${pages} >>\nendobj\n` +
    `3 0 obj\n${info}\nendobj\n` +
    `trailer\n<< /Root 1 0 R /Info 3 0 R >>\n%%EOF\n`
  return new TextEncoder().encode(doc)
}

describe('the title, when the file and its name disagree', () => {
  it('takes the filename, not the title baked into the scan', async () => {
    // The real regression, from a real upload. The embedded title is a
    // download site's slogan — well-formed Chinese, so no junk filter
    // could ever recognise it — while the filename is the actual book.
    const found = await extractMetadata(
      bytes(
        '南怀瑾选集_第七卷（如何修证佛法，药师经的济世.pdf',
        'application/pdf',
        pdf('北斗成功社区 来者有缘 共铸成功'),
      ),
    )

    expect(found.title).toBe('南怀瑾选集 第七卷（如何修证佛法，药师经的济世')
  })

  it('drops the extension and nothing else of substance', async () => {
    const found = await extractMetadata(
      bytes('道德經.pdf', 'application/pdf', pdf('Scanned by SomeSite')),
    )
    expect(found.title).toBe('道德經')
  })

  it('still reads the length from inside the file', async () => {
    // Only the *title* comes from the name. Everything the filename
    // cannot know must still come out of the file itself.
    const found = await extractMetadata(
      bytes('南怀瑾选集.pdf', 'application/pdf', pdf('an advertisement', 412)),
    )
    expect(found.title).toBe('南怀瑾选集')
    expect(found.pageCount).toBe(412)
  })

  it('falls back to the embedded title when the filename says nothing', async () => {
    // `scan001.pdf` is on the JUNK list, so the filename yields no
    // title at all and the file's own is the best left.
    const found = await extractMetadata(
      bytes('scan001.pdf', 'application/pdf', pdf('論語別裁')),
    )
    expect(found.title).toBe('論語別裁')
  })

  it('leaves the title unset when neither source has one', async () => {
    const found = await extractMetadata(bytes('scan001.pdf', 'application/pdf', pdf('untitled')))
    expect(found.title).toBeUndefined()
  })
})
