/**
 * What a machine may change about a book or a shelf, and how it says so.
 *
 * The admin API (`app/(frontend)/api/admin/…`) exists so the library can
 * be curated by something other than a person with a browser — a
 * migration script, a bulk re-shelving, an editor's own tooling. This
 * module is the part of it with rules rather than plumbing: which
 * fields are writable, what each one accepts, and what a refusal says.
 *
 * Three principles, and the first is the one that matters:
 *
 * **An unknown field is an error, not a shrug.** Silently dropping
 * `{ levl: 'essential' }` would answer 200 having changed nothing,
 * which is the worst possible outcome for a script — it reports success
 * and the library is untouched. Every key is either understood or
 * named in the refusal.
 *
 * **The allowlist is the boundary, not the collection's access rules.**
 * Access control says *who* may write; this says *what*. `owner`,
 * `review`, `conversion`, `artifacts`, `priceCredits` and `pageCount`
 * are absent on purpose: they are the pipeline's, the review queue's,
 * or derived, and a curation API that could set them would be a way to
 * fabricate a book's history rather than describe it.
 *
 * **Vocabulary in, storage out.** A caller names a level
 * (`"essential"`), never its stored id — `domain/levels.ts` owns that
 * table, and an API that took ids would freeze them into every client.
 *
 * What this module deliberately does *not* enforce: the rights gate on
 * publication, and the nesting rules for a shelf's parent. Both are
 * collection hooks (`enforcePublicationReview`, and the cycle/depth
 * check on `book-collections`), which means they hold for every writer
 * — the admin UI, the REST API, this API, and anything added later.
 * Checking
 * them here as well would be a second copy that could drift.
 *
 * Framework-independent, like everything in `src/domain`.
 */

import { BOOK_LEVELS, isBookLevel, levelId } from './levels'
import { RIGHTS_STATUSES, type RightsStatus } from './rights'

/** The languages a book may be filed under, mirroring the select. */
export const BOOK_LANGUAGES = ['zh-Hans', 'zh-Hant', 'en', 'zh-en'] as const

export const BOOK_VISIBILITIES = ['public', 'private'] as const

export interface FieldError {
  field: string
  message: string
}

export type Parsed =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: FieldError[] }

/**
 * Everything the API will write to a book, and nothing else.
 *
 * `slug` is here and it is the one worth justifying. Changing a slug
 * breaks every link to the book, which is normally reason enough to
 * refuse — but slugs are minted from the title at upload and are never
 * regenerated when the title is corrected, so a book whose PDF carried
 * a download site's slogan keeps that slogan in its URL forever. The
 * only way to fix that today is a hand-written script. It is uniquely
 * indexed, so a collision fails loudly rather than silently merging.
 */
export const BOOK_WRITABLE = [
  'title',
  'slug',
  'subtitle',
  'originalTitle',
  'author',
  'translator',
  'language',
  'description',
  'level',
  'collection',
  'rightsStatus',
  'visibility',
] as const

export const COLLECTION_WRITABLE = ['title', 'description', 'parent', 'sortOrder'] as const

export function parseBookUpdate(body: unknown): Parsed {
  return parse(body, BOOK_WRITABLE, {
    title: required('title', text),
    // Not `required`: a slug may be corrected but never emptied, and an
    // empty one would make the book unreachable rather than untitled.
    slug: required('slug', slugText),
    subtitle: nullable(text),
    originalTitle: nullable(text),
    author: nullable(text),
    translator: nullable(text),
    language: oneOf('language', BOOK_LANGUAGES),
    description: nullable(text),
    level: parseLevel,
    collection: nullableId,
    rightsStatus: oneOf('rightsStatus', RIGHTS_STATUSES as readonly RightsStatus[]),
    visibility: oneOf('visibility', BOOK_VISIBILITIES),
  })
}

export function parseCollectionUpdate(body: unknown): Parsed {
  return parse(body, COLLECTION_WRITABLE, {
    title: required('title', text),
    description: nullable(text),
    // Null is a real instruction — "make this a root shelf" — and not a
    // missing value, so it clears rather than being ignored.
    parent: nullableId,
    sortOrder: nullableInteger,
  })
}

// ── the machinery ────────────────────────────────────────────────────

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

/** A trimmed string, or null for anything blank. */
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

/** A field that may be set or cleared, but whose type is fixed when set. */
function nullable(read: (value: unknown) => ReturnType<Reader>): Reader {
  return (value) => (value === null ? { ok: true, value: null } : read(value))
}

/** A field that must have a value: null and blank are both refusals. */
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

/**
 * A level by name, stored as its id.
 *
 * Names have no order and ids do; `domain/levels.ts` owns the table
 * between them. Taking the name at the boundary is what keeps the ids
 * out of every client that ever calls this.
 */
const parseLevel: Reader = (value) => {
  if (!isBookLevel(value)) {
    return { ok: false, message: `level must be one of: ${BOOK_LEVELS.join(', ')}.` }
  }
  return { ok: true, value: levelId(value) }
}

/**
 * The shelves a book stands on, replacing whatever it stood on before.
 *
 * A replace and not an append, and an empty array is the real
 * instruction "take it off every shelf" — which is why it is accepted
 * rather than treated as a missing value.
 */
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
