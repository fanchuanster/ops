export const ARTIFACT_FORMATS = ['docx', 'epub', 'pdf', 'txt'] as const

export type ArtifactFormat = (typeof ARTIFACT_FORMATS)[number]

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
