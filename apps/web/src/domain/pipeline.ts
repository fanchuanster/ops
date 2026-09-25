import type { ArtifactFormat } from './conversion'
import {
  type PublicationPlan,
  type SourceKind,
  formatsToGenerate,
  needsConverter,
  readingFormat,
} from './publication'

export const CONVERSION_STATES = [
  'none',
  'draft',
  'queued',
  'ocr',
  'ocr_ready',
  'mastering',
  'master_ready',
  'formatting',
  'ready',
  'failed',
] as const

export type ConversionState = (typeof CONVERSION_STATES)[number]

export type JobKind = 'master' | 'formats'

export const BUILD_GOALS = ['master', 'editions'] as const

export type BuildGoal = (typeof BUILD_GOALS)[number]

export function stateAfterMaster(goal: unknown): ConversionState {
  return goal === 'master' ? 'ready' : 'master_ready'
}

export function isConversionState(value: unknown): value is ConversionState {
  return typeof value === 'string' && CONVERSION_STATES.includes(value as ConversionState)
}

export function claimableAs(state: ConversionState): JobKind | null {
  if (state === 'ocr_ready') return 'master'
  if (state === 'master_ready') return 'formats'
  return null
}

export function formatsToBuild({
  sourceKind,
  existingFormats,
}: {
  sourceKind: SourceKind
  existingFormats: readonly unknown[]
}): ArtifactFormat[] {
  const possible = formatsToGenerate(sourceKind)
  const existing = existingFormats.filter((format): format is ArtifactFormat =>
    possible.includes(format as ArtifactFormat),
  )
  return [...new Set([...possible, ...existing])]
}

export interface ClaimCandidate {
  state: ConversionState
  sourceKind: SourceKind
  existingFormats: readonly unknown[]
}

export interface ClaimedWork {
  kind: JobKind
  formats: ArtifactFormat[]
}

export function claimFor(candidate: ClaimCandidate): ClaimedWork | null {
  const kind = claimableAs(candidate.state)
  if (!kind) return null
  if (kind === 'master') return { kind, formats: [] }

  const formats = formatsToBuild({
    sourceKind: candidate.sourceKind,
    existingFormats: candidate.existingFormats,
  })
  if (formats.length === 0) return null
  return { kind, formats }
}

export function inProgressState(kind: JobKind): ConversionState {
  return kind === 'master' ? 'mastering' : 'formatting'
}

export function completedState(kind: JobKind): ConversionState {
  return kind === 'master' ? 'master_ready' : 'ready'
}

export function stateWithoutExport(kind: SourceKind, plan: PublicationPlan): ConversionState {
  if (!needsConverter(kind, plan)) return 'ready'
  return kind === 'text' ? 'ocr_ready' : 'master_ready'
}

export function statusOnQueue(
  existingFormats: readonly string[],
): 'in_production' | 'published' {
  return readingFormat(existingFormats) === null ? 'in_production' : 'published'
}

export function hasMaster(state: ConversionState): boolean {
  return state === 'master_ready' || state === 'formatting' || state === 'ready'
}

export function stateAfterMasterEdit(state: ConversionState): ConversionState | null {
  return hasMaster(state) ? 'master_ready' : null
}

export function countsAgainstQuota(state: ConversionState): boolean {
  return state !== 'none' && state !== 'draft'
}

export const QUOTA_COUNTED_STATES: ConversionState[] = CONVERSION_STATES.filter(countsAgainstQuota)

export function retryStateFor({ hasMasterArtifact }: { hasMasterArtifact: boolean }): ConversionState {
  return hasMasterArtifact ? 'master_ready' : 'queued'
}

export function recoversFromFailure({
  state,
  sourceKind,
  plan,
}: {
  state: ConversionState
  sourceKind: SourceKind
  plan: PublicationPlan
}): boolean {
  return state === 'failed' && !needsConverter(sourceKind, plan)
}

export function isInFlight(state: ConversionState): boolean {
  return (
    state === 'queued' ||
    state === 'ocr' ||
    state === 'ocr_ready' ||
    state === 'mastering' ||
    state === 'formatting'
  )
}

export const IN_FLIGHT_STATES: ConversionState[] = CONVERSION_STATES.filter(isInFlight)

export function needsMasterRun({
  state,
  exportJob,
}: {
  state: ConversionState
  exportJob?: string | null
}): boolean {
  if (state !== 'queued') return false
  return !exportJob
}

export function releasedExportHandle(state: ConversionState): {
  exportJob?: null
  exportAsset?: null
  exportStartedAt?: null
  exportRetries?: number
} {
  if (state !== 'queued') return {}
  return { exportJob: null, exportAsset: null, exportStartedAt: null, exportRetries: 0 }
}

export const UPLOAD_STEPS = ['Upload', 'Process', 'Submit'] as const

export function uploadStep({ reviewState }: { reviewState?: string | null }): number {
  if (reviewState === 'approved') return UPLOAD_STEPS.length
  if (reviewState === 'submitted') return 2
  return 1
}
