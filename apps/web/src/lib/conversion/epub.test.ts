/**
 * The generated EPUB.
 *
 * Ported from `services/converter/tests/` on 2026-08-26, when ebooklib
 * was replaced by a template and a zip. Two of these assertions are
 * about bytes rather than content, and they are the ones worth keeping:
 * `mimetype` first and stored is what a strict reader — Kindle's
 * converter among them — checks before it will open the file at all, and
 * it is exactly the sort of thing a hand-written packer gets wrong.
 */

import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'

import { type Document, makeBlock } from '../../domain/document'
import { buildEpub } from './epubWrite'

const BOOK: Document = {
  title: '參禪日記',
  author: '南懷瑾',
  blocks: [
    makeBlock('chapter', ['第一章 初機']),
    makeBlock('body', ['修行沒有秘密可言。']),
    makeBlock('section', ['一、打坐']),
    makeBlock('verse', ['空山不見人', '但聞人語響']),
    makeBlock('chapter', ['第二章 進階']),
    makeBlock('body', ['第二章的正文。']),
  ],
}

const built = buildEpub(BOOK, { identifier: 'noblesee-test', modified: '2026-08-26T00:00:00Z' })
const files = unzipSync(built)
const read = (name: string) => strFromU8(files[name])

describe('the archive', () => {
  it('puts mimetype first, which the spec requires', () => {
    expect(Object.keys(files)[0]).toBe('mimetype')
  })

  it('stores mimetype uncompressed', () => {
    // A deflated mimetype is why a reader rejects an otherwise valid
    // book. `zipSync` was given `level: 0` for this one entry; if that
    // is ever dropped the bytes still unzip and the file still fails on
    // a device, which is the failure this test exists to catch early.
    const header = built.subarray(0, 30)
    const method = header[8] | (header[9] << 8)
    expect(method).toBe(0)
  })

  it('declares the right mimetype', () => {
    expect(read('mimetype')).toBe('application/epub+zip')
  })
})

describe('the package document', () => {
  it('carries the book metadata', () => {
    const opf = read('EPUB/content.opf')
    expect(opf).toContain('<dc:title>參禪日記</dc:title>')
    expect(opf).toContain('<dc:creator id="creator">南懷瑾</dc:creator>')
  })

  it('declares traditional Chinese', () => {
    // Getting this wrong makes a reader pick Japanese glyph forms for
    // shared characters, which looks subtly wrong on every page.
    expect(read('EPUB/content.opf')).toContain('<dc:language>zh-Hant</dc:language>')
  })

  it('opens on the text rather than the table of contents', () => {
    // Landing a reader on a contents page is a small insult repeated
    // every time they open the book.
    const spine = /<spine[^>]*>(.*?)<\/spine>/s.exec(read('EPUB/content.opf'))?.[1] ?? ''
    expect(spine).toBe('<itemref idref="ch1"/><itemref idref="ch2"/>')
  })

  it('still lists the nav document in the manifest, as EPUB 3 requires', () => {
    expect(read('EPUB/content.opf')).toContain('properties="nav"')
  })
})

describe('navigation', () => {
  it('gives one document per chapter', () => {
    expect(Object.keys(files).filter((f) => /chapter-\d+\.xhtml$/.test(f))).toHaveLength(2)
  })

  it('nests section heads under their chapter', () => {
    // So a reader navigating a four-hundred page classic lands on the
    // passage rather than at the top of the chapter containing it.
    expect(read('EPUB/nav.xhtml')).toContain(
      '<ol><li><a href="chapter-1.xhtml#sec-1">一、打坐</a></li></ol>',
    )
  })

  it('anchors the section the nav links to', () => {
    expect(read('EPUB/chapter-1.xhtml')).toContain('id="sec-1"')
  })

  it('writes an ncx as well, for readers that predate EPUB 3', () => {
    expect(read('EPUB/toc.ncx')).toContain('<text>第一章 初機</text>')
  })
})

describe('typography', () => {
  it("never reflows a poem's line breaks", () => {
    expect(read('EPUB/chapter-1.xhtml')).toContain(
      '<div class="verse">空山不見人\n但聞人語響</div>',
    )
  })

  it('sets no font size or page measure, because the device decides', () => {
    const css = read('EPUB/style/noblesee.css')
    expect(css).not.toMatch(/@page|font-size:\s*\d+(pt|px)/)
  })
})
