import { type Document, type Suggestion } from './document'

export interface ApplyReport {
  applied: Suggestion[]
  drifted: Array<{ suggestion: Suggestion; current: string }>
  unresolved: Suggestion[]
  pending: number
  rejected: number
}

export function applyReportOk(report: ApplyReport): boolean {
  return report.drifted.length === 0 && report.unresolved.length === 0
}

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
