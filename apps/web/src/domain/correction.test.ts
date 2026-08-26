import { describe, expect, it } from 'vitest'

import {
  acceptDecisions,
  anyAdopted,
  awaitingDecision,
  canRequestCorrection,
  correctionClaimableAs,
  correctionCompletedState,
  correctionInFlight,
  correctionInProgressState,
  correctionStateForMaster,
  readCorrectionState,
  readSuggestions,
  suggestionId,
  type Suggestion,
} from './correction'

const suggestion = (over: Partial<Suggestion> = {}): Suggestion => ({
  block: 1,
  line: 0,
  original: '不能自巳',
  suggested: '不能自己',
  reason: 'misread character',
  confidence: 0.98,
  category: 'characters',
  ...over,
})

describe('correctionStateForMaster', () => {
  it('starts correction only when the uploader asked for it', () => {
    expect(correctionStateForMaster(true)).toBe('pending')
    expect(correctionStateForMaster(false)).toBe('none')
  })

  it('reads an unanswered question as no', () => {
    // Every book uploaded before the checkbox existed has null here.
    // Consent to send text to a third party must never be inferred.
    expect(correctionStateForMaster(null)).toBe('none')
    expect(correctionStateForMaster(undefined)).toBe('none')
    expect(correctionStateForMaster('true')).toBe('none')
    expect(correctionStateForMaster(1)).toBe('none')
  })
})

describe('readCorrectionState', () => {
  it('defaults an absent or unknown value to none', () => {
    expect(readCorrectionState(undefined)).toBe('none')
    expect(readCorrectionState('elsewhere')).toBe('none')
    expect(readCorrectionState('ready')).toBe('ready')
  })
})

describe('the claim states', () => {
  it('offers a proposal job and an apply job, and nothing else', () => {
    expect(correctionClaimableAs('pending')).toBe('correct')
    expect(correctionClaimableAs('decided')).toBe('apply')
    for (const state of ['none', 'running', 'ready', 'applying', 'applied', 'failed'] as const) {
      expect(correctionClaimableAs(state)).toBeNull()
    }
  })

  it('never offers a converter the state where a person is deciding', () => {
    expect(correctionClaimableAs('ready')).toBeNull()
    expect(awaitingDecision('ready')).toBe(true)
  })

  it('moves off the claimed state, so a second converter cannot take it', () => {
    // The claim is a compare-and-swap on this field. A swap that left
    // the state alone would hand the same book to every poller.
    for (const kind of ['correct', 'apply'] as const) {
      const from = kind === 'correct' ? 'pending' : 'decided'
      expect(correctionInProgressState(kind)).not.toBe(from)
      expect(correctionClaimableAs(correctionInProgressState(kind))).toBeNull()
    }
  })

  it('lands where the next step expects it', () => {
    expect(correctionCompletedState('correct')).toBe('ready')
    expect(correctionCompletedState('apply')).toBe('applied')
  })

  it('spins for a machine working, not for a machine waiting on a reader', () => {
    expect(correctionInFlight('running')).toBe(true)
    expect(correctionInFlight('applying')).toBe(true)
    expect(correctionInFlight('ready')).toBe(false)
    expect(correctionInFlight('none')).toBe(false)
  })
})

describe('canRequestCorrection', () => {
  const base = { aiCorrection: true, hasMaster: true, state: 'none' as const }

  it('needs consent, every time', () => {
    expect(canRequestCorrection(base)).toBe(true)
    expect(canRequestCorrection({ ...base, aiCorrection: false })).toBe(false)
    expect(canRequestCorrection({ ...base, aiCorrection: null })).toBe(false)
  })

  it('needs a master to read', () => {
    expect(canRequestCorrection({ ...base, hasMaster: false })).toBe(false)
  })

  it('refuses while a converter holds it or a decision is outstanding', () => {
    expect(canRequestCorrection({ ...base, state: 'running' })).toBe(false)
    expect(canRequestCorrection({ ...base, state: 'applying' })).toBe(false)
    expect(canRequestCorrection({ ...base, state: 'decided' })).toBe(false)
    // The important one: re-proposing here would throw away decisions
    // the owner has already made on screen.
    expect(canRequestCorrection({ ...base, state: 'ready' })).toBe(false)
  })

  it('allows a retry after a failure, and a fresh pass after applying', () => {
    expect(canRequestCorrection({ ...base, state: 'failed' })).toBe(true)
    expect(canRequestCorrection({ ...base, state: 'applied' })).toBe(true)
  })
})

describe('readSuggestions', () => {
  it('reads a well-formed file', () => {
    const out = readSuggestions({ suggestions: [suggestion()] })
    expect(out).toHaveLength(1)
    expect(out[0]!.suggested).toBe('不能自己')
  })

  it('survives anything that is not a suggestions file', () => {
    expect(readSuggestions(null)).toEqual([])
    expect(readSuggestions({})).toEqual([])
    expect(readSuggestions({ suggestions: 'no' })).toEqual([])
    expect(readSuggestions({ suggestions: [null, 3, 'x'] })).toEqual([])
  })

  it('drops a suggestion a reviewer could not judge', () => {
    // No `original` means no before-text on the page, so there is
    // nothing to compare the proposal against.
    expect(readSuggestions({ suggestions: [{ block: 1, line: 0, suggested: 'x' }] })).toEqual([])
    expect(readSuggestions({ suggestions: [{ ...suggestion(), block: -1 }] })).toEqual([])
    expect(readSuggestions({ suggestions: [{ ...suggestion(), line: 1.5 }] })).toEqual([])
  })

  it('drops a change that changes nothing', () => {
    expect(readSuggestions({ suggestions: [suggestion({ suggested: '不能自巳' })] })).toEqual([])
  })

  it('fills in a missing reason rather than dropping the suggestion', () => {
    const out = readSuggestions({ suggestions: [{ ...suggestion(), reason: 7, confidence: 'x' }] })
    expect(out).toHaveLength(1)
    expect(out[0]!.reason).toBe('')
    expect(out[0]!.confidence).toBe(0)
  })
})

describe('acceptDecisions', () => {
  const offered = [suggestion({ block: 1, line: 0 }), suggestion({ block: 4, line: 2 })]

  it('records a decision for everything offered, adopted or not', () => {
    const decisions = acceptDecisions({ offered, approved: ['1:0'] })
    expect(decisions.map((d) => [d.block, d.line, d.approved])).toEqual([
      [1, 0, true],
      [4, 2, false],
    ])
    // The original travels with the decision, so the converter can
    // refuse a line that has changed since the suggestion was made.
    expect(decisions[0]!.original).toBe('不能自巳')
    expect(decisions[0]!.suggested).toBe('不能自己')
  })

  it('ignores an address that was never offered', () => {
    // The containment rule. Without it a crafted post could rewrite any
    // line of any master.
    const decisions = acceptDecisions({ offered, approved: ['9:9', '1:0'] })
    expect(decisions).toHaveLength(2)
    expect(decisions.filter((d) => d.approved).map((d) => suggestionId(d))).toEqual(['1:0'])
  })

  it('adopts nothing when nothing was ticked', () => {
    const decisions = acceptDecisions({ offered, approved: [] })
    expect(anyAdopted(decisions)).toBe(false)
    expect(anyAdopted(acceptDecisions({ offered, approved: ['4:2'] }))).toBe(true)
  })

  it('addresses a suggestion by where it is, not by its position in the list', () => {
    expect(suggestionId(offered[1]!)).toBe('4:2')
  })
})

describe('the file the converter actually writes', () => {
  /**
   * Captured from a real run: xAI reading a DOCX master of Chinese
   * Chan-diary prose through `app/llm/correct.py`, serialized by
   * `suggestion_to_dict`. Invented fixtures agree with whatever the
   * parser happens to do; this one agrees with the converter.
   */
  const real = {
    title: '参禅日记',
    model: 'xai:grok-4.20-0309-non-reasoning',
    how_to_review: 'Nothing here has been applied.',
    suggestions: [
      {
        block: 2,
        line: 1,
        category: 'characters',
        confidence: 0.98,
        reason: 'OCR misread the final character of 自巳; the correct form is 自己',
        original: '初坐半炷香，两腿酸麻难忍，妄念纷飞，如猿猴之攀枝，不能自巳。师见余眉头深锁，笑而不语。',
        suggested: '初坐半炷香，两腿酸麻难忍，妄念纷飞，如猿猴之攀枝，不能自己。师见余眉头深锁，笑而不语。',
        approved: null,
      },
      {
        block: 4,
        line: 1,
        category: 'characters',
        confidence: 0.95,
        reason: 'the correct form in this context is 钟 (一刻钟)',
        original: '夜半忽醒，闻窗外雨声滴沥，心忽空寂，不知身在何处，如是者约一刻锺。',
        suggested: '夜半忽醒，闻窗外雨声滴沥，心忽空寂，不知身在何处，如是者约一刻钟。',
        approved: null,
      },
    ],
    refused: [],
  }

  it('parses, keeping both sides of every line', () => {
    const parsed = readSuggestions(real)
    expect(parsed).toHaveLength(2)
    expect(parsed.map((s) => suggestionId(s))).toEqual(['2:1', '4:1'])
    expect(parsed[0]!.original).toContain('不能自巳')
    expect(parsed[0]!.suggested).toContain('不能自己')
    expect(parsed[1]!.confidence).toBe(0.95)
  })

  it('round-trips into the decisions file the converter reads back', () => {
    // The decisions file is the suggestions file with `approved` filled
    // in — the same shape `serialize.read_suggestions` parses. Anything
    // dropped here is a line the apply step could not act on.
    const decisions = acceptDecisions({
      offered: readSuggestions(real),
      approved: ['4:1'],
    })

    expect(decisions.map((d) => d.approved)).toEqual([false, true])
    const adopted = decisions.find((d) => d.approved)!
    expect(adopted.original).toBe(real.suggestions[1]!.original)
    expect(adopted.suggested).toBe(real.suggestions[1]!.suggested)
  })
})
