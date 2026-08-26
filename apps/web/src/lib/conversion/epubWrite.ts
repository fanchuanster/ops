/**
 * EPUB 3 from a reconstructed Document.
 *
 * EPUB is the primary format (CLAUDE.md section 10) because it is the
 * one that reflows: the *device* picks the font size, the margins and
 * the line spacing, and a book that fights that is a PDF wearing a
 * different extension. So this builder deliberately sets no page size,
 * no font size and no measure — only the structural typography that
 * would be wrong to lose, like verse line breaks.
 *
 * One XHTML document per chapter rather than one per book. It gives the
 * reader a real table of contents to navigate by, and it keeps any
 * single document small enough that a cheap e-reader can paginate it
 * without stalling.
 *
 * Ported from `services/converter/app/epub/builder.py` on 2026-08-26.
 * ebooklib does not run on a Worker; an EPUB is a zip of XHTML with two
 * navigation documents, which is a template rather than a library.
 */

import { zipSync, strToU8 } from 'fflate'

import { BOOK_CSS, chapterHtml, chapters, escapeHtml, sections } from '../../domain/bookHtml'
import { type Document } from '../../domain/document'
import { stripInvalidXmlChars } from './xml'

const CONTAINER_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
  '<rootfiles><rootfile full-path="EPUB/content.opf"' +
  ' media-type="application/oebps-package+xml"/></rootfiles></container>'

/**
 * Traditional Chinese unless we are told otherwise. Getting this wrong
 * makes a reader pick Japanese glyph forms for shared characters, which
 * looks subtly wrong on every page.
 */
const LANGUAGE = 'zh-Hant'

function xhtml(title: string, body: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<!DOCTYPE html>' +
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${LANGUAGE}" lang="${LANGUAGE}">` +
    `<head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>` +
    '<link rel="stylesheet" type="text/css" href="style/noblesee.css"/></head>' +
    `<body>${body}</body></html>`
  )
}

interface TocEntry {
  href: string
  title: string
  children: Array<{ href: string; title: string }>
}

function navXhtml(entries: TocEntry[]): string {
  const items = entries
    .map((entry) => {
      const children = entry.children.length
        ? '<ol>' +
          entry.children
            .map(
              (child) =>
                `<li><a href="${escapeHtml(child.href)}">${escapeHtml(child.title)}</a></li>`,
            )
            .join('') +
          '</ol>'
        : ''
      return `<li><a href="${escapeHtml(entry.href)}">${escapeHtml(entry.title)}</a>${children}</li>`
    })
    .join('')

  return xhtml(
    'Contents',
    `<nav epub:type="toc" id="toc"><h1>目录</h1><ol>${items}</ol></nav>`,
  )
}

function ncx(identifier: string, title: string, entries: TocEntry[]): string {
  let order = 0
  const points = entries
    .map((entry, index) => {
      order += 1
      const children = entry.children
        .map((child, childIndex) => {
          order += 1
          return (
            `<navPoint id="np-${index + 1}-${childIndex + 1}" playOrder="${order}">` +
            `<navLabel><text>${escapeHtml(child.title)}</text></navLabel>` +
            `<content src="${escapeHtml(child.href)}"/></navPoint>`
          )
        })
        .join('')
      return (
        `<navPoint id="np-${index + 1}" playOrder="${order}">` +
        `<navLabel><text>${escapeHtml(entry.title)}</text></navLabel>` +
        `<content src="${escapeHtml(entry.href)}"/>${children}</navPoint>`
      )
    })
    .join('')

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
    `<head><meta name="dtb:uid" content="${escapeHtml(identifier)}"/></head>` +
    `<docTitle><text>${escapeHtml(title)}</text></docTitle>` +
    `<navMap>${points}</navMap></ncx>`
  )
}

function contentOpf(
  identifier: string,
  document: Document,
  chapterFiles: string[],
  modified: string,
): string {
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="style" href="style/noblesee.css" media-type="text/css"/>',
    ...chapterFiles.map(
      (file, index) =>
        `<item id="ch${index + 1}" href="${escapeHtml(file)}" media-type="application/xhtml+xml"/>`,
    ),
  ].join('')

  // The text is the first page, not the table of contents. The nav
  // document stays in the manifest — EPUB 3 requires it, and it is what
  // feeds the reader's chapter list — it just is not where the book
  // opens. Landing a reader on a contents page is a small insult
  // repeated every time they open the book.
  const spine = chapterFiles.map((_, index) => `<itemref idref="ch${index + 1}"/>`).join('')

  const creator = document.author
    ? `<dc:creator id="creator">${escapeHtml(stripInvalidXmlChars(document.author))}</dc:creator>`
    : ''

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:identifier id="pub-id">${escapeHtml(identifier)}</dc:identifier>` +
    `<dc:title>${escapeHtml(stripInvalidXmlChars(document.title))}</dc:title>` +
    `<dc:language>${LANGUAGE}</dc:language>` +
    creator +
    `<meta property="dcterms:modified">${modified}</meta>` +
    '</metadata>' +
    `<manifest>${manifest}</manifest>` +
    `<spine toc="ncx">${spine}</spine>` +
    '</package>'
  )
}

export interface EpubOptions {
  identifier?: string
  /** Injectable so a test can assert on bytes rather than on a clock. */
  modified?: string
}

export function buildEpub(document: Document, { identifier, modified }: EpubOptions = {}): Uint8Array {
  const id = identifier ?? `noblesee-${slug(document.title)}`
  const stamp = modified ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  const grouped = chapters(document)
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {}
  const chapterFiles: string[] = []
  const toc: TocEntry[] = []

  grouped.forEach(({ title, blocks }, index) => {
    let opening = ''
    if (index === 0) {
      opening = `<h1>${escapeHtml(document.title)}</h1>`
      if (document.author) {
        opening += `<p class="byline">${escapeHtml(document.author)}</p>`
      }
    }

    const file = `chapter-${index + 1}.xhtml`
    chapterFiles.push(file)
    files[`EPUB/${file}`] = strToU8(
      xhtml(title, chapterHtml(title, blocks, opening)),
    )

    // Two levels deep where the book has two. A chapter with section
    // heads gets them as children, so a reader navigating a four-hundred
    // page classic lands on the passage rather than at the top of the
    // chapter containing it — which is the whole difference between a
    // table of contents and a list of files.
    toc.push({
      href: file,
      title,
      children: sections(blocks).map(({ anchor, title: text }) => ({
        href: `${file}#${anchor}`,
        title: text,
      })),
    })
  })

  files['EPUB/style/noblesee.css'] = strToU8(BOOK_CSS)
  files['EPUB/nav.xhtml'] = strToU8(navXhtml(toc))
  files['EPUB/toc.ncx'] = strToU8(ncx(id, document.title, toc))
  files['EPUB/content.opf'] = strToU8(contentOpf(id, document, chapterFiles, stamp))
  files['META-INF/container.xml'] = strToU8(CONTAINER_XML)

  // `mimetype` must be the first entry in the archive and must be
  // stored, not deflated. A reader that checks — and Kindle's converter
  // does — rejects the file outright otherwise, which is why this is
  // built as an ordered object with the entry inserted first.
  return zipSync(
    {
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      ...files,
    },
    { level: 6 },
  )
}

function slug(title: string): string {
  let hash = 0
  for (const ch of title) {
    hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  }
  return hash.toString(16)
}
