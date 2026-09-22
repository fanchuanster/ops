import type { ArtifactFormat } from './conversion'
import { type BookId, artifactKey } from './bookStorage'

export type SourceKind = 'pdf' | 'docx' | 'epub' | 'text'

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

export const MAX_UPLOAD_LABEL = `${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`

const BY_MIME: Record<string, SourceKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/epub+zip': 'epub',
  'text/plain': 'text',
  'text/markdown': 'text',
}

const BY_EXTENSION: Record<string, SourceKind> = {
  pdf: 'pdf',
  docx: 'docx',
  epub: 'epub',
  txt: 'text',
  md: 'text',
}

export function sourceKindOf(filename: string, mimeType?: string | null): SourceKind | null {
  if (mimeType) {
    const byMime = BY_MIME[mimeType]
    if (byMime) return byMime
  }
  const extension = filename.trim().toLowerCase().split('.').pop() ?? ''
  return BY_EXTENSION[extension] ?? null
}

export type PublicationPlan = 'convert' | 'as_is'

export function plansFor(kind: SourceKind): PublicationPlan[] {
  switch (kind) {
    case 'pdf':
    case 'text':
      return ['as_is', 'convert']
    case 'epub':
      return ['as_is']
    default:
      return ['convert']
  }
}

export function defaultPlanFor(kind: SourceKind): PublicationPlan {
  return plansFor(kind)[0]!
}

export function planIsAvailable(kind: SourceKind, plan: unknown): plan is PublicationPlan {
  return plansFor(kind).includes(plan as PublicationPlan)
}

export function resolvePlan(kind: SourceKind, requested: unknown): PublicationPlan {
  return planIsAvailable(kind, requested) ? requested : defaultPlanFor(kind)
}

export const AI_PLAN_CHOICE = 'convert_ai'

export interface PlanChoice {
  plan: PublicationPlan
  aiCorrection: boolean
}

export function readPlanChoice(kind: SourceKind, requested: unknown): PlanChoice {
  if (requested === AI_PLAN_CHOICE && planIsAvailable(kind, 'convert')) {
    return { plan: 'convert', aiCorrection: true }
  }
  return { plan: resolvePlan(kind, requested), aiCorrection: false }
}

export function originalArtifact(kind: SourceKind): ArtifactFormat | null {
  switch (kind) {
    case 'pdf':
      return 'pdf'
    case 'docx':
      return 'docx'
    case 'epub':
      return 'epub'
    case 'text':
      return 'txt'
    default:
      return null
  }
}

const ORIGINAL_FORMAT = { pdf: 'pdf', docx: 'docx', epub: 'epub', text: 'txt' } as const

export function originalKey(bookId: BookId, kind: SourceKind): string {
  return artifactKey(bookId, ORIGINAL_FORMAT[kind])
}

export function formatsToGenerate(kind: SourceKind): ArtifactFormat[] {
  return kind === 'epub' ? [] : ['epub']
}

export function canBuildMaster(kind: SourceKind): boolean {
  return kind === 'pdf' || kind === 'text'
}

export function canBuildEpub(kind: SourceKind): boolean {
  return formatsToGenerate(kind).includes('epub')
}

export function needsExport(kind: SourceKind, plan: PublicationPlan): boolean {
  return kind === 'pdf' && plan === 'convert'
}

export function needsConverter(kind: SourceKind, plan: PublicationPlan): boolean {
  return plan === 'convert' && formatsToGenerate(kind).length > 0
}

export function reopensForConversion(
  kind: SourceKind,
  previous: PublicationPlan,
  next: PublicationPlan,
): boolean {
  return previous === 'as_is' && needsConverter(kind, next)
}

export function readSourceKind(conversion: {
  sourceKind?: unknown
  sourceFilename?: unknown
}): SourceKind {
  const stored = conversion.sourceKind
  if (stored === 'pdf' || stored === 'docx' || stored === 'epub' || stored === 'text') {
    return stored
  }
  const filename = typeof conversion.sourceFilename === 'string' ? conversion.sourceFilename : ''
  return sourceKindOf(filename) ?? 'pdf'
}

export function readingFormat(formats: readonly string[]): 'epub' | 'pdf' | 'txt' | null {
  if (formats.includes('epub')) return 'epub'
  if (formats.includes('pdf')) return 'pdf'
  if (formats.includes('txt')) return 'txt'
  return null
}

export function isReadingFormat(value: unknown): value is 'epub' | 'pdf' | 'txt' {
  return value === 'epub' || value === 'pdf' || value === 'txt'
}

export function requestedReadingFormat(
  formats: readonly string[],
  wanted: unknown,
): 'epub' | 'pdf' | 'txt' | null {
  if (isReadingFormat(wanted) && formats.includes(wanted)) return wanted
  return readingFormat(formats)
}
