/**
 * The small amount of XML handling the DOCX and EPUB paths need.
 *
 * Reading goes through `fast-xml-parser` in `preserveOrder` mode, which
 * keeps sibling order and attributes intact — both load-bearing, since a
 * paragraph's runs must be concatenated in the order they were written
 * and a style is identified by an attribute.
 *
 * Writing does not use a serializer at all. Everything this generates is
 * a fixed OOXML or XHTML skeleton with text interpolated into it, so a
 * correct escape and a template string is the whole job; a document
 * model would be more machinery for the same bytes.
 */

import { XMLParser } from 'fast-xml-parser'

/** One element in `fast-xml-parser`'s preserveOrder output. */
export type XmlNode = Record<string, unknown> & { ':@'?: Record<string, string> }

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Word writes `<w:t xml:space="preserve"> </w:t>` for significant
  // spaces. Trimming would silently join words across runs.
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
})

export function parseXml(source: string): XmlNode[] {
  return parser.parse(source) as XmlNode[]
}

/** The tag name of a preserveOrder node, ignoring its attribute bag. */
export function tagOf(node: XmlNode): string | null {
  for (const key of Object.keys(node)) {
    if (key !== ':@') return key
  }
  return null
}

export function childrenOf(node: XmlNode, tag: string): XmlNode[] {
  const value = node[tag]
  return Array.isArray(value) ? (value as XmlNode[]) : []
}

export function attr(node: XmlNode, name: string): string | null {
  const value = node[':@']?.[`@_${name}`]
  return value === undefined ? null : String(value)
}

/** Depth-first search for the first element with this tag name. */
export function findElement(nodes: XmlNode[], tag: string): XmlNode | null {
  for (const node of nodes) {
    const name = tagOf(node)
    if (name === tag) return node
    if (name) {
      const found = findElement(childrenOf(node, name), tag)
      if (found) return found
    }
  }
  return null
}

/** All the `#text` under a node, concatenated in document order. */
export function textOf(nodes: XmlNode[]): string {
  let out = ''
  for (const node of nodes) {
    if ('#text' in node) {
      out += String(node['#text'])
      continue
    }
    const name = tagOf(node)
    if (name) out += textOf(childrenOf(node, name))
  }
  return out
}

/** XML text escaping. Attribute values need the quotes too. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Strip what XML 1.0 cannot carry at all.
 *
 * A control character in a book's text is always damage — a stray byte
 * from a bad decode upstream — and Word refuses to open a file
 * containing one, so dropping it here turns a corrupt master into a
 * slightly lossy one rather than an unopenable one. Tab, newline and
 * carriage return are deliberately kept: the builder writes them.
 */
const INVALID_XML = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]',
  'g',
)

export function stripInvalidXmlChars(value: string): string {
  return value.replace(INVALID_XML, '')
}
