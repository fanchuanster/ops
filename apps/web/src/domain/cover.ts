/**
 * A book's cover, when nobody has supplied one.
 *
 * This library's material is scans, and a scan's first page *is* its
 * cover — the title page a reader would see picking the book up. So the
 * default cover is that page, rendered as an image, rather than a
 * missing image or a placeholder.
 *
 * There are two covers on a Book and they are not the same thing:
 *
 *   `cover`           an editor's upload. A deliberate choice, and it
 *                     always wins.
 *   `generatedCover`  page one of the book, rendered by the converter.
 *                     A default, and only ever a default.
 *
 * Separate fields rather than one, because a generated cover must never
 * overwrite a chosen one, and an editor who deletes their upload should
 * fall back to the page rather than to nothing.
 *
 * **Rendered from the book's own artifacts, not from its upload.** The
 * artifact is what survives — a converted scan's `pdf` artifact *is* the
 * uploaded scan (`domain/publication.ts`), and a book with no upload at
 * all still has editions to take a page from. It also means a cover is
 * only ever attempted once there is something to render, so a book
 * waiting on its conversion simply stays pending.
 *
 * Framework-independent, like everything in `src/domain`.
 */

import { ARTIFACT_FORMATS, type ArtifactFormat, artifactPrefix } from './conversion'

/**
 * How far a book has got towards having a generated cover.
 *
 * `failed` is terminal on purpose. A cover is cosmetic — a book without
 * one is still perfectly readable — so a source the renderer cannot
 * open must not be re-offered to every converter that polls, forever.
 * Clearing the state by hand is how a fixed renderer gets a second go.
 */
export const COVER_STATES = ['pending', 'rendering', 'ready', 'failed'] as const

export type CoverState = (typeof COVER_STATES)[number]

export function isCoverState(value: unknown): value is CoverState {
  return typeof value === 'string' && COVER_STATES.includes(value as CoverState)
}

/**
 * Which artifact page one is taken from, best first.
 *
 * The PDF leads because for most of this library it is the scan itself,
 * so its first page is the real cover of the real book. An EPUB carries
 * its own cover image and is next. The DOCX master is last and is the
 * unhappy case: it has no cover of its own, so what comes back is the
 * first page of the typeset text — which is still more use on a shelf
 * than nothing.
 */
export const COVER_SOURCE_FORMATS = ['pdf', 'epub', 'docx'] as const

/** The artifact to render this book's cover from, or null if it has none yet. */
export function coverSourceFormat(formats: readonly unknown[]): ArtifactFormat | null {
  for (const format of COVER_SOURCE_FORMATS) {
    if (formats.includes(format)) return format
  }
  return null
}

/**
 * Where a generated cover lives.
 *
 * Under the book's own prefix, like every other artifact, so the
 * containment rule in `domain/conversion.ts` covers it unchanged.
 *
 * JPEG rather than PNG: this is a photograph of a page, and a lossless
 * encoding of a scan is several times the size for no visible gain on a
 * tile 150px wide.
 */
export function coverKey(bookId: string | number): string {
  return `${artifactPrefix(bookId)}cover.jpg`
}

/**
 * The cover key a converter reported, or null if it is not usable.
 *
 * The same containment boundary `acceptArtifacts` enforces, for the
 * same reason: a key naming another book's prefix would let a
 * compromised converter point one book's cover at another book's files.
 * Kept as its own function because a cover is not an artifact — it is
 * not a format, not downloadable, and not something a reader is ever
 * charged for.
 */
export function acceptCoverKey({
  bookId,
  key,
}: {
  bookId: string | number
  key: unknown
}): string | null {
  if (typeof key !== 'string') return null
  if (!key.startsWith(artifactPrefix(bookId))) return null
  // `books/3/../4/x` starts with the right prefix and resolves
  // elsewhere entirely.
  if (key.includes('..')) return null
  return key
}

export interface CoverCandidate {
  state: unknown
  /** Whether an editor has uploaded a cover of their own. */
  hasUploadedCover: boolean
  /** The formats this book already has. */
  formats: readonly unknown[]
}

/**
 * Is there a cover to render for this book, and something to render it
 * from?
 *
 * An uploaded cover stops it. Not because the generated one would be
 * shown — it would not, the upload always wins — but because rendering
 * a page nobody will look at is a conversion slot spent on nothing.
 *
 * A missing state reads as `pending`, so every book that existed before
 * this feature is eligible without a backfill.
 */
export function needsCover(candidate: CoverCandidate): boolean {
  if (candidate.hasUploadedCover) return false
  const state = isCoverState(candidate.state) ? candidate.state : 'pending'
  if (state !== 'pending') return false
  return coverSourceFormat(candidate.formats) !== null
}

/**
 * Which cover a page should show, given both.
 *
 * The order is the whole policy: a chosen cover, then page one, then
 * neither — at which point the caller draws the book's own first
 * character on the tile face, which is what a NobleSee book looks like
 * when there is no picture of it.
 */
export function coverImageUrl({
  uploadedUrl,
  bookId,
  generated,
}: {
  uploadedUrl?: string | null
  bookId: string | number
  generated: { state?: unknown; key?: unknown }
}): string | null {
  if (uploadedUrl) return uploadedUrl
  if (generated.state === 'ready' && typeof generated.key === 'string' && generated.key) {
    return `/covers/${bookId}`
  }
  return null
}

/** Formats a cover may be rendered from, as a set the route can test against. */
export function isCoverSourceFormat(format: unknown): format is ArtifactFormat {
  return (
    ARTIFACT_FORMATS.includes(format as ArtifactFormat) &&
    COVER_SOURCE_FORMATS.includes(format as (typeof COVER_SOURCE_FORMATS)[number])
  )
}
