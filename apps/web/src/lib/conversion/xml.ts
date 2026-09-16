import { XMLParser } from 'fast-xml-parser'

export type XmlNode = Record<string, unknown> & { ':@'?: Record<string, string> }

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
})

export function parseXml(source: string): XmlNode[] {
  return parser.parse(source) as XmlNode[]
}

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

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const INVALID_XML = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]',
  'g',
)

export function stripInvalidXmlChars(value: string): string {
  return value.replace(INVALID_XML, '')
}
