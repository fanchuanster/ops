/**
 * Plain text → Document.
 *
 * The least structured input there is, and so the one where it is most
 * tempting to guess. This deliberately infers very little: blank lines
 * separate paragraphs, a Markdown-style `#` prefix or a lone poem marker
 * is a heading, and everything else is prose.
 *
 * It does *not* try to detect verse by line length, which is the guess a
 * text importer usually reaches for. On Chinese material that misfires
 * constantly — classical prose is set in short lines too — and the cost
 * of being wrong is a paragraph shattered into fake poetry in a
 * published book. Verse in a plain text file is better recovered by an
 * editor in the DOCX master, where the mistake is visible and cheap to
 * fix.
 *
 * Ported from `services/converter/app/sources/text.py` on 2026-08-26.
 */

import { type Block, type Document, makeBlock } from './document'

/**
 * （十一） — a poem's number within a chapter.
 *
 * Unambiguous enough to recognise from text alone, which is why it
 * survives a handoff where headings and verse do not.
 */
export const MARKER_RE = /^[(（]\s*[一二三四五六七八九十百零〇]+\s*[)）]$/

/**
 * `# Chapter`, `## Chapter` — the one heading convention common enough
 * in plain text files to be worth honouring.
 */
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

    // A blank-line-separated run is one paragraph. Its internal line
    // breaks are the text file's wrapping, not the author's.
    blocks.push(makeBlock('body', lines, { startsParagraph: true }))
  }

  return { title, blocks }
}
