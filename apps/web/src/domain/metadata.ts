export interface ExtractedMetadata {
  title?: string
  author?: string
  description?: string
  language?: string
  pageCount?: number
  characters?: number
}

const MAX_TITLE = 200
const MAX_DESCRIPTION = 2000

const JUNK = [
  /^untitled/i,
  /^microsoft word\b/i,
  /^document\d*$/i,
  /^[^\p{Letter}\p{Number}]*$/u,
  /^(unknown|none|n\/a|null|undefined)$/i,
  /^(scan|img|image|doc|dsc|page|photo|chapter|part|section|file)[\s_-]*\d+$/i,
]

function clean(value: string | undefined | null, limit = MAX_TITLE): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.(docx?|pdf|txt|md)$/i, '')
    .trim()

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

export function bytesToBinaryString(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return out
}

function decodeUtf16(bytes: Uint8Array, bigEndian: boolean): string {
  let text = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const a = bytes[i]!
    const b = bytes[i + 1]!
    text += String.fromCharCode(bigEndian ? (a << 8) | b : (b << 8) | a)
  }
  return text
}

function decodeSelfEvident(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(bytes.subarray(2), true)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16(bytes.subarray(2), false)

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export function repairUtf8(value: string): string {
  if (!/[\u0080-\u00ff]/.test(value)) return value
  for (const character of value) {
    if (character.codePointAt(0)! > 0xff) return value
  }

  const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0))

  const evident = decodeSelfEvident(bytes)
  if (evident !== null) return evident

  let best = value
  let bestScore = cjkScore(value)

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

const COMMON_HAN = new Set(
  '的一是不了在人有我他這個們中來上大為和國地到以說時要就出會可也你對生能而子那得於著下自之年過發後作里用道行所然家種事成方多經麼去法學如都同現當沒動面起看定天分還進好小部其些主樣理心她本前開但因只從想實日軍者意無力它與長把機十民第公此已工使情明性知全三又關點正業外將兩高間由問很最重並物手應戰向頭文體政美相見被利什二等產或新己制身果加西斯月話合回特代內信表化老給世位次度門任常先海通教兒原東聲提立及比員解水名真論處走義各入几口認條平系氣題活爾更別打女變四神總何電數安少報才結反受目太量再感建務做接必場件計管期市直德資命山金指克許統區保至隊形社便空決治展馬科司五基眼書非則聽白卻界達光放強即像難且權思王象完設式色路記南品住告類求據程北邊死張該交規萬取拉格望覺術領共確傳師觀清今切院讓識候帶導爭運笑飛風步改收根干造言聯持組每濟車親極林服快辦議往元英士證近失轉夫令準布始怎呢存未遠叫台單影具羅字愛擊流備兵連調深商算質團集百需價花黨華城石級整府離況亞請技際約示復病息究線似官火斷精滿支視消越器容照須九增研寫稱企八功吧培記懷瑾論語別裁道德經孔孟莊'
)

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

export function fromPdfText(raw: string): ExtractedMetadata {
  const xmpTitle = firstRaw(raw, [
    /<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i,
    /<dc:title[^>]*>([^<]+)<\/dc:title>/i,
  ])
  const xmpAuthor = firstRaw(raw, [
    /<dc:creator>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i,
    /<dc:creator[^>]*>([^<]+)<\/dc:creator>/i,
  ])
  const xmpDescription = firstRaw(raw, [
    /<dc:description>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i,
  ])

  const [title, author, description] = repairTogether([
    xmpTitle ?? pdfString(raw, 'Title'),
    xmpAuthor ?? pdfString(raw, 'Author'),
    xmpDescription ?? pdfString(raw, 'Subject'),
  ])

  return dropEmpty({
    title: clean(title),
    author: clean(author),
    description: clean(description, MAX_DESCRIPTION),
    language: normalizeLanguage(
      clean(firstRaw(raw, [/<dc:language>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i])) ??
        clean(pdfString(raw, 'Lang')),
    ),
  })
}

function firstRaw(source: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const found = source.match(pattern)
    if (found?.[1]) return decodeXmlEntities(found[1])
  }
  return undefined
}

export function pdfPageCount(raw: string): number | undefined {
  const counts = [...raw.matchAll(/\/Count\s+(\d+)/g)]
    .map((match) => Number(match[1]))
    .filter((n) => Number.isFinite(n) && n > 0)

  if (counts.length > 0) return Math.max(...counts)

  const objects = raw.match(/\/Type\s*\/Page[^s]/g)
  return objects && objects.length > 0 ? objects.length : undefined
}

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

  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(bytes.subarray(2), true)

  return repairUtf8(bytesToBinaryString(bytes))
}

export function repairTogether(values: (string | undefined)[]): (string | undefined)[] {
  const out = [...values]
  const ambiguous: number[] = []

  values.forEach((value, index) => {
    if (!value) return
    const bytes: number[] = []
    for (const character of value) {
      const code = character.codePointAt(0)!
      if (code > 0xff) return
      bytes.push(code)
    }

    const evident = decodeSelfEvident(Uint8Array.from(bytes))
    if (evident !== null) {
      out[index] = evident
      return
    }

    ambiguous.push(index)
  })

  if (ambiguous.length > 0) {
    const repaired = repairUtf8(ambiguous.map((index) => values[index]).join('\n')).split('\n')
    ambiguous.forEach((index, position) => {
      out[index] = repaired[position] ?? values[index]
    })
  }

  return out
}

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

export function fromFilename(filename: string): ExtractedMetadata {
  const stem = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
  const title = clean(stem)
  return title ? { title } : {}
}

export function mergeMetadata(...sources: ExtractedMetadata[]): ExtractedMetadata {
  const merged: Record<string, unknown> = {}
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (merged[key] === undefined && value !== undefined && value !== '') {
        merged[key] = value
      }
    }
  }
  return merged as ExtractedMetadata
}

export function normalizeLanguage(value: string | undefined): string | undefined {
  if (!value) return undefined
  const code = value.trim().toLowerCase().replace(/_/g, '-')

  if (/^zh-(hant|tw|hk|mo)/.test(code)) return 'zh-Hant'
  if (/^zh-(hans|cn|sg)/.test(code)) return 'zh-Hans'
  if (/^zh/.test(code)) return 'zh-Hant'
  if (/^en/.test(code)) return 'en'

  return undefined
}

function dropEmpty(value: ExtractedMetadata): ExtractedMetadata {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== ''),
  ) as ExtractedMetadata
}
