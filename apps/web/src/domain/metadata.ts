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
  /** Pages, when the file states them outright. */
  pageCount?: number
  /** Characters of text, when it states those instead. */
  characters?: number
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

/**
 * Bytes as a string where every code unit *is* the byte.
 *
 * Deliberately not `TextDecoder('latin1')`. That label is an alias for
 * **windows-1252** in the WHATWG encoding standard, not ISO-8859-1, and
 * windows-1252 maps 0x80–0x9F onto typographic characters — 0x96
 * becomes U+2013, an en dash. The decode is therefore not
 * byte-preserving and cannot be reversed, which silently defeats the
 * UTF-8 repair below on exactly the byte range CJK text uses most.
 */
export function bytesToBinaryString(bytes: Uint8Array): string {
  let out = ''
  // Chunked: spreading a large array into fromCharCode overflows the
  // call stack, and a PDF window is up to a megabyte.
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return out
}

/**
 * Decode a byte string that could be UTF-8, GBK or Big5.
 *
 * A PDF is read one code unit per byte, so any text in it arrives as
 * raw bytes and something has to decide what they meant. PDF's own
 * answer — PDFDocEncoding, or UTF-16 with a byte-order mark — covers
 * only the well-behaved producers. Chinese-language software routinely
 * writes GBK or Big5 straight into a literal string, and those are
 * exactly the books this library is for.
 *
 * The order is not arbitrary:
 *
 *   1. **UTF-8, strictly.** It is self-validating — arbitrary bytes are
 *      overwhelmingly unlikely to form valid multi-byte UTF-8 — so a
 *      strict decode that succeeds is near-certainly right.
 *   2. **GB18030 and Big5**, scored. Neither can fail: both decode
 *      almost any byte sequence into *something*, so "did it decode" is
 *      no evidence at all. What discriminates them is whether the
 *      result looks like Chinese.
 *
 * A legacy decoding is only accepted if it produces real CJK where the
 * bytes produced none, which is what keeps "Café Littéraire" from being
 * reinterpreted as characters nobody wrote.
 */
export function repairUtf8(value: string): string {
  // Nothing outside ASCII, so nothing to decide.
  if (!/[\u0080-\u00ff]/.test(value)) return value
  // Anything above U+00FF did not come from a byte-per-code-unit read,
  // so this string was already decoded correctly by someone else.
  for (const character of value) {
    if (character.codePointAt(0)! > 0xff) return value
  }

  const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0))

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Not UTF-8. Fall through to the legacy Chinese encodings.
  }

  let best = value
  let bestScore = cjkScore(value)

  // GB18030 before Big5 only as a tie-break: it is the mainland
  // standard and by far the more common of the two.
  for (const label of ['gb18030', 'big5']) {
    let candidate: string
    try {
      candidate = new TextDecoder(label).decode(bytes)
    } catch {
      continue
    }
    if (!looksLikeChinese(candidate)) continue

    const score = cjkScore(candidate)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }

  return best
}

/**
 * The most frequent Chinese characters, simplified and traditional.
 *
 * The decisive part of encoding detection, and the reason a range check
 * alone is not enough: GBK and Big5 both turn almost any bytes into
 * *valid* CJK, so "is this in the CJK block" cannot separate them. What
 * separates them is that the right decoding produces characters people
 * actually use. 南懷瑾 read with the wrong table gives 玭胔紷 — three
 * real characters that essentially never occur in a name.
 *
 * Frequency-ordered lists of this length cover a large majority of
 * running text in both scripts, which is far more signal than a title
 * or an author's name needs.
 */
const COMMON_HAN = new Set(
  '的一是不了在人有我他這個們中來上大為和國地到以說時要就出會可也你對生能而子那得於著下自之年過發後作里用道行所然家種事成方多經麼去法學如都同現當沒動面起看定天分還進好小部其些主樣理心她本前開但因只從想實日軍者意無力它與長把機十民第公此已工使情明性知全三又關點正業外將兩高間由問很最重並物手應戰向頭文體政美相見被利什二等產或新己制身果加西斯月話合回特代內信表化老給世位次度門任常先海通教兒原東聲提立及比員解水名真論處走義各入几口認條平系氣題活爾更別打女變四神總何電數安少報才結反受目太量再感建務做接必場件計管期市直德資命山金指克許統區保至隊形社便空決治展馬科司五基眼書非則聽白卻界達光放強即像難且權思王象完設式色路記南品住告類求據程北邊死張該交規萬取拉格望覺術領共確傳師觀清今切院讓識候帶導爭運笑飛風步改收根干造言聯持組每濟車親極林服快辦議往元英士證近失轉夫令準布始怎呢存未遠叫台單影具羅字愛擊流備兵連調深商算質團集百需價花黨華城石級整府離況亞請技際約示復病息究線似官火斷精滿支視消越器容照須九增研寫稱企八功吧培記懷瑾論語別裁道德經孔孟莊'
)

/**
 * Whether a candidate decoding is Chinese text rather than an accident.
 *
 * The guard that stops European titles being reinterpreted. "München"
 * as bytes contains 0xFC 0x6E, which is a perfectly valid GBK pair for
 * 黱 — a real character, in the CJK block, that essentially nobody
 * uses. Judged on the block alone that decoding wins and the title
 * becomes "M黱chen".
 *
 * So at least half the CJK a decoding produces has to be characters
 * from the common set. Real Chinese passes easily; bytes that merely
 * happen to form legal pairs do not.
 */
function looksLikeChinese(value: string): boolean {
  let common = 0
  let han = 0
  for (const character of value) {
    const code = character.codePointAt(0)!
    if (code >= 0x3400 && code <= 0x9fff) {
      han += 1
      if (COMMON_HAN.has(character)) common += 1
    }
  }
  return han > 0 && common * 2 >= han
}

/**
 * How much of a string reads as real Chinese.
 *
 * Common characters count for far more than merely being in the CJK
 * block, because a wrong decoding lands in the block too. Replacement
 * characters, the private-use area and stray controls count against —
 * those only appear when a decoding is wrong.
 */
function cjkScore(value: string): number {
  let score = 0
  for (const character of value) {
    const code = character.codePointAt(0)!
    if (COMMON_HAN.has(character)) score += 6
    else if (code >= 0x4e00 && code <= 0x9fff) score += 1
    else if (code >= 0x3400 && code <= 0x4dbf) score -= 1
    else if (code >= 0x3000 && code <= 0x303f) score += 1
    else if (code === 0xfffd) score -= 4
    else if (code >= 0xe000 && code <= 0xf8ff) score -= 4
    else if (code < 0x20 && code !== 0x09 && code !== 0x0a) score -= 2
  }
  return score
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

  // Decoded together, not one field at a time.
  //
  // A file has one encoding, and an author's name is three characters —
  // far too little to tell GBK from Big5, both of which turn any bytes
  // into plausible-looking CJK. Judging title, author and subject as one
  // string gives the detector more to go on and, more importantly,
  // guarantees they agree: a book whose title decoded one way and whose
  // author decoded another is obviously wrong to a reader even when
  // each looks fine alone.
  const [title, author, description] = repairTogether([
    xmpTitle ?? clean(pdfString(raw, 'Title')),
    xmpAuthor ?? clean(pdfString(raw, 'Author')),
    clean(xmpDescription ?? pdfString(raw, 'Subject'), MAX_DESCRIPTION),
  ])

  return dropEmpty({
    title,
    author,
    description,
    language: normalizeLanguage(
      firstMatch(raw, [/<dc:language>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i]) ??
        pdfString(raw, 'Lang'),
    ),
  })
}

/**
 * A PDF's page count, from the page tree root.
 *
 * `/Type /Pages … /Count n` is written by every producer and sits near
 * the trailer, which is inside the window already being scanned. The
 * largest `/Count` wins: a PDF may have intermediate page-tree nodes
 * with their own smaller counts, and the root's is the total.
 */
export function pdfPageCount(raw: string): number | undefined {
  const counts = [...raw.matchAll(/\/Count\s+(\d+)/g)]
    .map((match) => Number(match[1]))
    .filter((n) => Number.isFinite(n) && n > 0)

  if (counts.length > 0) return Math.max(...counts)

  // No page tree in the window — fall back to counting page objects,
  // which works on the small hand-written PDFs that have no /Count.
  const objects = raw.match(/\/Type\s*\/Page[^s]/g)
  return objects && objects.length > 0 ? objects.length : undefined
}

/**
 * DOCX statistics, from `docProps/app.xml`.
 *
 * Word writes a real page count here. python-docx and most other
 * generators do not, so this is often absent — which is why the quota
 * treats an unmeasurable book as zero pages and lets the upload count
 * catch it instead.
 */
export function fromAppXml(xml: string): Pick<ExtractedMetadata, 'pageCount' | 'characters'> {
  const number = (name: string) => {
    const found = xml.match(new RegExp(`<${name}>(\\d+)</${name}>`, 'i'))
    const value = found ? Number(found[1]) : NaN
    return Number.isFinite(value) && value > 0 ? value : undefined
  }
  return dropEmpty({
    pageCount: number('Pages'),
    characters: number('CharactersWithSpaces') ?? number('Characters'),
  }) as Pick<ExtractedMetadata, 'pageCount' | 'characters'>
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

  // No byte-order mark. PDFDocEncoding in theory, but producers that
  // write CJK here almost always mean UTF-8, so the repair decides.
  return repairUtf8(bytesToBinaryString(bytes))
}

/**
 * Repair several fields as one, so they cannot disagree about encoding.
 *
 * Only the fields that are *still raw bytes* are grouped. That
 * distinction is the whole correctness of this function: a PDF may
 * carry its title as UTF-16BE hex — which `decodePdfHex` has already
 * turned into real characters — and its author as raw UTF-8 in a
 * literal string. Joining those two and repairing the result does
 * nothing at all, because `repairUtf8` sees a character above U+00FF
 * from the decoded title and correctly concludes the string was already
 * decoded. The author stays garbled, and only the author.
 *
 * So already-decoded fields pass through untouched, and the raw ones
 * are joined with a newline — the same byte in every encoding
 * considered — repaired together, and put back.
 */
export function repairTogether(values: (string | undefined)[]): (string | undefined)[] {
  const isRaw = (value: string | undefined): value is string => {
    if (!value) return false
    for (const character of value) {
      if (character.codePointAt(0)! > 0xff) return false
    }
    return true
  }

  const rawIndexes = values.map((value, index) => (isRaw(value) ? index : -1)).filter((i) => i >= 0)
  if (rawIndexes.length === 0) return values

  const repaired = repairUtf8(rawIndexes.map((index) => values[index]).join('\n')).split('\n')

  const out = [...values]
  rawIndexes.forEach((index, position) => {
    out[index] = repaired[position] ?? values[index]
  })
  return out
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
  const merged: Record<string, unknown> = {}
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      // `=== undefined` rather than falsy: the fields are no longer all
      // strings, and a page count of 0 is a value we would want to keep
      // if anything ever produced one.
      if (merged[key] === undefined && value !== undefined && value !== '') {
        merged[key] = value
      }
    }
  }
  return merged as ExtractedMetadata
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
