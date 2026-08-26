/**
 * Generate the editable DOCX master from a structured document.
 *
 * The DOCX is the source of truth for everything downstream (CLAUDE.md
 * section 5): the EPUB is generated from the *approved* master, never
 * from the scan. So this file's job is to produce something an editor
 * can actually work in — real named styles rather than direct
 * formatting, so that a proofreader changing how verse looks changes it
 * everywhere at once.
 *
 * Ported from `services/converter/app/docx/builder.py` on 2026-08-26.
 * python-docx is not available on a Worker and is not needed: what it
 * was doing here was writing a fixed set of styles and one paragraph per
 * block, which is a template and a zip.
 *
 * The style *names* are the contract with `docxRead.ts`. The styleIds
 * are Word's convention (the name with spaces removed) and matter only
 * inside the file.
 */

import { zipSync, strToU8 } from 'fflate'

import { type BlockKind, type Document, blockText } from '../../domain/document'
import { escapeXml, stripInvalidXmlChars } from './xml'

// Latin and CJK are bound separately in OOXML. Setting only the Latin
// face leaves Chinese to whatever the reader's Word falls back to, which
// is how a carefully typeset Chinese document ends up mismatched.
const LATIN_FONT = 'Times New Roman'
const CJK_FONT = '宋体'
const CJK_HEADING_FONT = '黑体'

/** Points → half-points, the unit `w:sz` is in. */
const halfPoints = (pt: number) => String(Math.round(pt * 2))
/** Points → twips, the unit paragraph spacing and indents are in. */
const twips = (pt: number) => String(Math.round(pt * 20))
/** A line-spacing multiple, where Word's single line is 240. */
const lineHeight = (multiple: number) => String(Math.round(multiple * 240))

const STYLE_FOR: Record<BlockKind, string> = {
  chapter: 'Heading 1',
  section: 'Heading 2',
  marker: 'NobleSee Marker',
  verse: 'NobleSee Verse',
  attribution: 'NobleSee Attribution',
  footnote: 'NobleSee Footnote',
  body: 'NobleSee Body',
}

const REFERENCE_STYLE = 'NobleSee Reference'

/** The name with spaces removed, which is what Word itself does. */
function styleId(name: string): string {
  return name.replace(/\s+/g, '')
}

interface StyleSpec {
  name: string
  /** Word stores built-in heading names lower-cased; `docxRead` undoes it. */
  internalName?: string
  size: number
  align: 'left' | 'center' | 'right' | 'both'
  before: number
  after: number
  bold?: boolean
  italic?: boolean
  cjk?: string
  lineSpacing?: number
  firstLineIndent?: number
  outlineLevel?: number
}

const STYLES: StyleSpec[] = [
  { name: 'Title', size: 20, align: 'center', before: 0, after: 12, bold: true, cjk: CJK_HEADING_FONT },
  {
    name: 'Heading 1',
    internalName: 'heading 1',
    size: 16,
    align: 'left',
    before: 12,
    after: 8,
    bold: true,
    cjk: CJK_HEADING_FONT,
    outlineLevel: 0,
  },
  {
    name: 'Heading 2',
    internalName: 'heading 2',
    size: 13,
    align: 'left',
    before: 10,
    after: 6,
    bold: true,
    cjk: CJK_HEADING_FONT,
    outlineLevel: 1,
  },
  {
    name: 'NobleSee Marker',
    size: 12,
    align: 'center',
    before: 18,
    after: 10,
    bold: true,
    cjk: CJK_HEADING_FONT,
  },
  // Verse lines carry no space between them: the gap belongs between
  // poems, not between a poem's own lines.
  { name: 'NobleSee Verse', size: 11, align: 'center', before: 0, after: 0, lineSpacing: 1.5 },
  { name: 'NobleSee Attribution', size: 10, align: 'right', before: 6, after: 0, italic: true },
  { name: REFERENCE_STYLE, size: 9, align: 'right', before: 2, after: 6 },
  { name: 'NobleSee Footnote', size: 9, align: 'left', before: 10, after: 0 },
  {
    name: 'NobleSee Body',
    size: 11,
    align: 'both',
    before: 0,
    after: 6,
    lineSpacing: 1.5,
    // Chinese prose indents the first line by two characters, which at
    // 11pt is 22pt.
    firstLineIndent: 22,
  },
]

function fontsXml(cjk: string): string {
  return (
    `<w:rFonts w:ascii="${escapeXml(LATIN_FONT)}" w:hAnsi="${escapeXml(LATIN_FONT)}"` +
    ` w:eastAsia="${escapeXml(cjk)}"/>`
  )
}

function styleXml(spec: StyleSpec): string {
  const id = styleId(spec.name)
  const name = spec.internalName ?? spec.name

  const spacing =
    `<w:spacing w:before="${twips(spec.before)}" w:after="${twips(spec.after)}"` +
    (spec.lineSpacing ? ` w:line="${lineHeight(spec.lineSpacing)}" w:lineRule="auto"` : '') +
    '/>'
  const indent = spec.firstLineIndent
    ? `<w:ind w:firstLine="${twips(spec.firstLineIndent)}"/>`
    : ''
  const outline =
    spec.outlineLevel === undefined ? '' : `<w:outlineLvl w:val="${spec.outlineLevel}"/>`

  return (
    `<w:style w:type="paragraph" w:styleId="${escapeXml(id)}">` +
    `<w:name w:val="${escapeXml(name)}"/>` +
    '<w:basedOn w:val="Normal"/>' +
    '<w:qFormat/>' +
    `<w:pPr>${spacing}${indent}<w:jc w:val="${spec.align}"/>${outline}</w:pPr>` +
    `<w:rPr>${fontsXml(spec.cjk ?? CJK_FONT)}` +
    (spec.bold ? '<w:b/>' : '') +
    (spec.italic ? '<w:i/>' : '') +
    `<w:sz w:val="${halfPoints(spec.size)}"/>` +
    `<w:szCs w:val="${halfPoints(spec.size)}"/>` +
    '</w:rPr></w:style>'
  )
}

function stylesXml(): string {
  const normal =
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
    '<w:name w:val="Normal"/><w:qFormat/>' +
    `<w:rPr>${fontsXml(CJK_FONT)}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
    '</w:style>'

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:docDefaults><w:rPrDefault><w:rPr>${fontsXml(CJK_FONT)}</w:rPr></w:rPrDefault></w:docDefaults>` +
    normal +
    STYLES.map(styleXml).join('') +
    '</w:styles>'
  )
}

function paragraphXml(text: string, style: string): string {
  const clean = escapeXml(stripInvalidXmlChars(text))
  return (
    `<w:p><w:pPr><w:pStyle w:val="${escapeXml(styleId(style))}"/></w:pPr>` +
    `<w:r><w:t xml:space="preserve">${clean}</w:t></w:r></w:p>`
  )
}

function pageBreakXml(): string {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
}

function coreXml(title: string, author: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties' +
    ' xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"' +
    ' xmlns:dcterms="http://purl.org/dc/terms/"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXml(stripInvalidXmlChars(title))}</dc:title>` +
    `<dc:creator>${escapeXml(stripInvalidXmlChars(author))}</dc:creator>` +
    '<dc:language>zh-CN</dc:language>' +
    '</cp:coreProperties>'
  )
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '</Types>'

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '</Relationships>'

const DOCUMENT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>'

export function buildDocx(doc: Document, author?: string | null): Uint8Array {
  const parts: string[] = [paragraphXml(doc.title, 'Title')]

  let pendingRef: string | null = null
  const flushRef = () => {
    if (pendingRef) {
      parts.push(paragraphXml(pendingRef, REFERENCE_STYLE))
      pendingRef = null
    }
  }

  for (const block of doc.blocks) {
    if (block.kind === 'chapter') {
      flushRef()
      parts.push(pageBreakXml())
      parts.push(paragraphXml(block.lines[0] ?? '', 'Heading 1'))
      continue
    }

    if (block.kind === 'section') {
      // No page break: a section head divides a chapter, it does not
      // start one. Word's built-in style, so the master keeps a real
      // outline — one an editor can navigate and restyle, and one the
      // EPUB's table of contents can be built from.
      flushRef()
      parts.push(paragraphXml(block.lines[0] ?? '', 'Heading 2'))
      continue
    }

    if (block.kind === 'attribution') {
      // The poem's reference is emitted after its attribution, as the
      // printed page sets it, even though it belongs to the poem
      // structurally.
      parts.push(paragraphXml(block.lines[0] ?? '', STYLE_FOR.attribution))
      if (block.sourceRef) pendingRef = (pendingRef ?? '') + block.sourceRef
      flushRef()
      continue
    }

    flushRef()
    const style = STYLE_FOR[block.kind]

    if (block.kind === 'body') {
      // Prose is one paragraph; the printed line breaks were the
      // measure, not the author's.
      parts.push(paragraphXml(block.lines.join(''), style))
    } else {
      for (const line of block.lines) parts.push(paragraphXml(line, style))
    }

    if (block.sourceRef) pendingRef = block.sourceRef
  }

  flushRef()

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${parts.join('')}</w:body></w:document>`

  // Always written, even when empty: a master that claims some library
  // wrote it is both wrong and something a round trip would read back.
  const byline = author ?? doc.author ?? ''

  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'docProps/core.xml': strToU8(coreXml(doc.title, byline)),
      'word/document.xml': strToU8(documentXml),
      'word/styles.xml': strToU8(stylesXml()),
      'word/_rels/document.xml.rels': strToU8(DOCUMENT_RELS),
    },
    { level: 6 },
  )
}
