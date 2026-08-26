/**
 * The correction guardrails, ported case for case from
 * `services/converter/tests/test_correct.py`.
 *
 * Kept as a direct port rather than rewritten, because the value of
 * these cases is that they are the ones that were already protecting the
 * text. A guardrail suite written fresh against the new implementation
 * would agree with whatever the new implementation happens to do.
 */

import { describe, expect, it } from 'vitest'

import { type Document, makeBlock } from './document'
import {
  type Candidate,
  batchCandidates,
  classify,
  collectCandidates,
  parseResponse,
  renderBatch,
  suggestCorrections,
  vet,
} from './proofread'

const LINE = '子曰:學而時習之,不亦説乎?'

function candidate(text = LINE, kind: Candidate['kind'] = 'body'): Candidate {
  return { block: 0, line: 0, kind, text }
}

function vetOk(suggested: string, { original = LINE, confidence = 0.95 } = {}) {
  return vet(candidate(original), suggested, 'reason', confidence, { minConfidence: 0.7 })
}

describe('the guardrails', () => {
  it('accepts a punctuation repair and categorizes it', () => {
    const { suggestion, refused } = vetOk('子曰：學而時習之，不亦説乎？')
    expect(refused).toBeNull()
    expect(suggestion?.category).toBe('punctuation')
    expect(suggestion?.suggested).toBe('子曰：學而時習之，不亦説乎？')
  })

  it('accepts a character repair but flags it as a content change', () => {
    // 説 -> 說 is a real OCR confusion, and it changes what the reader
    // reads, so it must not be filed under punctuation.
    const { suggestion, refused } = vetOk('子曰:學而時習之,不亦說乎?')
    expect(refused).toBeNull()
    expect(suggestion?.category).toBe('characters')
  })

  it('refuses an identical suggestion', () => {
    expect(vetOk(LINE).refused).toBe('no change')
  })

  it('refuses an empty suggestion', () => {
    expect(vetOk('   ').refused).toBe('empty suggestion')
  })

  it('refuses low confidence', () => {
    expect(vetOk('子曰：學而時習之，不亦説乎？', { confidence: 0.5 }).refused).toContain('below')
  })

  it('refuses confidence outside the unit range', () => {
    expect(vetOk('子曰：學而時習之，不亦説乎？', { confidence: 95 }).refused).toContain(
      'out of range',
    )
  })

  it('treats a missing confidence as none rather than certainty', () => {
    const { suggestion, refused } = vet(candidate(), '子曰：學而時習之，不亦説乎？', '', 0, {
      minConfidence: 0.7,
    })
    expect(suggestion).toBeNull()
    expect(refused).toContain('below')
  })

  it('refuses a paraphrase', () => {
    expect(vetOk('孔子說：學習並時常複習，不也是很快樂的事嗎？').refused).not.toBeNull()
  })

  it('refuses completing a truncated line', () => {
    // The model "helpfully" finishing a printed line that legitimately
    // continues overleaf is the failure mode this limit exists for.
    expect(vetOk(`${LINE}有朋自遠方來，不亦樂乎？`).refused).toContain('length changed')
  })

  it('refuses rewriting more than two characters', () => {
    expect(vetOk('子曰:學而時温之,不亦樂哉?').refused).toContain('content characters changed')
  })

  it('refuses traditional-to-simplified conversion', () => {
    // Same length, so only the content-edit budget catches it.
    expect(vetOk('子曰:学而时习之,不亦説乎?').refused).toContain('content characters changed')
  })

  it('still allows a two-character repair', () => {
    const { suggestion, refused } = vetOk('子曰:學而時習之,不亦說乎!')
    expect(refused).toBeNull()
    expect(suggestion?.category).toBe('characters')
  })
})

describe('classify', () => {
  it.each([
    ['甲，乙。', '甲、乙。', 'punctuation', 0],
    ['甲(乙)', '甲（乙）', 'punctuation', 0],
    ['甲乙丙', '甲丙丙', 'characters', 2],
    ['甲乙', '甲乙丙', 'characters', 1],
  ])('%s -> %s is %s', (original, suggested, category, contentEdits) => {
    expect(classify(original, suggested)).toEqual({ category, contentEdits })
  })
})

describe('parseResponse', () => {
  it('tolerates a code fence', () => {
    const raw = '```json\n{"suggestions": [{"id": "L1"}]}\n```'
    expect(parseResponse(raw)).toEqual([{ id: 'L1' }])
  })

  it('accepts a bare list from a model that skipped the envelope', () => {
    expect(parseResponse('[{"id": "L1"}]')).toEqual([{ id: 'L1' }])
  })

  it('rejects prose', () => {
    expect(() => parseResponse('I think line 3 looks wrong.')).toThrow(/not JSON/)
  })
})

describe('what is sent to the model', () => {
  const doc = (): Document => ({
    title: 'T',
    blocks: [
      makeBlock('chapter', ['第一章']),
      makeBlock('body', ['正文一行']),
      makeBlock('verse', ['詩的一行', '  ']),
    ],
  })

  it('never sends chapter headings', () => {
    // They come from the source's own structure, not from OCR.
    const texts = collectCandidates(doc()).map((c) => c.text)
    expect(texts).not.toContain('第一章')
  })

  it('does not send blank lines', () => {
    expect(collectCandidates(doc()).map((c) => c.text)).toEqual(['正文一行', '詩的一行'])
  })

  it('carries the line kind as context', () => {
    const { prompt } = renderBatch(collectCandidates(doc()))
    expect(prompt).toContain('L1\t[body]\t正文一行')
    expect(prompt).toContain('L2\t[verse]\t詩的一行')
  })

  it('batches consecutive lines under the character budget', () => {
    const candidates = collectCandidates({
      title: 'T',
      blocks: [makeBlock('body', ['一二三', '四五六', '七八九'])],
    })
    expect(batchCandidates(candidates, 6).map((b) => b.length)).toEqual([2, 1])
  })
})

describe('suggestCorrections', () => {
  const doc = (): Document => ({
    title: 'T',
    blocks: [makeBlock('body', ['子曰:學而時習之'])],
  })

  it('never edits the document', async () => {
    const document = doc()
    await suggestCorrections(
      document,
      async () =>
        JSON.stringify({
          suggestions: [
            { id: 'L1', suggested: '子曰：學而時習之', reason: 'r', confidence: 0.95 },
          ],
        }),
    )
    expect(document.blocks[0].lines[0]).toBe('子曰:學而時習之')
  })

  it('refuses an invented line id', async () => {
    const report = await suggestCorrections(
      doc(),
      async () =>
        JSON.stringify({
          suggestions: [{ id: 'L99', suggested: 'x', reason: 'r', confidence: 0.95 }],
        }),
    )
    expect(report.suggestions).toHaveLength(0)
    expect(report.rejected[0].rejectedBecause).toContain('invented a reference')
  })

  it('does not lose the rest of the book to one unparseable batch', async () => {
    const document: Document = {
      title: 'T',
      blocks: [makeBlock('body', ['子曰:學而時習之', '不亦説乎?'])],
    }
    let call = 0
    const report = await suggestCorrections(
      document,
      async () => {
        call += 1
        if (call === 1) return 'sorry, I cannot help with that'
        return JSON.stringify({
          suggestions: [{ id: 'L1', suggested: '不亦説乎？', reason: 'r', confidence: 0.95 }],
        })
      },
      { batchChars: 8 },
    )
    expect(report.batches).toBe(2)
    expect(report.suggestions).toHaveLength(1)
    expect(report.rejected[0].rejectedBecause).toContain('batch 1')
  })
})
