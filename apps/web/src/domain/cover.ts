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
 *   `generatedCover`  a page of the book, rendered in the browser that
 *                     had the file open. A default, and only ever a
 *                     default.
 *
 * The generated one is page one *by default*, not by definition. The
 * first few pages are rendered (`COVER_CANDIDATE_PAGES`) and the book
 * records which of them it wears, because the page a publisher
 * printed the cover on is frequently not the first leaf a scanner fed:
 * a blank verso, a library stamp or a half-title comes first often
 * enough that the choice is worth offering. Page one remains what a
 * book wears until somebody says otherwise.
 *
 * Separate fields rather than one, because a generated cover must never
 * overwrite a chosen one, and an editor who deletes their upload should
 * fall back to the page rather than to nothing.
 *
 * **Rendered in the browser, not by the converter.** It was job kind
 * three on the converter until 2026-08-25, which was an accident of
 * where the renderer happened to be written — and it cost the library
 * every cover it had, because a converter claimed each book and never
 * reported back. Rasterizing page one has nothing to do with converting
 * a book, so it happens on the machine that already has the file open:
 * the uploader's browser at upload time, an editor's for a book already
 * in the library (`lib/client/coverImages.ts`).
 *
 * Framework-independent, like everything in `src/domain`.
 */

import { type ArtifactFormat, artifactPrefix } from './conversion'

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
 * Which artifact the opening pages are taken from, best first.
 *
 * The PDF leads because for most of this library it is the scan itself,
 * so its first page is the real cover of the real book. An EPUB carries
 * its own cover image and is next.
 *
 * The DOCX master was last, and was dropped when rendering moved into
 * the browser on 2026-08-25: there is no DOCX renderer there, and what
 * it produced was the first page of the typeset text — the unhappy case
 * even when it worked. A book whose only artifact is a master waits for
 * its PDF, which phase 2 builds anyway.
 */
export const COVER_SOURCE_FORMATS = ['pdf', 'epub'] as const

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
export function coverKey(bookId: string | number, page: number = 1): string {
  const prefix = artifactPrefix(bookId)
  // Page one keeps the unsuffixed name it has always had, so every
  // cover rendered before candidates existed is still at the key its
  // book records. The alternatives are new names and can be anything.
  return page <= 1 ? `${prefix}cover.jpg` : `${prefix}cover-${page}.jpg`
}

/**
 * How many opening pages are offered to choose between.
 *
 * Three, and the number is a judgement rather than a constant with a
 * reason behind it: a scan's cover is page one often enough to be the
 * default, and when it is not, what a reader wants is almost always the
 * title page a leaf or two in — behind a blank verso, a library stamp,
 * or a half-title. Past three it stops being "which of these is the
 * cover" and becomes browsing the book, which the reader already does.
 *
 * Each candidate is one rasterize and a few tens of kilobytes, so the
 * cost of offering them is nothing next to the conversion that
 * preceded it.
 */
export const COVER_CANDIDATE_PAGES = 3

/**
 * The box a rendered page is fitted into, and how hard it is squeezed.
 *
 * Wide enough for the largest slot a cover is drawn in — the book
 * page's own header — at 2x. Bigger costs bytes on every catalog page
 * for detail nothing renders. The quality is high enough that a page of
 * type stays crisp and low enough that a cover is tens of kilobytes.
 *
 * Here rather than in the renderer because the renderer is now the
 * reader's own browser (`lib/client/coverImages.ts`), and a constant
 * living there would be a constant nothing on the server could check.
 */
export const COVER_IMAGE_MAX_WIDTH = 800
export const COVER_IMAGE_MAX_HEIGHT = 1200
export const COVER_JPEG_QUALITY = 0.82

/**
 * The biggest a single rendered candidate may be.
 *
 * Far smaller than `COVER_MAX_BYTES`, which is the ceiling on a picture
 * an editor *chose*. These are produced by our own code to a known box,
 * so anything approaching a megabyte means something other than a page
 * of a book is being posted.
 */
export const COVER_CANDIDATE_MAX_BYTES = 2 * 1024 * 1024

/**
 * How many candidates this book actually has.
 *
 * One unless the converter said otherwise — which is the answer for
 * every book whose cover was rendered before candidates existed, and
 * for every EPUB, which has one declared cover image and no pages to
 * rasterize.
 */
export function coverCandidateCount(generated: { candidates?: unknown }): number {
  const count = Number(generated.candidates)
  if (!Number.isInteger(count) || count < 1) return 1
  return Math.min(count, COVER_CANDIDATE_PAGES)
}

/**
 * Which page this book wears, clamped to what exists.
 *
 * Clamped rather than trusted, because the count can shrink under a
 * stored choice: a re-rendered book whose source now yields fewer pages
 * would otherwise point at a candidate that is no longer there, and a
 * cover that 404s is worse than the first page.
 */
export function chosenCoverPage(generated: { page?: unknown; candidates?: unknown }): number {
  const page = Number(generated.page)
  if (!Number.isInteger(page) || page < 1) return 1
  return Math.min(page, coverCandidateCount(generated))
}

/**
 * Whether this book's opening pages have actually been rasterized.
 *
 * The question behind "is there anything to make?", and the reason
 * making a cover is offered once rather than repeatedly: rasterizing
 * the same first pages of the same file is deterministic, so a second
 * run produces the images that are already sitting in the bucket. A
 * render that *failed* or never happened leaves the state at something
 * other than `ready`, which is the case worth offering.
 */
export function hasRenderedPages(generated: { state?: unknown }): boolean {
  return generated.state === 'ready'
}

/** The pages an editor may choose between, for a picker to render. */
export function coverCandidatePages(generated: { candidates?: unknown }): number[] {
  return Array.from({ length: coverCandidateCount(generated) }, (_, index) => index + 1)
}

/**
 * The URL one particular candidate is served from.
 *
 * Page one is the bare address and the rest carry `?page=`, which is
 * not only tidiness: covers are cached for an hour under a URL with no
 * digest in it, so a choice that did not change the address would leave
 * the old page on screen until the cache let go of it.
 */
export function coverPageUrl(bookId: string | number, page: number): string {
  return page <= 1 ? `/covers/${bookId}` : `/covers/${bookId}?page=${page}`
}

/**
 * The URL an uploaded cover is served from.
 *
 * The book's own address, not the Media document's. Until 2026-08-25
 * this returned `media.url` — a public file under
 * `/api/media/file/<filename>`, served straight from the bucket with no
 * question asked about who was looking. For a book in the library that
 * is harmless. For a private upload it is a hole: the filename is
 * whatever the uploader's file was called, `cover.jpg` as often as not,
 * and the picture is usually the title page. `/covers/<id>` already
 * asks the Books access rule before it streams a rendered page, so
 * routing the uploaded image through the same door makes both covers
 * equally private and leaves one place where that is decided.
 *
 * `?v=` is the media id, and it is what makes an hour-long cache safe.
 * The address is otherwise the same for every version of a book's
 * cover; each upload creates a new Media document, so the id changes
 * exactly when the picture does — the same trick `?page=` plays for the
 * rendered candidates.
 */
export function coverUploadUrl(bookId: string | number, mediaId: string | number): string {
  return `/covers/${bookId}?v=${mediaId}`
}

/**
 * Which cover a page should show, given both.
 *
 * The order is the whole policy: an uploaded cover, then the chosen
 * page of the book, then neither — at which point the caller draws the
 * book's own first character on the tile face, which is what a NobleSee
 * book looks like when there is no picture of it.
 */
export function coverImageUrl({
  uploadedId,
  bookId,
  generated,
}: {
  /** The Media document's id, when a cover image has been uploaded. */
  uploadedId?: string | number | null
  bookId: string | number
  generated: { state?: unknown; key?: unknown; page?: unknown; candidates?: unknown }
}): string | null {
  if (uploadedId !== null && uploadedId !== undefined && uploadedId !== '') {
    return coverUploadUrl(bookId, uploadedId)
  }
  if (generated.state === 'ready' && typeof generated.key === 'string' && generated.key) {
    return coverPageUrl(bookId, chosenCoverPage(generated))
  }
  return null
}

/**
 * The id out of whatever a `cover` relationship came back as.
 *
 * A populated document, a bare id, or nothing — the three shapes a
 * Payload upload field takes depending on the `depth` it was read at.
 * Callers want the id in all three cases and should not each write this
 * out.
 */
export function uploadedCoverId(cover: unknown): number | null {
  if (typeof cover === 'number') return cover
  if (typeof cover === 'object' && cover !== null) {
    const id = (cover as { id?: unknown }).id
    if (typeof id === 'number') return id
  }
  return null
}

/* --- An editor's own cover ------------------------------------------ */

/**
 * Image types a cover may be.
 *
 * An allowlist rather than `image/*`, and the reason is not tidiness:
 * `image/svg+xml` is an image by every definition and is also a script
 * container. A cover is served from this site's own origin, so an
 * uploaded SVG is stored cross-site scripting with a `<script>` in it —
 * the browser executes it against noblesee.com. No raster format can do
 * that.
 *
 * The four here are what a scanner, a phone or a design tool actually
 * produces. AVIF is deliberately absent: it buys nothing over WebP for
 * an image this size, and every format accepted is a decoder exposed.
 */
export const COVER_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

/**
 * 8 MB, which is generous for a picture shown 150px wide and nowhere
 * near the ceiling that decides it.
 *
 * That ceiling is Worker memory. A cover arrives through a server
 * action, which parses the whole request into memory before any of our
 * code runs — the same property that pushed book uploads onto a
 * streaming route handler (`api/upload/route.ts`) and raised their
 * limit to 100 MB. A cover is small enough that the streaming shape
 * would be complexity bought for nothing, so the limit stays low
 * enough that buffering one is never the problem.
 */
export const COVER_MAX_BYTES = 8 * 1024 * 1024

export type CoverUploadProblem = 'empty' | 'wrong_type' | 'too_large'

export type CoverUploadCheck =
  | { ok: true }
  | { ok: false; problem: CoverUploadProblem }

/** Whether a file an editor chose may become a book's cover. */
export function checkCoverUpload(file: { size: number; type: string }): CoverUploadCheck {
  if (file.size === 0) return { ok: false, problem: 'empty' }
  if (!COVER_MIME_TYPES.includes(file.type as (typeof COVER_MIME_TYPES)[number])) {
    return { ok: false, problem: 'wrong_type' }
  }
  if (file.size > COVER_MAX_BYTES) return { ok: false, problem: 'too_large' }
  return { ok: true }
}

/**
 * The alt text a cover gets, derived rather than asked for.
 *
 * Media requires `alt`, and a book cover's alt is a formula — every
 * honest answer is "the cover of «title»". Putting a box on the form
 * for it collects "cover", typed by an editor who has already made the
 * one decision that mattered.
 *
 * Where the cover is genuinely decorative — the tile, where the title
 * is printed right beside it — `BookTile` renders `alt=""` and this is
 * never read. It is here for the places that show the cover alone.
 */
export function coverAltFor(title: string): string {
  const name = title.trim()
  return name === '' ? 'Book cover' : `Cover of ${name}`
}
