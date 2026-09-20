export const ARTIFACT_FORMATS = ['docx', 'epub', 'pdf', 'txt'] as const

export type ArtifactFormat = (typeof ARTIFACT_FORMATS)[number]

export const FORMAT_DISPLAY_ORDER = ['pdf', 'txt', 'docx', 'epub'] as const

export function byDisplayOrder(a: { format: string }, b: { format: string }): number {
  return displayRank(a.format) - displayRank(b.format)
}

function displayRank(format: string): number {
  const place = (FORMAT_DISPLAY_ORDER as readonly string[]).indexOf(format)
  return place === -1 ? FORMAT_DISPLAY_ORDER.length : place
}

export interface AcceptedArtifact {
  format: ArtifactFormat
  storageKey: string
  downloadable: boolean
}

export function acceptPageCount(value: unknown): number | null {
  const pages = Number(value)
  if (!Number.isFinite(pages) || pages <= 0) return null
  if (pages > 100_000) return null
  return Math.round(pages)
}
