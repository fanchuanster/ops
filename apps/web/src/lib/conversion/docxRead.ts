/**
 * DOCX → Document.
 *
 * Two jobs, and the second is the one that matters most.
 *
 * The obvious one is reading a DOCX a reader uploaded, so it can become
 * a NobleSee master like any other input.
 *
 * The load-bearing one is reading back a master this pipeline wrote. The
 * DOCX master is the source of truth, and reader-facing formats must be
 * generated from the *approved* master rather than from the scan
 * (CLAUDE.md section 5). That only means anything if the approved file
 * can be read back — which is why the builder writes real named styles
 * instead of direct formatting. Those style names are the structure, and
 * this maps them back.
 *
 * Ported from `services/converter/app/sources/docx_in.py` on 2026-08-26,
 * along with the part of python-docx it was relying on.
 *
 * **Only body-level paragraphs are read**, which is not an omission. It
 * is how Adobe's running heads and folios stay out of the book: Adobe
 * puts them in Word's header and footer parts, and this never opens
 * those. Paragraphs inside tables are skipped for the same reason
 * `docx.paragraphs` skipped them.
 */

import { unzipSync, strFromU8 } from 'fflate'

import { type Block, type BlockKind, type Document } from '../../domain/document'
import { type XmlNode, attr, childrenOf, findElement, parseXml, tagOf } from './xml'

/**
 * The inverse of `docxWrite.ts`'s style map. A silent mismatch here
 * would quietly flatten a book's verse into prose, which is what the
 * round-trip test exists to catch.
 */
const STYLE_TO_KIND: Record<string, BlockKind> = {
  'NobleSee Marker': 'marker',
  'NobleSee Verse': 'verse',
  'NobleSee Attribution': 'attribution',
  'NobleSee Footnote': 'footnote',
  'NobleSee Body': 'body',
}

/**
 * Headings are Word's own built-in styles rather than NobleSee ones, so
 * that the master carries a real outline — one an editor can navigate in
 * the sidebar, and one a DOCX from anywhere else already speaks.
 *
 * The *level* has to survive. A section head read back as a chapter
 * would start a new page and a new EPUB document at every subheading,
 * and the reader would get a table of contents claiming forty chapters
 * where the book has six.
 */
const HEADING_KINDS: Record<string, BlockKind> = {
  Title: 'chapter',
  'Heading 1': 'chapter',
}

const REFERENCE_STYLE = 'NobleSee Reference'

/**
 * python-docx's `BabelFish`: Word stores built-in heading styles under
 * lower-case internal names and shows them capitalised. Adobe's export
 * writes the internal form, so without this every Adobe heading reads as
 * an unstyled paragraph and the book arrives with no chapters at all.
 */
function uiStyleName(internal: string): string {
  const heading = /^heading (\d)$/.exec(internal)
  return heading ? `Heading ${heading[1]}` : internal
}

/**
 * chapter, section, or null if this style is not a heading at all.
 *
 * Anything below Heading 1 is a section rather than a deeper kind of its
 * own. The pipeline has two heading levels because that is what the
 * sources can honestly distinguish, and inventing a third here would be
 * a level nothing upstream can fill.
 */
function headingKind(style: string): BlockKind | null {
  const known = HEADING_KINDS[style]
  if (known) return known
  return style.startsWith('Heading ') ? 'section' : null
}

/** styleId → display name, plus the default paragraph style's name. */
function readStyles(xml: string | null): {
  names: Map<string, string>
  defaultParagraph: string
} {
  const names = new Map<string, string>()
  let defaultParagraph = 'Normal'
  if (!xml) return { names, defaultParagraph }

  const root = findElement(parseXml(xml), 'w:styles')
  if (!root) return { names, defaultParagraph }

  for (const node of childrenOf(root, 'w:styles')) {
    if (tagOf(node) !== 'w:style') continue
    const id = attr(node, 'w:styleId')
    if (!id) continue
    const nameNode = childrenOf(node, 'w:style').find((child) => tagOf(child) === 'w:name')
    const name = uiStyleName(nameNode ? (attr(nameNode, 'w:val') ?? id) : id)
    names.set(id, name)
    if (attr(node, 'w:type') === 'paragraph' && attr(node, 'w:default') === '1') {
      defaultParagraph = name
    }
  }

  return { names, defaultParagraph }
}

/**
 * One paragraph's text, the way python-docx assembled it.
 *
 * A tab and a line break carry through as themselves; everything else a
 * run can hold — a drawing, a field, a comment marker — contributes no
 * text and is skipped. Runs inside a hyperlink *are* read, which
 * python-docx did not do: their text is the book's words, and dropping
 * it loses content rather than formatting.
 */
function paragraphText(paragraph: XmlNode): string {
  let out = ''

  const walk = (nodes: XmlNode[]) => {
    for (const node of nodes) {
      const name = tagOf(node)
      if (!name) continue
      if (name === 'w:t') {
        for (const child of childrenOf(node, 'w:t')) {
          if ('#text' in child) out += String(child['#text'])
        }
      } else if (name === 'w:tab') {
        out += '\t'
      } else if (name === 'w:br' || name === 'w:cr') {
        out += '\n'
      } else if (name === 'w:r' || name === 'w:hyperlink' || name === 'w:smartTag') {
        walk(childrenOf(node, name))
      }
    }
  }

  walk(childrenOf(paragraph, 'w:p'))
  return out
}

function paragraphStyle(paragraph: XmlNode): string | null {
  const pPr = childrenOf(paragraph, 'w:p').find((child) => tagOf(child) === 'w:pPr')
  if (!pPr) return null
  const pStyle = childrenOf(pPr, 'w:pPr').find((child) => tagOf(child) === 'w:pStyle')
  return pStyle ? attr(pStyle, 'w:val') : null
}

function coreProperty(xml: string | null, tag: string): string | null {
  if (!xml) return null
  const node = findElement(parseXml(xml), tag)
  if (!node) return null
  const text = childrenOf(node, tag)
    .map((child) => ('#text' in child ? String(child['#text']) : ''))
    .join('')
  return text.trim() || null
}

export function readDocx(bytes: Uint8Array, fallbackTitle: string): Document {
  const files = unzipSync(bytes)

  const documentXml = files['word/document.xml']
  if (!documentXml) {
    throw new Error('not a Word document — word/document.xml is missing')
  }

  const { names, defaultParagraph } = readStyles(
    files['word/styles.xml'] ? strFromU8(files['word/styles.xml']) : null,
  )
  const core = files['docProps/core.xml'] ? strFromU8(files['docProps/core.xml']) : null

  const title = coreProperty(core, 'dc:title') || fallbackTitle
  const doc: Document = {
    title,
    author: coreProperty(core, 'dc:creator'),
    blocks: [],
  }

  const body = findElement(parseXml(strFromU8(documentXml)), 'w:body')
  if (!body) return doc

  // Direct children only: a paragraph inside `w:tbl` is a table cell's,
  // and a table is not the book's prose.
  for (const node of childrenOf(body, 'w:body')) {
    if (tagOf(node) !== 'w:p') continue

    const text = paragraphText(node).trim()
    if (!text) continue

    const styleId = paragraphStyle(node)
    const style = styleId ? (names.get(styleId) ?? uiStyleName(styleId)) : defaultParagraph

    // The document title is metadata, not a block: re-emitting it would
    // put the title in the body on every round trip.
    if (style === 'Title' && text === doc.title) continue

    // A reference belongs to the block above it — that is how the
    // builder emitted it, and re-attaching it here is what makes the
    // round trip lossless.
    if (style === REFERENCE_STYLE) {
      const previous = doc.blocks[doc.blocks.length - 1]
      if (previous) previous.sourceRef = (previous.sourceRef ?? '') + text
      continue
    }

    const kind: BlockKind = STYLE_TO_KIND[style] ?? headingKind(style) ?? 'body'

    // Consecutive verse paragraphs are one poem. Everything else stands
    // alone: two adjacent body paragraphs are two paragraphs, and
    // merging them would destroy the author's own break.
    const last = doc.blocks[doc.blocks.length - 1]
    if (kind === 'verse' && last && last.kind === 'verse') {
      last.lines.push(text)
      continue
    }

    const block: Block = {
      kind,
      lines: [text],
      // A DOCX has no pages until it is laid out, so there is no page
      // number to record. 0 rather than a fabricated one.
      page: 0,
      // Text read from a document is exact. Confidence is an OCR concept
      // and does not apply.
      confidence: 1,
      startsParagraph: kind === 'body',
    }
    doc.blocks.push(block)
  }

  return doc
}
