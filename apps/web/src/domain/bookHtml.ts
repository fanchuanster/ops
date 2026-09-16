import { type Block, type Document, blockText } from './document'

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

export const BOOK_CSS = `
body { line-height: 1.75; }
h1 { font-size: 1.6em; text-align: center; margin: 0 0 .2em; }
h2 { font-size: 1.25em; margin: 1.6em 0 .6em; }
h3 { font-size: 1.08em; margin: 1.8em 0 .5em; }
.byline { text-align: center; font-style: italic; color: #555;
          margin: 0 0 2em; }
.marker { font-weight: 600; color: #444; margin: 1.4em 0 .4em; }
.verse { white-space: pre-wrap; margin: 1em 0 1em 1.5em; }
.attribution { text-align: right; font-style: italic; color: #555;
               margin: .2em 0 1.4em; }
.footnote { font-size: .85em; color: #666; border-top: 1px solid #ddd;
            padding-top: .4em; margin-top: 1.4em; }
.source-ref { font-size: .85em; color: #888; }
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
      const ident = anchor ? ` id="${anchor}"` : ''
      return `<h3${ident}${uncertain}>${body}</h3>`
    }
    case 'marker':
      return `<p class="marker"${uncertain}>${body}</p>`
    case 'verse':
      return `<div class="verse"${uncertain}>${body}</div>`
    case 'attribution':
      return `<p class="attribution"${uncertain}>${body}</p>`
    case 'footnote':
      return `<p class="footnote"${uncertain}>${body}${ref}</p>`
    default:
      return `<p${uncertain}>${escapeHtml(block.lines.join(' '))}${ref}</p>`
  }
}

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

export function sections(blocks: Block[]): Array<{ anchor: string; title: string }> {
  return blocks
    .filter((block) => block.kind === 'section')
    .map((block, index) => ({ anchor: anchorFor(index + 1), title: blockText(block) }))
}

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

export function chapterHtml(title: string, blocks: Block[], opening = ''): string {
  const rendered = render(blocks)
  const heading =
    blocks.length > 0 && blocks[0].kind === 'chapter' ? '' : `<h2>${escapeHtml(title)}</h2>`
  return `<article>${opening}${heading}${rendered}</article>`
}
