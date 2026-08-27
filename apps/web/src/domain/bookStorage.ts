/**
 * Where a book's objects live.
 *
 * Every object a book owns shares one **stem** and differs only in what
 * is appended:
 *
 *     books/{stem}.pdf               the upload, kept as uploaded
 *     books/{stem}.docx              the master
 *     books/{stem}.epub              the reading edition
 *     books/{stem}.txt               a text upload, kept as itself
 *     books/{stem}-cover.jpg         the cover
 *     books/{stem}-cover-2.jpg       the other rendered candidates
 *     books/{stem}-suggestions.json  what the model proposed
 *     books/{stem}-decisions.json    the same file, decided
 *
 * The stem comes from **the name of the file that was uploaded**, and
 * that is the whole design: a book can be renamed, and renaming it must
 * not strand or move a single object. The layout was `books/{book_id}/`
 * until 2026-08-26 and briefly `books/{slug}` on the same day — the slug
 * was wrong for exactly this reason, since `adminApi.ts` lets an editor
 * correct one.
 *
 * The path is not the link either way. A book reaches its objects
 * through the keys it stores — `artifacts[].storageKey`,
 * `conversion.sourceKey`, `generatedCover.key` — read back, never
 * recomputed. Production proves it: the two seed books record keys
 * under `books/4/` and `books/18/` while being books 1 and 2, and
 * everything about them works. The stem exists to give those keys a
 * name a human can read, not to find them.
 *
 * Uploaded names are not unique — two readers both have a `scan.pdf` —
 * so a stem already taken gets an **incrementing number**: `scan`,
 * `scan-2`, `scan-3`. The number is resolved once, against the bucket
 * (`lib/bookObjects.ts`), and thereafter read back off the key the book
 * recorded rather than recomputed, so it cannot drift.
 */

import type { ArtifactFormat } from './conversion'

const EXTENSION: Record<ArtifactFormat, string> = {
  docx: '.docx',
  epub: '.epub',
  pdf: '.pdf',
  txt: '.txt',
}

const PREFIX = 'books/'

/** Used when a filename sanitizes away to nothing at all. */
export const FALLBACK_STEM = 'book'

/** How long a stem may be before it is cut. */
const MAX_STEM = 80

/**
 * The stem for a freshly uploaded file.
 *
 * Deliberately gentle. This is a *name*, not a slug: it keeps the
 * reader's own characters, CJK included, because the point of naming an
 * object after the file is that someone looking in the bucket
 * recognises it. What it removes is only what a key cannot carry — a
 * path separator, whitespace, control characters — and the extension,
 * which the caller re-adds per format.
 */
export function stemFromFilename(filename: unknown): string {
  const raw = typeof filename === 'string' ? filename : ''
  // Directory components first: a browser can send `C:\scans\book.pdf`.
  const base = raw.split(/[/\\]/).pop() ?? ''
  // Only the final extension, and only if it looks like one — a title
  // containing a dot is not carrying a file type.
  const stripped = base.replace(/\.[A-Za-z0-9]{1,8}$/, '')

  const cleaned = stripped
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, '-')
    // Characters that make a key ambiguous to read or awkward to quote.
    .replace(/["'`?#%&<>{}[\]^~|:*\\]/g, '')
    .replace(/\.+/g, '.')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, MAX_STEM)
    .replace(/^[-.]+|[-.]+$/g, '')

  return cleaned || FALLBACK_STEM
}

/**
 * The stem a book is already using, read back off a key it records.
 *
 * Trusted rather than re-sanitized: this key is one we wrote. It keeps
 * any inner path, so a book stored under the old `books/{id}/book/`
 * layout yields the stem `{id}/book/master` and its next artifact is
 * filed beside the ones it already has instead of moving house.
 */
export function stemFromKey(key: string): string {
  const withoutPrefix = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key
  const slash = withoutPrefix.lastIndexOf('/')
  const dot = withoutPrefix.lastIndexOf('.')
  return dot > slash && dot > 0 ? withoutPrefix.slice(0, dot) : withoutPrefix
}

/**
 * The stem this book uses for everything.
 *
 * An object it already owns decides it, so the stem is fixed the moment
 * the first one is written and no later rename can move it. Only a book
 * with nothing filed yet mints one, from the uploaded filename.
 *
 * `preferred` is the format of the original — a PDF upload is the
 * book's PDF, a DOCX upload is its master — because that is the object
 * whose name came from the reader's own file. Falling back through the
 * master and then anything at all matters only for books written under
 * the old layout, whose slots do not share a stem.
 */
export function bookStem({
  artifacts,
  sourceFilename,
  preferred,
}: {
  artifacts?: readonly { format?: string | null; storageKey?: string | null }[] | null
  sourceFilename?: unknown
  preferred?: ArtifactFormat | null
}): string {
  const filed = (artifacts ?? []).filter(
    (artifact): artifact is { format: string; storageKey: string } =>
      typeof artifact?.storageKey === 'string' && artifact.storageKey.length > 0,
  )

  const anchor =
    (preferred ? filed.find((artifact) => artifact.format === preferred) : undefined) ??
    filed.find((artifact) => artifact.format === 'docx') ??
    filed[0]

  return anchor ? stemFromKey(anchor.storageKey) : stemFromFilename(sourceFilename)
}

/** The master, the reading edition, or an upload kept as itself. */
export function artifactKey(stem: string, format: ArtifactFormat): string {
  return `${PREFIX}${stem}${EXTENSION[format]}`
}

/** What the model proposed, awaiting a decision. */
export function suggestionsKey(stem: string): string {
  return `${PREFIX}${stem}-suggestions.json`
}

/** The suggestions file with `approved` filled in. */
export function decisionsKey(stem: string): string {
  return `${PREFIX}${stem}-decisions.json`
}

/**
 * Where a generated cover lives.
 *
 * JPEG rather than PNG: this is a photograph of a page, and a lossless
 * encoding of a scan is several times the size for no visible gain on a
 * tile 150px wide.
 */
export function coverKey(stem: string, page: number = 1): string {
  return coverCandidateKey(`${PREFIX}${stem}-cover.jpg`, page)
}

/**
 * Candidate `page` of a cover, given the key the book already records.
 *
 * Derived from the *stored* base key rather than rebuilt, which is what
 * lets a cover rendered under the old layout keep answering with
 * nothing migrated:
 *
 *     books/4/cover.jpg        → books/4/cover-2.jpg
 *     books/scan-cover.jpg     → books/scan-cover-2.jpg
 *
 * Page one keeps the unsuffixed name it has always had, so every cover
 * rendered before candidates existed is still at the key its book
 * records.
 */
export function coverCandidateKey(baseKey: string, page: number): string {
  return page <= 1 ? baseKey : numbered(baseKey, page - 1)
}

/**
 * The same key with an incrementing number on it: `x.epub`, `x-2.epub`,
 * `x-3.epub`. `attempt` counts from 0, where 0 is the bare name.
 */
export function numbered(key: string, attempt: number): string {
  if (attempt <= 0) return key
  const slash = key.lastIndexOf('/')
  const dot = key.lastIndexOf('.')
  const tag = `-${attempt + 1}`
  return dot > slash && dot > 0
    ? `${key.slice(0, dot)}${tag}${key.slice(dot)}`
    : `${key}${tag}`
}

/** A stem with an incrementing number on it: `scan`, `scan-2`, `scan-3`. */
export function numberedStem(stem: string, attempt: number): string {
  return attempt <= 0 ? stem : `${stem}-${attempt + 1}`
}

/**
 * Every key a book with this stem would ever occupy.
 *
 * The number belongs to the **book**, not to each file: a stem is taken
 * if *any* of these is, so a book never ends up as `scan.docx` beside
 * `scan-2.epub`. That is the whole point of naming variations after one
 * original — they have to keep agreeing, and agreeing only at the
 * moment of the first write is not agreeing.
 *
 * Cover candidates past the first are deliberately absent: they are
 * suffixes of a key already in this list, so an unused stem cannot have
 * them without having the cover itself.
 */
export function stemFootprint(stem: string): string[] {
  return [
    artifactKey(stem, 'pdf'),
    artifactKey(stem, 'docx'),
    artifactKey(stem, 'epub'),
    artifactKey(stem, 'txt'),
    coverKey(stem),
    suggestionsKey(stem),
    decisionsKey(stem),
  ]
}
