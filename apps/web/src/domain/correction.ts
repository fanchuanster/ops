export const CORRECTION_STATES = [
  'none',
  'pending',
  'running',
  'ready',
  'decided',
  'applying',
  'applied',
  'failed',
] as const

export type CorrectionState = (typeof CORRECTION_STATES)[number]

export type CorrectionJobKind = 'correct' | 'apply'

export function isCorrectionState(value: unknown): value is CorrectionState {
  return typeof value === 'string' && CORRECTION_STATES.includes(value as CorrectionState)
}

export function readCorrectionState(value: unknown): CorrectionState {
  return isCorrectionState(value) ? value : 'none'
}

export function correctionStateForMaster(aiCorrection: unknown): CorrectionState {
  return aiCorrection === true ? 'pending' : 'none'
}

export function correctionClaimableAs(state: CorrectionState): CorrectionJobKind | null {
  if (state === 'pending') return 'correct'
  if (state === 'decided') return 'apply'
  return null
}

export function correctionInProgressState(kind: CorrectionJobKind): CorrectionState {
  return kind === 'correct' ? 'running' : 'applying'
}

export function correctionCompletedState(kind: CorrectionJobKind): CorrectionState {
  return kind === 'correct' ? 'ready' : 'applied'
}

export function awaitingDecision(state: CorrectionState): boolean {
  return state === 'ready'
}

export function correctionInFlight(state: CorrectionState): boolean {
  return state === 'running' || state === 'decided' || state === 'applying'
}

export function canRequestCorrection({
  aiCorrection,
  hasMaster,
  state,
}: {
  aiCorrection: unknown
  hasMaster: boolean
  state: CorrectionState
}): boolean {
  if (aiCorrection !== true || !hasMaster) return false
  return state === 'none' || state === 'pending' || state === 'failed' || state === 'applied'
}

export type { Suggestion } from './document'

import type { Suggestion } from './document'

export interface Decision extends Suggestion {
  approved: boolean
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function readSuggestions(payload: unknown): Suggestion[] {
  const list = (payload as { suggestions?: unknown })?.suggestions
  if (!Array.isArray(list)) return []

  const out: Suggestion[] = []
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as Record<string, unknown>
    if (!isIndex(item.block) || !isIndex(item.line)) continue
    if (typeof item.original !== 'string' || typeof item.suggested !== 'string') continue
    if (item.original === item.suggested) continue
    out.push({
      block: item.block,
      line: item.line,
      original: item.original,
      suggested: item.suggested,
      reason: typeof item.reason === 'string' ? item.reason : '',
      confidence: typeof item.confidence === 'number' ? item.confidence : 0,
      category: typeof item.category === 'string' ? item.category : 'unknown',
    })
  }
  return out
}

export function readDecisions(payload: unknown): Suggestion[] {
  const list = (payload as { suggestions?: unknown })?.suggestions
  if (!Array.isArray(list)) return []

  return readSuggestions(payload).map((suggestion) => {
    const raw = (list as Array<Record<string, unknown>>).find(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        item.block === suggestion.block &&
        item.line === suggestion.line,
    )
    const approved = raw?.approved
    return { ...suggestion, approved: typeof approved === 'boolean' ? approved : null }
  })
}

export function acceptDecisions({
  offered,
  approved,
}: {
  offered: readonly Suggestion[]
  approved: readonly string[]
}): Decision[] {
  const wanted = new Set(approved)
  return offered.map((suggestion) => ({
    ...suggestion,
    approved: wanted.has(suggestionId(suggestion)),
  }))
}

export function suggestionId(suggestion: Pick<Suggestion, 'block' | 'line'>): string {
  return `${suggestion.block}:${suggestion.line}`
}

export function anyAdopted(decisions: readonly Decision[]): boolean {
  return decisions.some((decision) => decision.approved)
}
