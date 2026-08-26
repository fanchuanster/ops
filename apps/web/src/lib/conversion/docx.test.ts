/**
 * The DOCX round trip.
 *
 * "The DOCX master is the source of truth" (CLAUDE.md section 5) only
 * means something if the approved master can be read back into the same
 * book. A silent mismatch between the writer's style names and the
 * reader's map would flatten verse into prose, or read a section head as
 * a chapter — which is the corrected master coming back as a different
 * book from the one the editor approved.
 */

import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'

import { type Document, makeBlock } from '../../domain/document'
import { readDocx } from './docxRead'
import { buildDocx } from './docxWrite'

function roundTrip(doc: Document, author?: string): Document {
  return readDocx(buildDocx(doc, author), 'fallback')
}

const BOOK: Document = {
  title: '參禪日記',
  author: '南懷瑾',
  blocks: [
    makeBlock('chapter', ['第一章 初機']),
    makeBlock('body', ['修行沒有秘密可言。'], { startsParagraph: true }),
    makeBlock('section', ['一、打坐']),
    makeBlock('marker', ['（十一）']),
    makeBlock('verse', ['空山不見人', '但聞人語響']),
    makeBlock('attribution', ['——唐·王維《鹿柴》'], { sourceRef: '（見第 71 頁）' }),
    makeBlock('footnote', ['* 此處依宋本。']),
  ],
}

describe('a master read back', () => {
  it('keeps its title and author', () => {
    const out = roundTrip(BOOK)
    expect(out.title).toBe('參禪日記')
    expect(out.author).toBe('南懷瑾')
  })

  it('keeps every block kind', () => {
    expect(roundTrip(BOOK).blocks.map((b) => b.kind)).toEqual([
      'chapter',
      'body',
      'section',
      'marker',
      'verse',
      'attribution',
      'footnote',
    ])
  })

  it('keeps a section head a section rather than promoting it', () => {
    // A section read back as a chapter starts a new page and a new EPUB
    // document at every subheading.
    const out = roundTrip(BOOK)
    expect(out.blocks[2]).toMatchObject({ kind: 'section', lines: ['一、打坐'] })
  })

  it("keeps a poem's own line breaks", () => {
    const verse = roundTrip(BOOK).blocks.find((b) => b.kind === 'verse')
    expect(verse?.lines).toEqual(['空山不見人', '但聞人語響'])
  })

  it('re-attaches a source reference to the block it belongs to', () => {
    const attribution = roundTrip(BOOK).blocks.find((b) => b.kind === 'attribution')
    expect(attribution?.sourceRef).toBe('（見第 71 頁）')
  })

  it('does not re-emit the title as a body block', () => {
    expect(roundTrip(BOOK).blocks.some((b) => b.lines.includes('參禪日記'))).toBe(false)
  })

  it('joins prose into one paragraph, because the measure was not the author', () => {
    const doc: Document = {
      title: 'T',
      blocks: [makeBlock('body', ['前半句', '後半句'])],
    }
    expect(roundTrip(doc).blocks[0].lines).toEqual(['前半句後半句'])
  })

  it('names a real author rather than the library that wrote the file', () => {
    const xml = strFromU8(unzipSync(buildDocx(BOOK))['docProps/core.xml'])
    expect(xml).toContain('<dc:creator>南懷瑾</dc:creator>')
  })

  it('writes an empty creator rather than a fabricated one', () => {
    const xml = strFromU8(
      unzipSync(buildDocx({ title: 'T', blocks: [] }))['docProps/core.xml'],
    )
    expect(xml).toContain('<dc:creator></dc:creator>')
  })
})

describe('reading a DOCX from elsewhere', () => {
  it("understands Word's internal lower-case heading names", () => {
    // Adobe's export writes `<w:name w:val="heading 1"/>`. Without the
    // BabelFish mapping every Adobe heading reads as an unstyled
    // paragraph and the book arrives with no chapters at all.
    const out = roundTrip({ title: 'T', blocks: [makeBlock('chapter', ['卷一'])] })
    expect(out.blocks[0].kind).toBe('chapter')
  })

  it('refuses something that is not a Word document', () => {
    const notDocx = buildDocx({ title: 'T', blocks: [] }).slice(0, 40)
    expect(() => readDocx(notDocx, 'x')).toThrow()
  })

  it('drops a character XML cannot carry rather than writing an unopenable file', () => {
    // A control character is always damage from a bad decode upstream,
    // and Word refuses to open a file that contains one.
    const damaged = `前${String.fromCharCode(1)}後`
    const doc: Document = { title: 'T', blocks: [makeBlock('body', [damaged])] }
    expect(roundTrip(doc).blocks[0].lines).toEqual(['前後'])
  })
})
