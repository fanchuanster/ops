/**
 * AI-assisted OCR correction, as suggestions rather than edits.
 *
 * CLAUDE.md section 7 is unambiguous: the AI must not blindly rewrite
 * literary or historical source material. The output of this stage is
 * therefore a list of `Suggestion`s — original, proposal, reason,
 * confidence — that a human approves before anything is applied.
 *
 * The model is advisory and is not trusted. Every proposal is put
 * through the deterministic checks in `vet()` before it is even offered
 * for review, because "preserve original wording" cannot be enforced by
 * asking politely in a prompt. A model that decides to modernize 「說」
 * into a paraphrase, or to helpfully complete a truncated line, is
 * rejected here rather than reaching a reviewer who might wave it
 * through.
 *
 * Ported from `services/converter/app/llm/correct.py` on 2026-08-26.
 * The constants are unchanged, and deliberately so: they were tuned
 * against real output from this library's own scans, and a port is not
 * the moment to retune them.
 *
 * Named for what it does rather than `correction.ts`, which is the
 * review state machine this feeds.
 */

import { type BlockKind, type Document, type Suggestion } from './document'
import { SequenceMatcher, codePoints } from './textDiff'

/**
 * Chapter headings come from the source's own structure, not from OCR —
 * they are authoritative and there is nothing to correct.
 */
const SKIP_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>(['chapter'])

export const SYSTEM_PROMPT = `You are proofreading OCR output from a scanned printed Chinese book for a digital preservation project. The text is often classical or literary Chinese, in traditional or simplified characters.

Your ONLY job is to identify places where the OCR engine misread the printed page. You are correcting the machine, not the author.

You MAY suggest:
- a character the OCR clearly misrecognized (visually similar shapes)
- half-width punctuation that the printed page sets full-width (, . ? ! : ; ( ) -> ，。？！：；（）)
- a missing or duplicated punctuation mark
- obvious OCR artifacts: stray Latin letters or digits inside Chinese text, repeated characters, dropped quotation marks

You MUST NOT:
- change, modernize, simplify or paraphrase the author's wording
- convert between traditional and simplified characters
- translate anything
- add, remove, complete or reorder content
- "improve" style, grammar or clarity
- fix a line that merely looks incomplete: lines are printed lines and a sentence legitimately continues onto the next one
- suggest anything you are not confident about

If a line has no clear OCR error, say nothing about it. Most lines are correct. Returning an empty list is the expected outcome for a clean page.

Respond with JSON only, in exactly this shape:

{"suggestions": [{"id": "L3", "suggested": "corrected line text", "reason": "brief reason in English", "confidence": 0.95}]}

\`suggested\` must be the complete corrected line, not a fragment. \`confidence\` is between 0 and 1: use it honestly, and stay above 0.9 only for errors you are certain about.`

/**
 * How far a proposal may stray from the original before it stops being a
 * correction and starts being a rewrite. Derived from the shape of a
 * real OCR error: a misread character, a punctuation mark, occasionally
 * two.
 */
export const MAX_LENGTH_DELTA_RATIO = 0.15
export const MAX_LENGTH_DELTA_CHARS = 3
export const MIN_SIMILARITY = 0.75
/** Substantive (non-punctuation) characters that may change in one line. */
export const MAX_CONTENT_EDITS = 2

const FENCE_RE = /^\s*```(?:json)?\s*|\s*```\s*$/g

/** A proposal the guardrails refused, kept for audit. */
export interface Rejection {
  block: number
  line: number
  original: string
  suggested: string
  reason: string
  rejectedBecause: string
}

export interface CorrectionReport {
  suggestions: Suggestion[]
  rejected: Rejection[]
  batches: number
  linesExamined: number
  model: string
}

/** One line offered to the model, addressed by its position. */
export interface Candidate {
  block: number
  line: number
  kind: BlockKind
  text: string
}

/**
 * Python's `unicodedata.category(ch).startswith("P") or ch.isspace()`.
 *
 * `\p{P}` is the same General_Category set Python names "P", so
 * full-width 。，（） are punctuation here exactly as they are there.
 */
function isPunctuation(ch: string): boolean {
  return /\p{P}/u.test(ch) || /\s/u.test(ch)
}

/**
 * Describe an edit: its category, and how many content chars changed.
 *
 * "punctuation" means only punctuation and spacing differ — the safest
 * class of correction. Anything that touches a character the reader
 * would read is "characters", and is counted so the caller can hold the
 * line at a couple of characters per line.
 */
export function classify(
  original: string,
  suggested: string,
): { category: Suggestion['category']; contentEdits: number } {
  const a = codePoints(original)
  const b = codePoints(suggested)
  let contentEdits = 0

  for (const op of new SequenceMatcher(a, b).getOpcodes()) {
    if (op.tag === 'equal') continue
    const changed = [...a.slice(op.i1, op.i2), ...b.slice(op.j1, op.j2)]
    contentEdits += changed.filter((ch) => !isPunctuation(ch)).length
  }

  return { category: contentEdits === 0 ? 'punctuation' : 'characters', contentEdits }
}

/**
 * Accept a proposal, or say why not.
 *
 * Pure and deterministic — this is the part of the stage that is
 * actually tested, because it is the part that protects the text.
 */
export function vet(
  candidate: Candidate,
  rawSuggested: string,
  reason: string,
  confidence: number,
  { minConfidence }: { minConfidence: number },
): { suggestion: Suggestion | null; refused: string | null } {
  const original = candidate.text
  const suggested = rawSuggested.trim()

  if (!suggested) return { suggestion: null, refused: 'empty suggestion' }
  if (suggested === original) return { suggestion: null, refused: 'no change' }
  if (!(confidence >= 0 && confidence <= 1)) {
    return { suggestion: null, refused: `confidence ${confidence} out of range` }
  }
  if (confidence < minConfidence) {
    return {
      suggestion: null,
      refused: `confidence ${confidence.toFixed(2)} below ${minConfidence.toFixed(2)}`,
    }
  }

  const originalLength = codePoints(original).length
  const delta = Math.abs(codePoints(suggested).length - originalLength)
  const allowed = Math.max(
    MAX_LENGTH_DELTA_CHARS,
    Math.trunc(originalLength * MAX_LENGTH_DELTA_RATIO),
  )
  if (delta > allowed) {
    return { suggestion: null, refused: `length changed by ${delta} chars (limit ${allowed})` }
  }

  const ratio = new SequenceMatcher(original, suggested).ratio()
  if (ratio < MIN_SIMILARITY) {
    return {
      suggestion: null,
      refused: `only ${ratio.toFixed(2)} similar to the original (limit ${MIN_SIMILARITY})`,
    }
  }

  const { category, contentEdits } = classify(original, suggested)
  if (contentEdits > MAX_CONTENT_EDITS) {
    return {
      suggestion: null,
      refused:
        `${contentEdits} content characters changed (limit ${MAX_CONTENT_EDITS}) ` +
        '— that is a rewrite, not an OCR correction',
    }
  }

  return {
    suggestion: {
      block: candidate.block,
      line: candidate.line,
      original,
      suggested,
      reason: codePoints(reason.trim()).slice(0, 300).join(''),
      confidence,
      category,
    },
    refused: null,
  }
}

export function collectCandidates(doc: Document): Candidate[] {
  const candidates: Candidate[] = []
  doc.blocks.forEach((block, b) => {
    if (SKIP_KINDS.has(block.kind)) return
    block.lines.forEach((text, ln) => {
      if (text.trim()) candidates.push({ block: b, line: ln, kind: block.kind, text })
    })
  })
  return candidates
}

/**
 * Group consecutive lines into batches under a character budget.
 *
 * Consecutive because context matters: a verse line reads differently
 * beside the rest of its poem, and a prose line beside the sentence it
 * continues. Small because a model asked about forty lines at once
 * attends to none of them properly.
 */
export function batchCandidates(candidates: Candidate[], budget: number): Candidate[][] {
  const batches: Candidate[][] = []
  let current: Candidate[] = []
  let size = 0

  for (const candidate of candidates) {
    const length = codePoints(candidate.text).length
    if (current.length > 0 && size + length > budget) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(candidate)
    size += length
  }
  if (current.length > 0) batches.push(current)

  return batches
}

/** Number the batch's lines and return the prompt plus an id lookup. */
export function renderBatch(batch: Candidate[]): {
  prompt: string
  byId: Map<string, Candidate>
} {
  const byId = new Map<string, Candidate>()
  const lines = batch.map((candidate, index) => {
    const lineId = `L${index + 1}`
    byId.set(lineId, candidate)
    return `${lineId}\t[${candidate.kind}]\t${candidate.text}`
  })

  const prompt =
    'Proofread these consecutive lines from the scan. The tag in ' +
    'brackets is how the layout pass classified the line: `verse` ' +
    "lines are a poem's own lines, `body` is prose, `footnote` is a " +
    'note at the foot of the page, `attribution` names a source.\n\n' +
    lines.join('\n')

  return { prompt, byId }
}

/**
 * Read the model's JSON, tolerating a code fence around it.
 *
 * A provider without JSON mode will wrap the object in ```json, and that
 * is not worth failing a batch over.
 */
export function parseResponse(raw: string): Array<Record<string, unknown>> {
  const text = raw.trim().replace(FENCE_RE, '')

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new Error(`response was not JSON: ${text.slice(0, 200)}`)
  }

  // A model that skipped the envelope.
  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> => isRecord(item))
  }
  if (!isRecord(data)) throw new Error('`suggestions` was not a list')

  const items = data.suggestions ?? []
  if (!Array.isArray(items)) throw new Error('`suggestions` was not a list')
  return items.filter((item): item is Record<string, unknown> => isRecord(item))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * An absent or unparseable confidence is treated as no confidence rather
 * than as certainty.
 */
function asFloat(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Chat completion, as this stage needs it. No provider in the type. */
export type ChatComplete = (system: string, user: string) => Promise<string>

export interface SuggestOptions {
  batchChars?: number
  minConfidence?: number
  model?: string
  /** Called after each batch, for progress that outlives the request. */
  onBatch?: (done: number, total: number, report: CorrectionReport) => void | Promise<void>
}

/**
 * Run the correction pass over a document, changing nothing.
 *
 * The document is read-only here by design. Applying an approved
 * suggestion is `applySuggestions`'s job, and it is a separate job kind
 * so that the human step between them is unavoidable rather than
 * optional.
 */
export async function suggestCorrections(
  doc: Document,
  complete: ChatComplete,
  { batchChars = 1200, minConfidence = 0.7, model = '', onBatch }: SuggestOptions = {},
): Promise<CorrectionReport> {
  const report: CorrectionReport = {
    suggestions: [],
    rejected: [],
    batches: 0,
    linesExamined: 0,
    model,
  }

  const candidates = collectCandidates(doc)
  report.linesExamined = candidates.length
  const batches = batchCandidates(candidates, batchChars)

  for (const [index, batch] of batches.entries()) {
    const number = index + 1
    const { prompt, byId } = renderBatch(batch)
    const raw = await complete(SYSTEM_PROMPT, prompt)
    report.batches += 1

    let items: Array<Record<string, unknown>>
    try {
      items = parseResponse(raw)
    } catch (error) {
      // One unparseable batch must not lose the rest of the book.
      report.rejected.push({
        block: batch[0].block,
        line: batch[0].line,
        original: '',
        suggested: '',
        reason: '',
        rejectedBecause: `batch ${number}: ${(error as Error).message}`,
      })
      await onBatch?.(number, batches.length, report)
      continue
    }

    for (const item of items) {
      const lineId = String(item.id ?? '')
      const candidate = byId.get(lineId)

      if (!candidate) {
        report.rejected.push({
          block: batch[0].block,
          line: batch[0].line,
          original: '',
          suggested: String(item.suggested ?? '').slice(0, 200),
          reason: String(item.reason ?? '').slice(0, 200),
          rejectedBecause:
            `id ${JSON.stringify(lineId)} is not a line in this batch — ` +
            'the model invented a reference',
        })
        continue
      }

      const { suggestion, refused } = vet(
        candidate,
        String(item.suggested ?? ''),
        String(item.reason ?? ''),
        asFloat(item.confidence),
        { minConfidence },
      )

      if (suggestion) {
        report.suggestions.push(suggestion)
      } else {
        report.rejected.push({
          block: candidate.block,
          line: candidate.line,
          original: candidate.text,
          suggested: String(item.suggested ?? '').slice(0, 200),
          reason: String(item.reason ?? '').slice(0, 200),
          rejectedBecause: refused ?? 'rejected',
        })
      }
    }

    await onBatch?.(number, batches.length, report)
  }

  return report
}
