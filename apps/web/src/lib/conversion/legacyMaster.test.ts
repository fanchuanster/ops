import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { readDocx } from './docxRead'

const LEGACY = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./fixtures/python-docx-master.docx', import.meta.url))),
)

describe('a master from the retired Python builder', () => {
  const doc = readDocx(LEGACY, 'fallback')

  it('still carries its metadata', () => {
    expect(doc.title).toBe('參禪日記')
    expect(doc.author).toBe('南懷瑾')
  })

  it('still resolves every block kind', () => {
    expect(doc.blocks.map((b) => b.kind)).toEqual([
      'chapter',
      'body',
      'section',
      'marker',
      'verse',
      'attribution',
      'footnote',
      'chapter',
      'body',
    ])
  })

  it("still keeps a poem's own line breaks", () => {
    expect(doc.blocks.find((b) => b.kind === 'verse')?.lines).toEqual([
      '空山不見人',
      '但聞人語響',
    ])
  })

  it('still re-attaches the source reference', () => {
    expect(doc.blocks.find((b) => b.kind === 'attribution')?.sourceRef).toBe('（見第 71 頁）')
  })

  it('does not mistake the page-break paragraphs for empty body blocks', () => {
    expect(doc.blocks.every((b) => b.lines.some((line) => line.trim()))).toBe(true)
  })
})
