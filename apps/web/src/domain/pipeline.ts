/**
 * The two phases of book production.
 *
 * CLAUDE.md section 5 makes the DOCX master the source of truth and
 * requires reader-facing formats to be generated *from* it. That is not
 * one pipeline with a DOCX in the middle — it is two, joined at the
 * master:
 *
 *   Phase 1   original → DOCX master        expensive, run once
 *   Phase 2   DOCX master → EPUB, PDF…      cheap, run whenever
 *
 * The split is what makes the master editable. An editor corrects OCR
 * damage in the master, or an uploader re-uploads a corrected one
 * (section 6.2), and the book returns to `master_ready` — phase 2 runs
 * again and phase 1 does not. Re-running phase 1 would mean paying
 * Google to re-read pages we have already read, and would throw away
 * the correction that prompted it.
 *
 * Both phases are done by the converter. The web application's share is
 * OCR, which is an HTTP call rather than compute.
 *
 * Framework-independent, like everything in `src/domain`.
 */

import type { ArtifactFormat } from './conversion'
import type { ReviewState } from './moderation'

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

/** What the converter is being asked to do. */
export type JobKind = 'master' | 'formats'

export function isConversionState(value: unknown): value is ConversionState {
  return typeof value === 'string' && CONVERSION_STATES.includes(value as ConversionState)
}

/**
 * States a converter may claim work from, and what work that is.
 *
 * `ocr_ready` is phase 1's second half: the text exists and the master
 * has to be built from it. `master_ready` is phase 2.
 */
export function claimableAs(state: ConversionState): JobKind | null {
  if (state === 'ocr_ready') return 'master'
  if (state === 'master_ready') return 'formats'
  return null
}

/**
 * What phase 2 builds when a book is first released.
 *
 * EPUB alone. CLAUDE.md section 10 makes it the primary reflowable
 * format, and it is the one every reader needs; the PDF variants are
 * three renderings of the same book that most readers will never open.
 * Building all four on every release spent WeasyPrint's time — by far
 * the slowest stage — on files nobody asked for.
 */
export const RELEASE_FORMATS: readonly ArtifactFormat[] = ['epub']

/**
 * Formats built only when somebody asks for one.
 *
 * The three PDF sizes. A reader picks the typography they want and that
 * variant is rendered for them; the other two are not.
 */
export const ON_DEMAND_FORMATS: readonly ArtifactFormat[] = [
  'pdf_standard',
  'pdf_large',
  'pdf_xl',
]

export function isOnDemandFormat(value: unknown): value is ArtifactFormat {
  return typeof value === 'string' && ON_DEMAND_FORMATS.includes(value as ArtifactFormat)
}

/**
 * Is this book cleared for its reader-facing formats to be built?
 *
 * Reader uploads wait for review; staff library content does not. The
 * scoping is deliberately identical to `enforcePublicationReview` in
 * the Books collection — a book is "reader-created" exactly when it has
 * an owner. Requiring review of staff content would mean an editor
 * could not convert a book without first submitting it to themselves.
 *
 * The gate exists because generating an edition is a statement that the
 * book is fit to read. Building the EPUB before anyone has looked at
 * the master means the OCR damage is baked into the edition, and the
 * two-phase split (above) is precisely what makes waiting cheap.
 */
export function reviewClearsFormats({
  hasOwner,
  reviewState,
}: {
  hasOwner: boolean
  reviewState: ReviewState
}): boolean {
  if (!hasOwner) return true
  return reviewState === 'approved'
}

/**
 * Which formats a phase 2 run should produce.
 *
 * Three cases, in order:
 *
 *   - Something was asked for → build exactly that.
 *   - Nothing asked for, nothing built → the release set.
 *   - Nothing asked for, formats already exist → rebuild them all.
 *
 * That last case is the one worth stating plainly: it is a master edit.
 * The book already has an EPUB and perhaps two PDFs, all of them built
 * from text an editor has since corrected. Rebuilding only the release
 * set would leave those PDFs behind, still rendering the errors the
 * edit removed — stale in a way nobody would notice until a reader
 * opened one.
 *
 * `docx` is never in the answer. It is the input.
 */
export function formatsToBuild({
  pendingFormats,
  existingFormats,
}: {
  pendingFormats: readonly unknown[]
  existingFormats: readonly unknown[]
}): ArtifactFormat[] {
  const pending = pendingFormats.filter(isOnDemandFormat)
  if (pending.length > 0) return [...new Set(pending)]

  const existing = existingFormats.filter(
    (format): format is ArtifactFormat =>
      isOnDemandFormat(format) || RELEASE_FORMATS.includes(format as ArtifactFormat),
  )
  return [...new Set([...RELEASE_FORMATS, ...existing])]
}

export interface ClaimCandidate {
  state: ConversionState
  /** Reader-created books need review; staff library content does not. */
  hasOwner: boolean
  reviewState: ReviewState
  pendingFormats: readonly unknown[]
  /** Formats the book already has, so a master edit rebuilds them all. */
  existingFormats: readonly unknown[]
}

export interface ClaimedWork {
  kind: JobKind
  /** Empty for a `master` job, which produces the one thing it produces. */
  formats: ArtifactFormat[]
}

/**
 * What, if anything, a converter should be handed for this book.
 *
 * `claimableAs` above answers "which phase does this state belong to";
 * this answers "may it run, and on what". They are separate because the
 * first is a property of the state alone and stays testable as such,
 * while the second needs the book's review and its artifacts.
 */
export function claimFor(candidate: ClaimCandidate): ClaimedWork | null {
  const kind = claimableAs(candidate.state)
  if (!kind) return null
  if (kind === 'master') return { kind, formats: [] }

  if (!reviewClearsFormats(candidate)) return null

  return {
    kind,
    formats: formatsToBuild({
      pendingFormats: candidate.pendingFormats,
      existingFormats: candidate.existingFormats,
    }),
  }
}

/**
 * The state a book moves to while a converter holds it.
 *
 * Distinct from the state it was claimed from, which is what stops a
 * second converter claiming the same book: the claim is a
 * compare-and-swap on the old state, so the swap must change it.
 */
export function inProgressState(kind: JobKind): ConversionState {
  return kind === 'master' ? 'mastering' : 'formatting'
}

/**
 * Where a book lands when a converter finishes a phase.
 *
 * Phase 1 completing does not make a book readable — it makes a master
 * that phase 2 must still turn into an EPUB. Returning `master_ready`
 * rather than `ready` is what queues phase 2 automatically.
 */
export function completedState(kind: JobKind): ConversionState {
  return kind === 'master' ? 'master_ready' : 'ready'
}

/**
 * Does this state mean the book has a usable DOCX master?
 *
 * Everything from `master_ready` onwards does. Used to decide whether
 * editing the master is possible, and whether phase 2 can be re-run
 * without phase 1.
 */
export function hasMaster(state: ConversionState): boolean {
  return state === 'master_ready' || state === 'formatting' || state === 'ready'
}

/**
 * The state a book returns to when its master is edited or replaced.
 *
 * Null when there is nothing to rebuild from — a book still in phase 1
 * has no master, so an edit to it is not an edit to a master and must
 * not be mistaken for one.
 *
 * This is the whole point of the two-phase split, expressed as one
 * function: correcting a master costs a rebuild of the formats and
 * nothing more.
 */
export function stateAfterMasterEdit(state: ConversionState): ConversionState | null {
  return hasMaster(state) ? 'master_ready' : null
}

/**
 * Has this book consumed a conversion from its uploader's monthly quota?
 *
 * Everything past `draft`. A draft costs nothing — it is a workspace,
 * and the quota is counted at conversion so a refused conversion leaves
 * the draft to try next month (CLAUDE.md section 6.2). A failure counts,
 * because the work was done.
 *
 * A predicate rather than a list, because the list was the bug: adding
 * the phase states left `uploadQuota` still enumerating the old ones,
 * silently under-counting every book in the new states.
 */
export function countsAgainstQuota(state: ConversionState): boolean {
  return state !== 'none' && state !== 'draft'
}

/** The states above, for a database `in` clause. */
export const QUOTA_COUNTED_STATES: ConversionState[] = CONVERSION_STATES.filter(countsAgainstQuota)

/**
 * Where a failed book restarts from.
 *
 * A failure loses which phase was running, but not what the book has:
 * if a DOCX master is attached, phase 1 finished and whatever failed was
 * phase 2. Restarting such a book from `queued` would re-run OCR — a
 * second bill from Google for pages already read, to rebuild a master
 * that is sitting right there.
 *
 * Keyed on the artifact rather than the state for exactly that reason.
 * The state is what we lost; the artifact is the evidence that survived.
 */
export function retryStateFor({ hasMasterArtifact }: { hasMasterArtifact: boolean }): ConversionState {
  return hasMasterArtifact ? 'master_ready' : 'queued'
}

/**
 * Is this book finished with phase 1 and waiting on a human?
 *
 * Distinct from `isInFlight`: nothing is running and nothing will start
 * until somebody reviews it. The uploader should be told that, not
 * shown a spinner — a progress bar that will never move on its own is
 * worse than no progress bar.
 */
export function awaitingReview(candidate: {
  state: ConversionState
  hasOwner: boolean
  reviewState: ReviewState
}): boolean {
  return candidate.state === 'master_ready' && !reviewClearsFormats(candidate)
}

/**
 * Is the pipeline holding this book, such that a reader should be told
 * to wait rather than shown controls?
 */
export function isInFlight(state: ConversionState): boolean {
  return (
    state === 'queued' ||
    state === 'ocr' ||
    state === 'ocr_ready' ||
    state === 'mastering' ||
    state === 'formatting'
  )
}

/**
 * Whether OCR has to run before phase 1's master can be built.
 *
 * Kept beside the states rather than in `ocr.ts` because it is a
 * question about *this book's* progress, not about OCR: a book that has
 * already been read has an `ocrKey`, and asking Google to read it again
 * would be paying twice for the same pages.
 */
export function needsOcrRun({
  state,
  ocrKey,
  ocrOperation,
}: {
  state: ConversionState
  ocrKey?: string | null
  ocrOperation?: string | null
}): boolean {
  if (state !== 'queued') return false
  return !ocrKey && !ocrOperation
}
