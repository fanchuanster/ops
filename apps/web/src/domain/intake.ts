import type { SourceKind } from './publication'

export const SOURCE_TAIL_BYTES = 64 * 1024 + 64

const PDF_TAIL_BYTES = 2048

const ZIP_END_OF_CENTRAL_DIRECTORY = 'PK'

export const TRUNCATED_SOURCE_ERROR =
  'Only part of that file arrived — it ends part-way through. If it was still being written or copied when you chose it, wait for that to finish and upload it again.'

export function looksTruncated(kind: SourceKind, tail: string): boolean {
  if (kind === 'pdf') return !tail.slice(-PDF_TAIL_BYTES).includes('%%EOF')
  if (kind === 'docx' || kind === 'epub') return !tail.includes(ZIP_END_OF_CENTRAL_DIRECTORY)
  return false
}
