import { BOOK_LEVELS, isBookLevel, levelId } from './levels'
import { RIGHTS_STATUSES, type RightsStatus } from './rights'
import { SHELF_SORTS, orderIdFrom } from './shelfOrder'

export const BOOK_LANGUAGES = ['zh-Hans', 'zh-Hant', 'en', 'zh-en'] as const

export const BOOK_VISIBILITIES = ['public', 'private'] as const

export interface FieldError {
  field: string
  message: string
}

export type Parsed =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: FieldError[] }

export const BOOK_WRITABLE = [
  'title',
  'slug',
  'subtitle',
  'originalTitle',
  'author',
  'language',
  'description',
  'level',
  'collection',
  'collectionOrder',
  'rightsStatus',
  'visibility',
] as const

export const COLLECTION_WRITABLE = [
  'title',
  'description',
  'parent',
  'sortOrder',
  'childOrder',
] as const

export function parseBookUpdate(body: unknown): Parsed {
  return parse(body, BOOK_WRITABLE, {
    title: required('title', text),
    slug: required('slug', slugText),
    subtitle: nullable(text),
    originalTitle: nullable(text),
    author: nullable(text),
    language: oneOf('language', BOOK_LANGUAGES),
    description: nullable(text),
    level: parseLevel,
    collection: nullableId,
    collectionOrder: shelfPlace,
    rightsStatus: oneOf('rightsStatus', RIGHTS_STATUSES as readonly RightsStatus[]),
    visibility: oneOf('visibility', BOOK_VISIBILITIES),
  })
}

export function parseCollectionUpdate(body: unknown): Parsed {
  return parse(body, COLLECTION_WRITABLE, {
    title: required('title', text),
    description: nullable(text),
    parent: nullableId,
    sortOrder: shelfPlace,
    childOrder: oneOf('childOrder', SHELF_SORTS),
  })
}

const shelfPlace: Reader = (value, field) => {
  if (value === null) return { ok: true, value: null }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, message: `${field} must be a number or null.` }
  }
  return { ok: true, value: orderIdFrom(value) }
}

type Reader = (value: unknown, field: string) => { ok: true; value: unknown } | { ok: false; message: string }

function parse(
  body: unknown,
  writable: readonly string[],
  readers: Record<string, Reader>,
): Parsed {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: [{ field: '', message: 'Send a JSON object.' }] }
  }

  const keys = Object.keys(body as Record<string, unknown>)
  if (keys.length === 0) {
    return { ok: false, errors: [{ field: '', message: 'Nothing to update.' }] }
  }

  const errors: FieldError[] = []
  const data: Record<string, unknown> = {}

  for (const key of keys) {
    if (!writable.includes(key)) {
      errors.push({
        field: key,
        message: `Not writable here. This API sets: ${writable.join(', ')}.`,
      })
      continue
    }
    const read = readers[key]!
    const result = read((body as Record<string, unknown>)[key], key)
    if (result.ok) Object.assign(data, { [key]: result.value })
    else errors.push({ field: key, message: result.message })
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, data }
}

function text(value: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  if (typeof value !== 'string') return { ok: false, message: 'Expected a string.' }
  const trimmed = value.trim()
  return { ok: true, value: trimmed === '' ? null : trimmed }
}

function slugText(value: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  const read = text(value)
  if (!read.ok) return read
  if (typeof read.value !== 'string') return { ok: false, message: 'A slug cannot be empty.' }
  if (/\s|\//.test(read.value)) {
    return { ok: false, message: 'A slug is one URL segment: no spaces and no slashes.' }
  }
  return read
}

function nullable(read: (value: unknown) => ReturnType<Reader>): Reader {
  return (value) => (value === null ? { ok: true, value: null } : read(value))
}

function required(field: string, read: (value: unknown) => ReturnType<Reader>): Reader {
  return (value) => {
    const result = read(value)
    if (!result.ok) return result
    if (result.value === null) return { ok: false, message: `${field} cannot be empty.` }
    return result
  }
}

function oneOf(field: string, allowed: readonly string[]): Reader {
  return (value) => {
    if (typeof value === 'string' && allowed.includes(value)) return { ok: true, value }
    return { ok: false, message: `${field} must be one of: ${allowed.join(', ')}.` }
  }
}

const parseLevel: Reader = (value) => {
  if (!isBookLevel(value)) {
    return { ok: false, message: `level must be one of: ${BOOK_LEVELS.join(', ')}.` }
  }
  return { ok: true, value: levelId(value) }
}

const nullableId: Reader = (value) => {
  if (value === null) return { ok: true, value: null }
  if (!Number.isInteger(value) || (value as number) < 1) {
    return { ok: false, message: 'Expected a positive whole number, or null.' }
  }
  return { ok: true, value }
}

const nullableInteger: Reader = (value) => {
  if (value === null) return { ok: true, value: null }
  if (!Number.isInteger(value)) return { ok: false, message: 'Expected a whole number, or null.' }
  return { ok: true, value }
}
