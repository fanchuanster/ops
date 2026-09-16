import { unzipSync, strFromU8 } from 'fflate'

import { type Block, type BlockKind, type Document } from '../../domain/document'
import { type XmlNode, attr, childrenOf, findElement, parseXml, tagOf } from './xml'

const STYLE_TO_KIND: Record<string, BlockKind> = {
  'NobleSee Marker': 'marker',
  'NobleSee Verse': 'verse',
  'NobleSee Attribution': 'attribution',
  'NobleSee Footnote': 'footnote',
  'NobleSee Body': 'body',
}

const HEADING_KINDS: Record<string, BlockKind> = {
  Title: 'chapter',
  'Heading 1': 'chapter',
}

const REFERENCE_STYLE = 'NobleSee Reference'

function uiStyleName(internal: string): string {
  const heading = /^heading (\d)$/.exec(internal)
  return heading ? `Heading ${heading[1]}` : internal
}

function headingKind(style: string): BlockKind | null {
  const known = HEADING_KINDS[style]
  if (known) return known
  return style.startsWith('Heading ') ? 'section' : null
}

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

  for (const node of childrenOf(body, 'w:body')) {
    if (tagOf(node) !== 'w:p') continue

    const text = paragraphText(node).trim()
    if (!text) continue

    const styleId = paragraphStyle(node)
    const style = styleId ? (names.get(styleId) ?? uiStyleName(styleId)) : defaultParagraph

    if (style === 'Title' && text === doc.title) continue

    if (style === REFERENCE_STYLE) {
      const previous = doc.blocks[doc.blocks.length - 1]
      if (previous) previous.sourceRef = (previous.sourceRef ?? '') + text
      continue
    }

    const kind: BlockKind = STYLE_TO_KIND[style] ?? headingKind(style) ?? 'body'

    const last = doc.blocks[doc.blocks.length - 1]
    if (kind === 'verse' && last && last.kind === 'verse') {
      last.lines.push(text)
      continue
    }

    const block: Block = {
      kind,
      lines: [text],
      page: 0,
      confidence: 1,
      startsParagraph: kind === 'body',
    }
    doc.blocks.push(block)
  }

  return doc
}
