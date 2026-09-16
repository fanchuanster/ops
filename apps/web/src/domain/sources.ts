import type { ArtifactFormat } from './conversion'
import { type SourceKind, originalArtifact, readSourceKind } from './publication'

export interface BookSource {
  kind: SourceKind
  storageKey: string
  filename: string
  bytes?: number | null
  addedAt?: string | null
}

interface ConversionLike {
  sources?: unknown
  sourceKind?: unknown
  sourceKey?: unknown
  sourceFilename?: unknown
}

function isKind(value: unknown): value is SourceKind {
  return value === 'pdf' || value === 'docx' || value === 'epub' || value === 'text'
}

function readEntry(value: unknown): BookSource | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (!isKind(row.kind)) return null
  if (typeof row.storageKey !== 'string' || row.storageKey.length === 0) return null
  return {
    kind: row.kind,
    storageKey: row.storageKey,
    filename: typeof row.filename === 'string' ? row.filename : '',
    bytes: typeof row.bytes === 'number' ? row.bytes : null,
    addedAt: typeof row.addedAt === 'string' ? row.addedAt : null,
  }
}

interface ArtifactLike {
  format?: string | null
  storageKey?: string | null
  bytes?: number | null
}

export function readSources(
  conversion: ConversionLike | null | undefined,
  artifacts?: readonly ArtifactLike[] | null,
): BookSource[] {
  const stored = Array.isArray(conversion?.sources)
    ? conversion.sources.map(readEntry).filter((entry): entry is BookSource => entry !== null)
    : []

  const seen = new Set<SourceKind>()
  const sources = stored.filter((entry) => {
    if (seen.has(entry.kind)) return false
    seen.add(entry.kind)
    return true
  })

  if (sources.length === 0) {
    const storageKey = typeof conversion?.sourceKey === 'string' ? conversion.sourceKey : ''
    if (!storageKey) return []
    sources.push({
      kind: readSourceKind(conversion ?? {}),
      storageKey,
      filename:
        typeof conversion?.sourceFilename === 'string' ? conversion.sourceFilename : '',
      bytes: null,
      addedAt: null,
    })
  }

  if (!artifacts) return sources
  return sources.map((source) => {
    const slot = originalArtifact(source.kind)
    const filed = artifacts.find(
      (artifact) =>
        artifact?.format === slot &&
        typeof artifact.storageKey === 'string' &&
        artifact.storageKey.length > 0,
    )
    if (!filed) return source
    return {
      ...source,
      storageKey: filed.storageKey as string,
      bytes: source.bytes ?? filed.bytes ?? null,
    }
  })
}

export function canMasterFrom(kind: SourceKind): boolean {
  return kind !== 'epub'
}

export function masterSources(sources: readonly BookSource[]): BookSource[] {
  return sources.filter((source) => canMasterFrom(source.kind))
}

export function offersMasterChoice(sources: readonly BookSource[]): boolean {
  return masterSources(sources).length > 1
}

export function selectedSource(
  conversion: ConversionLike | null | undefined,
): BookSource | null {
  const kind = readSourceKind(conversion ?? {})
  return readSources(conversion).find((source) => source.kind === kind) ?? null
}

export function hasSourceKind(
  sources: readonly BookSource[],
  kind: SourceKind,
): boolean {
  return sources.some((source) => source.kind === kind)
}

export type AddSourceRefusal = 'unsupported' | 'slot_taken' | 'master_exists'

export type AddSourceDecision =
  | { allowed: true; slot: ArtifactFormat }
  | { allowed: false; reason: AddSourceRefusal }

export function canAddSource({
  kind,
  existingFormats,
}: {
  kind: SourceKind
  existingFormats: readonly unknown[]
}): AddSourceDecision {
  const slot = originalArtifact(kind)
  if (!slot) return { allowed: false, reason: 'unsupported' }
  if (existingFormats.includes(slot)) {
    return { allowed: false, reason: slot === 'docx' ? 'master_exists' : 'slot_taken' }
  }
  return { allowed: true, slot }
}

export const ADD_SOURCE_ERRORS: Record<AddSourceRefusal, string> = {
  unsupported: 'Add a PDF, a DOCX, an EPUB, or a plain text file.',
  slot_taken:
    'This book already has a file of that type. A different scan or edition is a book of its own — upload it as one.',
  master_exists:
    'This book already has a DOCX master. Use “Replace and rebuild” below to put a corrected Word file in its place.',
}

export function switchedToSource(source: BookSource): {
  sourceKind: SourceKind
  sourceKey: string
  sourceFilename: string
  sourceHash: null
} {
  return {
    sourceKind: source.kind,
    sourceKey: source.storageKey,
    sourceFilename: source.filename,
    sourceHash: null,
  }
}
