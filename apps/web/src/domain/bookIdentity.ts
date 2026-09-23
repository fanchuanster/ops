export const BOOK_LANGUAGES = ['zh-Hans', 'zh-Hant', 'en', 'zh-en'] as const

export type BookLanguage = (typeof BOOK_LANGUAGES)[number]

export interface ShelfChoice {
  id: number
  path: string
  description?: string | null
}

export interface BookIdentity {
  title?: string
  author?: string
  language?: BookLanguage
  collection?: number
}

export const FIRST_PAGE_TEXT_CHARS = 3000

const MAX_FIELD = 200

const MAX_SHELF_DESCRIPTION = 160

const PLACEHOLDER = /^(unknown|none|n\/a|null|undefined|untitled|未知|无|無)$/i

export const IDENTIFY_SYSTEM = [
  'You fill in a library record for a book from the names of the files its uploader sent and its first page — usually a scanned title page or cover, sometimes the opening text.',
  'Reply with one JSON object: {"title": string|null, "author": string|null, "language": string|null, "collection": number|null}.',
  'title: the book’s own title exactly as printed, in its original script. Keep a printed subtitle, volume or edition marker in full-width parentheses, e.g. 壽康寶鑑（現代全譯）. Never translate or romanize.',
  'author: the author, compiler or translator as printed, in its original script, without role words like 著 or 编. Several names: join with "、".',
  `language: the language of the book's body text — one of ${BOOK_LANGUAGES.join(', ')}. zh-en means Chinese and English in roughly equal measure.`,
  'collection: the id of the one listed collection this book plainly belongs to — an author collection when the author has one, otherwise the collection whose subject it is. null when none fits; never invent an id.',
  'File names often carry catalogue numbers and site names; use them for what they plainly say, and where several agree, trust that more — but prefer what the page shows.',
  'Anything neither shows, or that you cannot read with confidence, is null. Never guess from general knowledge.',
].join('\n')

function shelfLine(shelf: ShelfChoice): string {
  const about = shelf.description?.replace(/\s+/g, ' ').trim().slice(0, MAX_SHELF_DESCRIPTION)
  return about ? `${shelf.id}: ${shelf.path} — ${about}` : `${shelf.id}: ${shelf.path}`
}

function fileLines(filenames: readonly string[]): string {
  const names = [...new Set(filenames.map((name) => name.trim()).filter(Boolean))].map((name) =>
    name.slice(0, MAX_FIELD),
  )
  if (names.length === 0) return 'Uploaded file names: none given.'
  if (names.length === 1) return `Uploaded file name: ${names[0]}`
  return `Uploaded file names:\n${names.map((name) => `- ${name}`).join('\n')}`
}

export type FirstPage = { kind: 'image' } | { kind: 'text'; text: string } | { kind: 'none' }

function pageLine(page: FirstPage): string {
  switch (page.kind) {
    case 'image':
      return 'The first page is attached as an image.'
    case 'text':
      return `First page text:\n${page.text.slice(0, FIRST_PAGE_TEXT_CHARS)}`
    case 'none':
      return 'No first page is available. Work from the file names alone.'
  }
}

export function identifyPrompt(
  filenames: readonly string[],
  shelves: readonly ShelfChoice[],
  page: FirstPage,
): string {
  const lines = [fileLines(filenames)]
  lines.push(
    shelves.length > 0
      ? `Collections:\n${shelves.map(shelfLine).join('\n')}`
      : 'Collections: none yet — collection is null.',
  )
  lines.push(pageLine(page))
  return lines.join('\n')
}

function field(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text || PLACEHOLDER.test(text)) return undefined
  return text.slice(0, MAX_FIELD)
}

function language(value: unknown): BookLanguage | undefined {
  return BOOK_LANGUAGES.find((known) => known === value)
}

function wholeNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) return undefined
  return number
}

function collection(value: unknown, shelves: readonly ShelfChoice[]): number | undefined {
  const id = wholeNumber(value)
  return shelves.some((shelf) => shelf.id === id) ? id : undefined
}

export function parseIdentity(raw: string, shelves: readonly ShelfChoice[] = []): BookIdentity {
  const body = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  if (!body) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object') return {}

  const answer = parsed as Record<string, unknown>
  const identity: BookIdentity = {
    title: field(answer.title),
    author: field(answer.author),
    language: language(answer.language),
    collection: collection(answer.collection, shelves),
  }
  return Object.fromEntries(
    Object.entries(identity).filter(([, value]) => value !== undefined),
  ) as BookIdentity
}
