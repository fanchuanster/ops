/**
 * Apply approved corrections to a document.
 *
 * Separate from `proofread.ts` on purpose. The suggestion pass and the
 * edit are two jobs with a human decision between them, and that gap is
 * the whole safeguard CLAUDE.md section 7 asks for — a reader adopts a
 * suggestion on their own book page, and nothing else can.
 *
 * This step is conservative twice over: it applies only what was
 * approved, and only where the line still reads exactly as it did when
 * the suggestion was made. A master corrected by hand in between has
 * moved on, and applying a stale suggestion to it would corrupt a line
 * nobody reviewed.
 *
 * Ported from `services/converter/app/llm/apply.py` on 2026-08-26.
 */

import { type Document, type Suggestion } from './document'

export interface ApplyReport {
  applied: Suggestion[]
  /** Approved, but the line had changed since — skipped and reported. */
  drifted: Array<{ suggestion: Suggestion; current: string }>
  /** Approved, but pointing at a block or line that no longer exists. */
  unresolved: Suggestion[]
  /** Nobody has decided yet. */
  pending: number
  /** Explicitly declined by the reviewer. */
  rejected: number
}

export function applyReportOk(report: ApplyReport): boolean {
  return report.drifted.length === 0 && report.unresolved.length === 0
}

/** Edits `doc` in place with the approved suggestions. */
export function applySuggestions(doc: Document, suggestions: Suggestion[]): ApplyReport {
  const report: ApplyReport = {
    applied: [],
    drifted: [],
    unresolved: [],
    pending: 0,
    rejected: 0,
  }

  for (const suggestion of suggestions) {
    if (suggestion.approved === null || suggestion.approved === undefined) {
      report.pending += 1
      continue
    }
    if (suggestion.approved === false) {
      report.rejected += 1
      continue
    }

    const block = doc.blocks[suggestion.block]
    if (suggestion.block < 0 || !block) {
      report.unresolved.push(suggestion)
      continue
    }
    if (suggestion.line < 0 || suggestion.line >= block.lines.length) {
      report.unresolved.push(suggestion)
      continue
    }

    const current = block.lines[suggestion.line]
    if (current !== suggestion.original) {
      report.drifted.push({ suggestion, current })
      continue
    }

    block.lines[suggestion.line] = suggestion.suggested
    report.applied.push(suggestion)
  }

  return report
}
