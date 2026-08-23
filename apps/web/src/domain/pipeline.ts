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
 * Adobe to re-read pages we have already read, and would throw away
 * the correction that prompted it.
 *
 * Who does which phase depends on the source. A PDF's master is built by
 * Adobe's Export PDF, which is an HTTP call, so the web application owns
 * it end to end (`lib/masterPipeline.ts`). A DOCX or text upload needs
 * no export, and its master is built by the converter — which also owns
 * phase 2 for every book, because rendering is compute.
 *
 * Framework-independent, like everything in `src/domain`.
 */

import type { ArtifactFormat } from './conversion'
import {
  type PublicationPlan,
  type SourceKind,
  formatsToGenerate,
  needsConverter,
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

/** What the converter is being asked to do. */
export type JobKind = 'master' | 'formats'

export function isConversionState(value: unknown): value is ConversionState {
  return typeof value === 'string' && CONVERSION_STATES.includes(value as ConversionState)
}

/**
 * States a converter may claim work from, and what work that is.
 *
 * `ocr_ready` is phase 1's remaining half for a source that needed no
 * export — a DOCX or text upload whose master the converter builds
 * itself. A PDF never passes through it: Adobe returns the master, so
 * the book goes straight to `master_ready`, which is phase 2.
 */
export function claimableAs(state: ConversionState): JobKind | null {
  if (state === 'ocr_ready') return 'master'
  if (state === 'master_ready') return 'formats'
  return null
}

/**
 * Which formats a phase 2 run should produce.
 *
 * There is no on-demand set any more, and no release set distinct from
 * it. Both existed to ration WeasyPrint: three PDF sizes were slow to
 * render and mostly unopened, so the EPUB was built on release and a PDF
 * only when a reader asked. With one PDF that mirrors the original —
 * and, for a PDF upload, *is* the original — there is nothing left to
 * ration. A book gets everything its source can give it, on the first
 * run, and `requestFormat` and its button are gone.
 *
 * What a book's source can give it is `formatsToGenerate` in
 * `domain/publication.ts`; this narrows that by what already exists.
 * The narrowing has one deliberate exception: when the book already has
 * formats, every one of them is rebuilt. That is a master edit — the
 * existing EPUB was built from text an editor has since corrected, and
 * rebuilding only what is missing would leave it behind, still carrying
 * the errors the edit removed.
 *
 * `docx` is never in the answer. It is the input.
 */
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
  // A rebuild covers what is there; a first run covers what is missing.
  // The union is both, and is the same thing in either case.
  return [...new Set([...possible, ...existing])]
}

export interface ClaimCandidate {
  state: ConversionState
  /** What was uploaded, which decides what phase 2 can build at all. */
  sourceKind: SourceKind
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
 * this answers "and on what". They are separate because the first is a
 * property of the state alone and stays testable as such, while the
 * second needs the book's source and its artifacts.
 *
 * Nothing here consults review. Phase 2 was held until an administrator
 * approved the book until 2026-08-17, and the gate was backwards:
 * review is a judgement about the finished edition, so holding the
 * edition until the review meant the reviewer had nothing to read, and
 * an uploader who never submitted their private book — which section
 * 6.2 explicitly permits — could never read it either. Publication is
 * where review belongs, and `enforcePublicationReview` in the Books
 * collection is where it is enforced.
 */
export function claimFor(candidate: ClaimCandidate): ClaimedWork | null {
  const kind = claimableAs(candidate.state)
  if (!kind) return null
  if (kind === 'master') return { kind, formats: [] }

  const formats = formatsToBuild({
    sourceKind: candidate.sourceKind,
    existingFormats: candidate.existingFormats,
  })
  // Nothing to build means nothing to claim. An EPUB upload reaches
  // `master_ready` with its edition already filed, and handing a
  // converter an empty job list would have it report success on work it
  // never did.
  if (formats.length === 0) return null
  return { kind, formats }
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
/**
 * Where a book lands when nothing has to be exported to reach a master.
 *
 * Three of the four sources need no export, and they do not need the
 * same thing afterwards:
 *
 *   text  → the converter still has to build a master from it
 *   docx  → the upload *is* the master; phase 2 can start
 *   epub  → the upload *is* the edition; the book is finished
 *   pdf, published as it stands → likewise finished
 *
 * Stated once, here, because two callers need the same answer: the
 * pipeline tick, and the details form that settles such a book on the
 * spot rather than leaving it for a converter that has nothing to do.
 */
export function stateWithoutExport(kind: SourceKind, plan: PublicationPlan): ConversionState {
  if (kind === 'text') return 'ocr_ready'
  return needsConverter(kind, plan) ? 'master_ready' : 'ready'
}

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
 * The states above, for a database `not_in` clause.
 *
 * The cover claim uses it: page one is rendered from the best artifact a
 * book has, so a book still gaining artifacts is left alone until it has
 * stopped — otherwise a text upload's cover would be taken from its DOCX
 * master seconds before its PDF existed (`domain/cover.ts`).
 */
export const IN_FLIGHT_STATES: ConversionState[] = CONVERSION_STATES.filter(isInFlight)

/**
 * Whether phase 1's export still has to be started for this book.
 *
 * Kept beside the states rather than in `adobe.ts` because it is a
 * question about *this book's* progress, not about the export engine: a
 * book that already has a job running has an `exportJob`, and submitting
 * it again would be paying twice for the same pages.
 */
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

/** The four steps the design's upload flow shows across the top. */
export const UPLOAD_STEPS = ['Upload', 'Process', 'Review', 'Publish'] as const

/**
 * Which of those four steps a book is standing on.
 *
 * The design draws this as a wizard, and the wizard is a lie in one
 * respect worth naming: our flow is not linear. A book can sit at
 * `Review` forever because submitting is optional, and one that is
 * never submitted never reaches `Publish` at all. The stepper says
 * where a book *is*, not where it is going.
 *
 * `Publish` therefore means published — an approved review — rather
 * than "converted and awaiting a decision". Anything else would light
 * the last step for a private upload that its owner never offered to
 * anyone.
 */
export function uploadStep({
  state,
  reviewState,
}: {
  state: ConversionState
  /** `unsubmitted` | `submitted` | `approved` | `rejected`. */
  reviewState?: string | null
}): number {
  if (reviewState === 'approved') return 3
  if (state === 'draft') return 0
  // Only these two mean the converter is finished with it. Everything
  // else is still Process — including `master_ready`, which `isInFlight`
  // deliberately excludes because *that* question is about a claim
  // being open, not about work remaining. And including `failed`: a
  // failure is not a step of its own, it belongs to the phase that was
  // running, which is the one the reader will restart.
  if (state === 'ready' || state === 'none') return 2
  return 1
}
