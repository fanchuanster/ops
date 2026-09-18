import type { ArtifactFormat } from './conversion'

const PREFIX = 'books/'

export const MEDIA_PREFIX = 'covers'

export type BookId = string | number

const ARTIFACT_NAME: Record<ArtifactFormat, string> = {
  docx: 'master.docx',
  epub: 'book.epub',
  pdf: 'book.pdf',
  txt: 'book.txt',
}

export function bookFolder(bookId: BookId): string {
  return `${PREFIX}${bookId}/`
}

export function artifactKey(bookId: BookId, format: ArtifactFormat): string {
  return `${bookFolder(bookId)}${ARTIFACT_NAME[format]}`
}

export function suggestionsKey(bookId: BookId): string {
  return `${bookFolder(bookId)}suggestions.json`
}

export function decisionsKey(bookId: BookId): string {
  return `${bookFolder(bookId)}decisions.json`
}

export function coverKey(bookId: BookId, page: number = 1): string {
  return coverCandidateKey(`${bookFolder(bookId)}cover.jpg`, page)
}

export function coverCandidateKey(baseKey: string, page: number): string {
  return page <= 1 ? baseKey : numbered(baseKey, page - 1)
}

export function numbered(key: string, attempt: number): string {
  if (attempt <= 0) return key
  const slash = key.lastIndexOf('/')
  const dot = key.lastIndexOf('.')
  const tag = `-${attempt + 1}`
  return dot > slash && dot > 0
    ? `${key.slice(0, dot)}${tag}${key.slice(dot)}`
    : `${key}${tag}`
}
