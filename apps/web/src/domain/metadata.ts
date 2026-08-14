/**
 * Reading a book's own metadata out of the file.
 *
 * An uploader should not have to retype what the file already says. The
 * parsers here take the raw bytes or markup a file carries and produce
 * the fields the catalog needs; the caller does the unzipping and the
 * I/O (`lib/extractMetadata.ts`), so everything below is pure and
 * testable against a fixture string.
 *
 * Everything extracted is a **suggestion**. The reader sees it on a
 * summary page and can change any of it before anything is submitted —
 * which matters, because these formats are full of metadata that is
 * wrong, stale, or the name of whatever program produced the file.
 * "Microsoft Word - chapter1.doc" is a real title field, and a scanner
 * that writes its own model number into `/Author` is normal.
 *
 * Framework-independent, like everything in `src/domain`.
 */

export interface ExtractedMetadata {
  title?: string
  author?: string
  description?: string
  language?: string
}

/** Titles longer than this are a paragraph that ended up in the wrong field. */
const MAX_TITLE = 200
const MAX_DESCRIPTION = 2000

/**
 * Values that are technically present and worth nothing.
 *
 * Word writes its own filename into `dc:title` when the author never
 * set one, and every PDF library has a default it stamps on output.
 * Passing these through would mean a library full of books called
 * "untitled" — worse than an empty field, because an empty field
 * prompts the reader to fill it in.
 */
const JUNK = [
  /^untitled/i,
  /^microsoft word\b/i,
  /^document\d*$/i,
  // Nothing but punctuation. The Unicode property escape is essential
  // rather than tidy: `\W` is [^A-Za-z0-9_], so a plain /^\W*$/ counts
  // every Chinese character as a non-word character and would discard
  // 論語別裁 as punctuation — silently dropping the titles of most of
  // the books this library exists for.
  /^[^\p{Letter}\p{Number}]*$/u,
  /^(unknown|none|n\/a|null|undefined)$/i,
  /\.(docx?|pdf|txt|md)$/i,
  // What a scanner or a phone names its output.
  /^(scan|img|image|doc|dsc|page|photo)[\s_-]*\d+$/i,
]

function clean(value: string | undefined | null, limit = MAX_TITLE): string | undefined {
  if (typeof value !== 'string') return undefined
  // Collapse the newlines and tabs that survive in XMP and PDF strings.
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text || JUNK.some((pattern) => pattern.test(text))) return undefined
  return text.slice(0, limit)
}

function firstMatch(source: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const found = source.match(pattern)
    if (found?.[1]) {
      const value = clean(decodeXmlEntities(found[1]))
      if (value) return value
    }
  }
  return undefined
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}

/**
 * DOCX metadata, from `docProps/core.xml`.
 *
 * The most reliable of the three: it is a small, well-specified XML
 * document that Word and every library that writes DOCX fill in.
 */
export function fromCoreXml(xml: string): ExtractedMetadata {
  const tag = (name: string) => new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')

  return dropEmpty({
    title: firstMatch(xml, [tag('dc:title'), tag('title')]),
    author: firstMatch(xml, [tag('dc:creator'), tag('creator'), tag('cp:lastModifiedBy')]),
    description: clean(
      firstMatch(xml, [tag('dc:description'), tag('description'), tag('dc:subject')]),
      MAX_DESCRIPTION,
    ),
    language: normalizeLanguage(firstMatch(xml, [tag('dc:language'), tag('language')])),
  })
}

/**
 * PDF metadata, from the Info dictionary or an XMP packet.
 *
 * Deliberately a scan over the raw bytes rather than a parse. A correct
 * PDF parser has to walk the cross-reference table, and in a modern file
 * that table is itself a compressed object stream — which is a lot of
 * machinery for two strings we are only going to show someone for
 * confirmation anyway. XMP is checked first because when both exist it
 * is the one that gets updated.
 */
export function fromPdfText(raw: string): ExtractedMetadata {
  const xmpTitle = firstMatch(raw, [
    /<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i,
    /<dc:title[^>]*>([^<]+)<\/dc:title>/i,
  ])
  const xmpAuthor = firstMatch(raw, [
    /<dc:creator>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i,
    /<dc:creator[^>]*>([^<]+)<\/dc:creator>/i,
  ])
  const xmpDescription = firstMatch(raw, [
    /<dc:description>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i,
  ])

  return dropEmpty({
    title: xmpTitle ?? clean(pdfString(raw, 'Title')),
    author: xmpAuthor ?? clean(pdfString(raw, 'Author')),
    description: clean(xmpDescription ?? pdfString(raw, 'Subject'), MAX_DESCRIPTION),
    language: normalizeLanguage(
      firstMatch(raw, [/<dc:language>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i]) ??
        pdfString(raw, 'Lang'),
    ),
  })
}

/**
 * One `/Key (value)` or `/Key <hex>` entry from a PDF dictionary.
 *
 * Both forms are legal and both are common: producers that write
 * non-Latin titles almost always use the hex form, because the literal
 * form cannot carry a byte-order mark cleanly.
 */
function pdfString(raw: string, key: string): string | undefined {
  const literal = raw.match(new RegExp(`/${key}\\s*\\(((?:\\\\.|[^\\\\()])*)\\)`))
  if (literal?.[1]) return decodePdfLiteral(literal[1])

  const hex = raw.match(new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]+)>`))
  if (hex?.[1]) return decodePdfHex(hex[1])

  return undefined
}

function decodePdfLiteral(value: string): string {
  return value
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\(.)/g, '$1')
}

function decodePdfHex(value: string): string | undefined {
  const digits = value.replace(/\s+/g, '')
  if (digits.length % 2 !== 0) return undefined

  const bytes = new Uint8Array(digits.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16)
  }

  // A UTF-16BE byte-order mark is how PDF carries anything outside
  // Latin-1 — which is every Chinese title this project cares about.
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = ''
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      text += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!)
    }
    return text
  }

  return new TextDecoder('latin1').decode(bytes)
}

/**
 * A title from the text itself, for a plain-text or Markdown upload.
 *
 * The first non-empty line, which is the convention every such file
 * follows whether or not its author thought about it. A Markdown
 * heading marker is stripped; a line long enough to be prose is not a
 * title and is refused rather than truncated into a misleading one.
 */
export function fromPlainText(text: string): ExtractedMetadata {
  for (const line of text.split(/\r?\n/, 40)) {
    const stripped = line.replace(/^#+\s*/, '').replace(/^=+$|^-+$/, '').trim()
    if (!stripped) continue
    if (stripped.length > 120) return {}
    const title = clean(stripped)
    return title ? { title } : {}
  }
  return {}
}

/** A last resort: the filename, tidied into something readable. */
export function fromFilename(filename: string): ExtractedMetadata {
  const stem = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
  const title = clean(stem)
  return title ? { title } : {}
}

/**
 * Merge extraction results, best source first.
 *
 * Field by field rather than object by object, so a file whose XMP has
 * a title but no author can still take the author from its Info
 * dictionary.
 */
export function mergeMetadata(...sources: ExtractedMetadata[]): ExtractedMetadata {
  const merged: ExtractedMetadata = {}
  for (const source of sources) {
    for (const [key, value] of Object.entries(source) as [keyof ExtractedMetadata, string][]) {
      if (!merged[key] && value) merged[key] = value
    }
  }
  return merged
}

/** The catalog's language codes. Anything unrecognised is left unset. */
export function normalizeLanguage(value: string | undefined): string | undefined {
  if (!value) return undefined
  const code = value.trim().toLowerCase().replace(/_/g, '-')

  if (/^zh-(hant|tw|hk|mo)/.test(code)) return 'zh-Hant'
  if (/^zh-(hans|cn|sg)/.test(code)) return 'zh-Hans'
  // Bare `zh` goes to Traditional: this library is largely traditional
  // Chinese classics, and the reader can change it on the summary page.
  if (/^zh/.test(code)) return 'zh-Hant'
  if (/^en/.test(code)) return 'en'

  return undefined
}

function dropEmpty(value: ExtractedMetadata): ExtractedMetadata {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== ''),
  ) as ExtractedMetadata
}
