/**
 * One HTML rendering of a Document.
 *
 * Ported from `services/converter/app/render/html.py` on 2026-08-26.
 * That module was deliberately shared between EPUB and PDF so the two
 * could not drift — "a footnote that renders in one and vanishes in the
 * other is the classic failure". Nothing renders a PDF any more
 * (CLAUDE.md section 11), so this has one consumer, and `document_html`
 * — the whole-book fragment the PDF path used — did not come across.
 *
 * It stays its own module regardless: an EPUB's chapter split and a
 * document's HTML are two different questions.
 */

import { type Block, type Document, blockText } from './document'

/** Escapes the five characters `html.escape(quote=True)` does. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/** Typography that matters for Chinese text, in the one place. */
export const BOOK_CSS = `
body { line-height: 1.75; }
h1 { font-size: 1.6em; text-align: center; margin: 0 0 .2em; }
h2 { font-size: 1.25em; margin: 1.6em 0 .6em; }
/* A section head divides a chapter. Close enough to the body size that
   it reads as a division rather than as a second chapter, and set with
   more space above than below so it binds to the text it introduces. */
h3 { font-size: 1.08em; margin: 1.8em 0 .5em; }
.byline { text-align: center; font-style: italic; color: #555;
          margin: 0 0 2em; }
.marker { font-weight: 600; color: #444; margin: 1.4em 0 .4em; }
/* Verse line breaks are the poem. Never reflow them. */
.verse { white-space: pre-wrap; margin: 1em 0 1em 1.5em; }
.attribution { text-align: right; font-style: italic; color: #555;
               margin: .2em 0 1.4em; }
.footnote { font-size: .85em; color: #666; border-top: 1px solid #ddd;
            padding-top: .4em; margin-top: 1.4em; }
.source-ref { font-size: .85em; color: #888; }
/* Marks a page the OCR pass was unsure of, so a proofreader can find
   it. Invisible in the reader; present in the markup. */
.uncertain { background: rgba(255, 220, 120, .25); }
`

function anchorFor(index: number): string {
  return `sec-${index}`
}

function blockHtml(block: Block, anchor?: string): string {
  const body = escapeHtml(blockText(block))
  const uncertain = block.confidence < 0.75 ? ' class="uncertain"' : ''
  const ref = block.sourceRef
    ? `<span class="source-ref">${escapeHtml(block.sourceRef)}</span>`
    : ''

  switch (block.kind) {
    case 'chapter':
      return `<h2${uncertain}>${body}</h2>`
    case 'section': {
      // The id is what the EPUB's table of contents links to. A chapter
      // is its own document and needs no anchor; a section is a place
      // inside one, and without an id the reader can only be dropped at
      // the top of the chapter and left to scroll.
      const ident = anchor ? ` id="${anchor}"` : ''
      return `<h3${ident}${uncertain}>${body}</h3>`
    }
    case 'marker':
      return `<p class="marker"${uncertain}>${body}</p>`
    case 'verse':
      // pre-wrap preserves the newlines already in the text.
      return `<div class="verse"${uncertain}>${body}</div>`
    case 'attribution':
      return `<p class="attribution"${uncertain}>${body}</p>`
    case 'footnote':
      return `<p class="footnote"${uncertain}>${body}${ref}</p>`
    default:
      // body: the printed line breaks were an artifact of the measure,
      // so they are joined into a paragraph and left to reflow.
      return `<p${uncertain}>${escapeHtml(block.lines.join(' '))}${ref}</p>`
  }
}

/**
 * Split the document at chapter blocks.
 *
 * A book with no chapter headings is one chapter, which is correct and
 * not a special case worth branching on elsewhere: the EPUB builder just
 * gets a single-entry list.
 */
export function chapters(document: Document): Array<{ title: string; blocks: Block[] }> {
  const grouped: Array<{ title: string; blocks: Block[] }> = []
  for (const block of document.blocks) {
    if (block.kind === 'chapter' || grouped.length === 0) {
      grouped.push({
        title: block.kind === 'chapter' ? blockText(block) : document.title,
        blocks: [],
      })
    }
    grouped[grouped.length - 1].blocks.push(block)
  }
  return grouped
}

/**
 * The section heads inside one chapter, as (anchor, title).
 *
 * Numbered exactly as `render` numbers them, and deliberately the only
 * other place that knows the numbering rule — the EPUB nav links to
 * these ids, and an anchor here that no heading carries is a table of
 * contents entry that goes nowhere.
 */
export function sections(blocks: Block[]): Array<{ anchor: string; title: string }> {
  return blocks
    .filter((block) => block.kind === 'section')
    .map((block, index) => ({ anchor: anchorFor(index + 1), title: blockText(block) }))
}

/** Blocks to HTML, anchoring section heads as it goes. */
function render(blocks: Block[]): string {
  let seen = 0
  return blocks
    .map((block) => {
      if (block.kind !== 'section') return blockHtml(block)
      seen += 1
      return blockHtml(block, anchorFor(seen))
    })
    .join('')
}

/** One chapter as an HTML body fragment. */
export function chapterHtml(title: string, blocks: Block[], opening = ''): string {
  const rendered = render(blocks)
  // A chapter block renders its own <h2>, so adding the title again
  // would print it twice.
  const heading =
    blocks.length > 0 && blocks[0].kind === 'chapter' ? '' : `<h2>${escapeHtml(title)}</h2>`
  return `<article>${opening}${heading}${rendered}</article>`
}
