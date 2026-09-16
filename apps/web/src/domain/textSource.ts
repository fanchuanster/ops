import { type Block, type Document, makeBlock } from './document'

export const MARKER_RE = /^[(（]\s*[一二三四五六七八九十百零〇]+\s*[)）]$/

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/

export function readText(content: string, title: string): Document {
  const blocks: Block[] = []

  for (const chunk of content.split(/\n\s*\n/)) {
    const lines = chunk
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (lines.length === 0) continue

    const heading = ATX_HEADING.exec(lines[0])
    if (heading && lines.length === 1) {
      blocks.push(makeBlock('chapter', [heading[2]]))
      continue
    }

    if (lines.length === 1 && MARKER_RE.test(lines[0])) {
      blocks.push(makeBlock('marker', lines))
      continue
    }

    blocks.push(makeBlock('body', lines, { startsParagraph: true }))
  }

  return { title, blocks }
}
