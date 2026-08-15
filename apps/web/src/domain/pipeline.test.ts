/**
 * The two-phase pipeline.
 *
 * The behaviour worth protecting is that correcting a DOCX master costs
 * a rebuild of the formats and nothing else. Everything about the shape
 * of these states exists to make that true — if editing a master ever
 * re-ran OCR, the project would be paying Google again to re-read pages
 * it had already read, and discarding the correction that prompted it.
 */

import { describe, expect, it } from 'vitest'

import {
  type ConversionState,
  claimableAs,
  completedState,
  hasMaster,
  inProgressState,
  isConversionState,
  isInFlight,
  needsOcrRun,
  retryStateFor,
  stateAfterMasterEdit,
} from './pipeline'

describe('what a converter may claim', () => {
  it('offers phase 1 once the text is ready', () => {
    expect(claimableAs('ocr_ready')).toBe('master')
  })

  it('offers phase 2 once a master exists', () => {
    expect(claimableAs('master_ready')).toBe('formats')
  })

  it('offers nothing while OCR is still running', () => {
    expect(claimableAs('ocr')).toBeNull()
    expect(claimableAs('queued')).toBeNull()
  })

  it('offers nothing for a book another converter already holds', () => {
    expect(claimableAs('mastering')).toBeNull()
    expect(claimableAs('formatting')).toBeNull()
  })

  it('offers nothing for a private draft', () => {
    expect(claimableAs('draft')).toBeNull()
    expect(claimableAs('none')).toBeNull()
  })
})

describe('claiming changes the state', () => {
  // The claim is a compare-and-swap on the old state. If the in-progress
  // state equalled the claimable one the swap would be a no-op and two
  // converters could hold the same book.
  it('moves off the claimable state in both phases', () => {
    for (const state of ['ocr_ready', 'master_ready'] as ConversionState[]) {
      const kind = claimableAs(state)!
      expect(inProgressState(kind)).not.toBe(state)
    }
  })
})

describe('finishing a phase', () => {
  it('does not call a book ready when only the master is built', () => {
    // Phase 1 produces a DOCX, which no reader can read. Calling this
    // 'ready' would publish a book with no EPUB.
    expect(completedState('master')).toBe('master_ready')
  })

  it('queues phase 2 by landing on its claimable state', () => {
    expect(claimableAs(completedState('master'))).toBe('formats')
  })

  it('is finished once the formats exist', () => {
    expect(completedState('formats')).toBe('ready')
  })
})

describe('editing the master', () => {
  it('rebuilds the formats from a finished book', () => {
    expect(stateAfterMasterEdit('ready')).toBe('master_ready')
  })

  it('rebuilds without re-running OCR', () => {
    // The point of the split: the new state is phase 2's, so phase 1 --
    // the expensive half we have already paid Google for -- does not
    // run again.
    const after = stateAfterMasterEdit('ready')!
    expect(claimableAs(after)).toBe('formats')
  })

  it('does nothing for a book that has no master yet', () => {
    expect(stateAfterMasterEdit('queued')).toBeNull()
    expect(stateAfterMasterEdit('ocr')).toBeNull()
    expect(stateAfterMasterEdit('ocr_ready')).toBeNull()
  })

  it('knows which states have a master behind them', () => {
    expect(hasMaster('master_ready')).toBe(true)
    expect(hasMaster('formatting')).toBe(true)
    expect(hasMaster('ready')).toBe(true)
    expect(hasMaster('ocr_ready')).toBe(false)
  })
})

describe('deciding to run OCR', () => {
  it('runs for a freshly queued book', () => {
    expect(needsOcrRun({ state: 'queued' })).toBe(true)
  })

  it('does not pay twice for pages already read', () => {
    expect(needsOcrRun({ state: 'queued', ocrKey: 'books/7/ocr/pages.json' })).toBe(false)
  })

  it('does not start a second operation for one already running', () => {
    // A retried poll must not submit the same book again -- that is a
    // second Document AI bill for one book.
    expect(needsOcrRun({ state: 'queued', ocrOperation: 'projects/p/locations/l/operations/1' })).toBe(
      false,
    )
  })

  it('does not run for a book past phase 1', () => {
    expect(needsOcrRun({ state: 'master_ready' })).toBe(false)
  })
})

describe('retrying a failure', () => {
  it('rebuilds only the formats when a master survived', () => {
    // The expensive half already happened. Restarting from the
    // beginning would be a second Document AI bill for pages already
    // read, to rebuild a file sitting in storage.
    expect(retryStateFor({ hasMasterArtifact: true })).toBe('master_ready')
  })

  it('starts over when there is no master', () => {
    expect(retryStateFor({ hasMasterArtifact: false })).toBe('queued')
  })

  it('never re-runs phase 1 for a book that has a master', () => {
    expect(claimableAs(retryStateFor({ hasMasterArtifact: true }))).toBe('formats')
  })
})

describe('what a reader is told', () => {
  it('counts every working state as in flight', () => {
    for (const state of ['queued', 'ocr', 'ocr_ready', 'mastering', 'formatting'] as const) {
      expect(isInFlight(state)).toBe(true)
    }
  })

  it('does not count a finished or failed book', () => {
    expect(isInFlight('ready')).toBe(false)
    expect(isInFlight('failed')).toBe(false)
    expect(isInFlight('draft')).toBe(false)
  })
})

describe('validating stored values', () => {
  it('accepts the states it defines', () => {
    expect(isConversionState('master_ready')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isConversionState('converting')).toBe(false)
    expect(isConversionState(null)).toBe(false)
  })
})
