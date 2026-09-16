import { zipSync, strToU8 } from 'fflate'

import { BOOK_CSS, chapterHtml, chapters, escapeHtml, sections } from '../../domain/bookHtml'
import { type Document } from '../../domain/document'
import { stripInvalidXmlChars } from './xml'

const CONTAINER_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
  '<rootfiles><rootfile full-path="EPUB/content.opf"' +
  ' media-type="application/oebps-package+xml"/></rootfiles></container>'

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
