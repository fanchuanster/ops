/**
 * AI correction, as a decision the reader makes rather than an edit.
 *
 * CLAUDE.md section 7 is explicit that the model must not rewrite
 * literary or historical source material, and that the auditable shape
 * is *original + suggestion + reason + human approval*. That rules out
 * the obvious implementation — correct the master and move on — so
 * correction is three acts with a person in the middle:
 *
 *   1. propose   converter reads the master, writes suggestions      `correct`
 *   2. decide    the owner adopts or declines each one, in the browser
 *   3. apply     converter rewrites the master from what was adopted  `apply`
 *
 * Between 2026-08-26 and this file, `allow_third_party_ai` reached the
 * converter and did nothing with it but advance a progress label. The
 * stage existed only in the CLI, so ticking the box on the upload form
 * sent no text anywhere and produced no suggestions. This is what the
 * box now means.
 *
 * ## Why this is not a conversion state
 *
 * It would have been less code to add `correcting` to `ConversionState`
 * and be done. It would also have been wrong twice over.
 *
 * A book waiting on a human decision is not *converting*, and putting it
 * in the conversion state machine would make the uploader's progress bar
 * say so — indefinitely, because step 2 has no timeout and may never
 * happen at all. Worse, phase 2 would be blocked behind it: the reader
 * would be denied an EPUB that is already buildable, over suggestions
 * nobody has looked at.
 *
 * So correction runs *beside* the pipeline on its own state, and the
 * book becomes readable on the normal schedule. Adopting suggestions
 * afterwards is an edit to the master like any other — it returns the
 * book to `master_ready` and phase 2 rebuilds the EPUB, which is exactly
 * the path `stateAfterMasterEdit` already exists to express.
 *
 * Framework-independent, like everything in `src/domain`.
 */

export const CORRECTION_STATES = [
  /** Not asked for. Every book whose uploader left the box unticked. */
  'none',
  /** A master exists and the suggestions have not been asked for yet. */
  'pending',
  /** A converter is reading the master and proposing corrections. */
  'running',
  /** Suggestions are waiting for the owner to decide on them. */
  'ready',
  /** The owner has decided; a converter has not picked it up yet. */
  'decided',
  /** A converter is rewriting the master from those decisions. */
  'applying',
  /** The master has been rewritten from what the owner adopted. */
  'applied',
  /** The proposal or the rewrite failed. Retryable. */
  'failed',
] as const

export type CorrectionState = (typeof CORRECTION_STATES)[number]

/** What a converter can be asked to do about correction. */
export type CorrectionJobKind = 'correct' | 'apply'

export function isCorrectionState(value: unknown): value is CorrectionState {
  return typeof value === 'string' && CORRECTION_STATES.includes(value as CorrectionState)
}

/**
 * Read a stored correction state, defaulting to `none`.
 *
 * `none` rather than a throw because every book that predates this
 * feature has no value at all, and the absence means precisely what
 * `none` means. Also the safe direction: an unreadable value must never
 * be mistaken for consent to send text to a third party.
 */
export function readCorrectionState(value: unknown): CorrectionState {
  return isCorrectionState(value) ? value : 'none'
}

/**
 * Where correction starts when a master becomes available.
 *
 * The one place that turns the uploader's answer into work. Called
 * wherever a master is attached — by the converter finishing phase 1, by
 * Adobe's export being collected, and by a DOCX upload, which *is* its
 * own master and so has one from the moment it arrives.
 *
 * `=== true` is not paranoia: an absent or null column on a book
 * uploaded before the question existed must read as no, and `Boolean(x)`
 * would agree while a cast would not.
 */
export function correctionStateForMaster(aiCorrection: unknown): CorrectionState {
  return aiCorrection === true ? 'pending' : 'none'
}

/**
 * Which correction job, if any, this state is waiting for.
 *
 * `ready` is deliberately absent. That is the state where the work
 * belongs to a person, and offering it to a converter would have the
 * machine answer a question that was asked of the reader.
 */
export function correctionClaimableAs(state: CorrectionState): CorrectionJobKind | null {
  if (state === 'pending') return 'correct'
  if (state === 'decided') return 'apply'
  return null
}

/**
 * The state a book holds while a converter has the correction job.
 *
 * Must differ from the state it was claimed from — the claim is a
 * compare-and-swap, so a swap that changed nothing would let a second
 * converter claim the same book. That is why the reader's decision and
 * the rewrite of the master are two states (`decided`, `applying`)
 * rather than the one state they read as in prose.
 */
export function correctionInProgressState(kind: CorrectionJobKind): CorrectionState {
  return kind === 'correct' ? 'running' : 'applying'
}

/** Where correction lands when a converter finishes. */
export function correctionCompletedState(kind: CorrectionJobKind): CorrectionState {
  return kind === 'correct' ? 'ready' : 'applied'
}

/** Are there suggestions for a person to look at right now? */
export function awaitingDecision(state: CorrectionState): boolean {
  return state === 'ready'
}

/**
 * Is correction doing something the owner should see a spinner for?
 *
 * `applying` counts and `ready` does not: one is a machine working, the
 * other is a machine waiting for the reader.
 */
export function correctionInFlight(state: CorrectionState): boolean {
  return state === 'running' || state === 'decided' || state === 'applying'
}

/**
 * May correction be started, or started again, for this book?
 *
 * Requires the uploader's consent every time. A book whose owner has
 * since unticked the box must not be re-sent to xAI because a retry
 * button was still on screen.
 */
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
  // Not while a converter holds it, and not while suggestions are
  // already waiting to be read — re-proposing would silently discard
  // decisions the owner has already made.
  return state === 'none' || state === 'pending' || state === 'failed' || state === 'applied'
}

/**
 * One suggestion, as the reviewer sees it.
 *
 * `block` and `line` address the line in the master's `Document`, and
 * are what the converter matches on when applying. They are opaque to
 * the reader and are carried through the decision round trip unchanged.
 */
export interface Suggestion {
  block: number
  line: number
  original: string
  suggested: string
  reason: string
  confidence: number
  category: string
}

/**
 * One suggestion with the reader's answer on it.
 *
 * Deliberately the whole suggestion rather than just its address and a
 * boolean. The converter's apply step refuses to act on a line whose
 * text has moved on since the suggestion was made, and it can only do
 * that if `original` travels with the decision — so carrying the pair
 * through is what makes the drift check possible rather than redundant.
 *
 * It also means the decisions file is exactly the suggestions file with
 * `approved` filled in, which is the shape `read_suggestions` on the
 * converter already parses. No second format, and no second parser.
 */
export interface Decision extends Suggestion {
  approved: boolean
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Read the suggestions file the converter wrote.
 *
 * Every field is checked because this crosses a trust boundary in the
 * awkward direction: the file was written by our converter, but from
 * text a third-party model produced, and it is rendered into a page.
 * A suggestion missing its `original` is dropped rather than shown,
 * because a reviewer cannot judge a change they cannot see the before
 * of.
 */
export function readSuggestions(payload: unknown): Suggestion[] {
  const list = (payload as { suggestions?: unknown })?.suggestions
  if (!Array.isArray(list)) return []

  const out: Suggestion[] = []
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as Record<string, unknown>
    if (!isIndex(item.block) || !isIndex(item.line)) continue
    if (typeof item.original !== 'string' || typeof item.suggested !== 'string') continue
    // A "correction" that changes nothing is not a decision worth
    // asking someone to make.
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

/**
 * Turn a form submission into the decisions the converter will act on.
 *
 * Only suggestions that were actually offered are accepted, matched by
 * address. That is the containment rule: without it a crafted form post
 * could rewrite any line of any master, which is a content-injection
 * hole dressed up as a proofreading tool.
 *
 * Anything the reader did not adopt is recorded as declined rather than
 * omitted, so the applied file is a complete record of what was decided
 * rather than only of what changed.
 */
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

/**
 * The address of a suggestion, as a form field name.
 *
 * Block and line rather than an array index: an index would silently
 * point at a different suggestion if the file were ever regenerated
 * between rendering the page and submitting it.
 */
export function suggestionId(suggestion: Pick<Suggestion, 'block' | 'line'>): string {
  return `${suggestion.block}:${suggestion.line}`
}

/** Did the reader adopt anything? Nothing adopted means nothing to do. */
export function anyAdopted(decisions: readonly Decision[]): boolean {
  return decisions.some((decision) => decision.approved)
}
