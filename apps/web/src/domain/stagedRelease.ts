/**
 * Staged release: a per-reader clock, not a global publication date.
 *
 * Each reader's access to part N+1 opens a fixed delay after *they*
 * reached part N — so someone who discovers a book a year late gets the
 * same paced experience as an early reader, rather than everything at
 * once. That is the point: staged release is a reading rhythm, not a
 * scarcity tactic (MODERNIZATION.md — no dark patterns).
 *
 * Part 1 is always open. Otherwise the previous part must have been
 * started, and the delay elapsed since.
 */

export interface StagedReleaseConfig {
  enabled: boolean
  unlockDelayHours: number
}

export interface ReaderProgress {
  /** Order number of a part → when this reader first opened it. */
  startedAt: ReadonlyMap<number, Date>
}

export type ReleaseState =
  | { state: 'open' }
  | { state: 'waiting'; opensAt: Date }
  | { state: 'locked'; reason: 'previous_part_not_started' }

/**
 * Whether `partOrder` is available to this reader at `now`.
 *
 * Returns `waiting` with a concrete time rather than a bare refusal, so
 * the UI can say "opens in 6 hours" instead of implying a broken link —
 * one of the behaviours the previous implementation was careful about
 * and worth preserving.
 */
export function releaseState(
  partOrder: number,
  progress: ReaderProgress,
  config: StagedReleaseConfig,
  now: Date,
): ReleaseState {
  if (!config.enabled) return { state: 'open' }
  if (partOrder <= 1) return { state: 'open' }

  // Already opened before: stays open.
  if (progress.startedAt.has(partOrder)) return { state: 'open' }

  const previousStartedAt = progress.startedAt.get(partOrder - 1)
  if (!previousStartedAt) return { state: 'locked', reason: 'previous_part_not_started' }

  const opensAt = new Date(
    previousStartedAt.getTime() + config.unlockDelayHours * 60 * 60 * 1000,
  )
  if (now.getTime() >= opensAt.getTime()) return { state: 'open' }

  return { state: 'waiting', opensAt }
}

export function isOpen(state: ReleaseState): state is { state: 'open' } {
  return state.state === 'open'
}
