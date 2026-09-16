import type { ArtifactFormat } from './conversion'

export const COVER_STATES = ['pending', 'rendering', 'ready', 'failed'] as const

export type CoverState = (typeof COVER_STATES)[number]

export function isCoverState(value: unknown): value is CoverState {
  return typeof value === 'string' && COVER_STATES.includes(value as CoverState)
}

export const COVER_SOURCE_FORMATS = ['pdf', 'epub'] as const

export function coverSourceFormat(formats: readonly unknown[]): ArtifactFormat | null {
  for (const format of COVER_SOURCE_FORMATS) {
    if (formats.includes(format)) return format
  }
  return null
}

export { coverCandidateKey, coverKey } from './bookStorage'

export const COVER_CANDIDATE_PAGES = 3

export const COVER_IMAGE_MAX_WIDTH = 800
export const COVER_IMAGE_MAX_HEIGHT = 1200
export const COVER_JPEG_QUALITY = 0.82

export const COVER_CANDIDATE_MAX_BYTES = 2 * 1024 * 1024

export function coverCandidateCount(generated: { candidates?: unknown }): number {
  const count = Number(generated.candidates)
  if (!Number.isInteger(count) || count < 1) return 1
  return Math.min(count, COVER_CANDIDATE_PAGES)
}

export function chosenCoverPage(generated: { page?: unknown; candidates?: unknown }): number {
  const page = Number(generated.page)
  if (!Number.isInteger(page) || page < 1) return 1
  return Math.min(page, coverCandidateCount(generated))
}

export function hasRenderedPages(generated: { state?: unknown }): boolean {
  return generated.state === 'ready'
}

export function coverCandidatePages(generated: { candidates?: unknown }): number[] {
  return Array.from({ length: coverCandidateCount(generated) }, (_, index) => index + 1)
}

export function coverPageUrl(bookId: string | number, page: number): string {
  return page <= 1 ? `/covers/${bookId}` : `/covers/${bookId}?page=${page}`
}

export function coverUploadUrl(bookId: string | number, mediaId: string | number): string {
  return `/covers/${bookId}?v=${mediaId}`
}

export function coverImageUrl({
  uploadedId,
  bookId,
  generated,
}: {
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

export function uploadedCoverId(cover: unknown): number | null {
  if (typeof cover === 'number') return cover
  if (typeof cover === 'object' && cover !== null) {
    const id = (cover as { id?: unknown }).id
    if (typeof id === 'number') return id
  }
  return null
}

export const COVER_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

export const COVER_MAX_BYTES = 8 * 1024 * 1024

export type CoverUploadProblem = 'empty' | 'wrong_type' | 'too_large'

export type CoverUploadCheck =
  | { ok: true }
  | { ok: false; problem: CoverUploadProblem }

export function checkCoverUpload(file: { size: number; type: string }): CoverUploadCheck {
  if (file.size === 0) return { ok: false, problem: 'empty' }
  if (!COVER_MIME_TYPES.includes(file.type as (typeof COVER_MIME_TYPES)[number])) {
    return { ok: false, problem: 'wrong_type' }
  }
  if (file.size > COVER_MAX_BYTES) return { ok: false, problem: 'too_large' }
  return { ok: true }
}

export function coverAltFor(title: string): string {
  const name = title.trim()
  return name === '' ? 'Book cover' : `Cover of ${name}`
}
