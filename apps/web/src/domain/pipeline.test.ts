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
  awaitingReview,
  claimFor,
  formatsToBuild,
  isConversionState,
  isInFlight,
  reviewClearsFormats,
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

describe('the review gate before phase 2', () => {
  it('clears staff library content, which has no owner to review it', () => {
    expect(reviewClearsFormats({ hasOwner: false, reviewState: 'unsubmitted' })).toBe(true)
  })

  it('holds a reader upload until it is approved', () => {
    for (const reviewState of ['unsubmitted', 'submitted', 'rejected'] as const) {
      expect(reviewClearsFormats({ hasOwner: true, reviewState })).toBe(false)
    }
    expect(reviewClearsFormats({ hasOwner: true, reviewState: 'approved' })).toBe(true)
  })

  it('offers no phase 2 work for a book still awaiting review', () => {
    expect(
      claimFor({
        state: 'master_ready',
        hasOwner: true,
        reviewState: 'submitted',
        pendingFormats: [],
        existingFormats: [],
      }),
    ).toBeNull()
  })

  it('still offers phase 1, which review has nothing to say about', () => {
    // The master is what gets reviewed. Gating its creation on review
    // would be asking someone to approve a book nobody can read yet.
    expect(
      claimFor({
        state: 'ocr_ready',
        hasOwner: true,
        reviewState: 'unsubmitted',
        pendingFormats: [],
        existingFormats: [],
      }),
    ).toEqual({ kind: 'master', formats: [] })
  })

  it('says a held book is awaiting review rather than in flight', () => {
    const held = { state: 'master_ready' as const, hasOwner: true, reviewState: 'submitted' as const }
    expect(awaitingReview(held)).toBe(true)
    expect(isInFlight(held.state)).toBe(false)
  })

  it('does not call an approved book awaiting review', () => {
    expect(
      awaitingReview({ state: 'master_ready', hasOwner: true, reviewState: 'approved' }),
    ).toBe(false)
  })
})

describe('choosing which formats to build', () => {
  it('builds only the release set for a new book', () => {
    expect(formatsToBuild({ pendingFormats: [], existingFormats: [] })).toEqual(['epub'])
  })

  it('builds exactly what was asked for', () => {
    expect(formatsToBuild({ pendingFormats: ['pdf_large'], existingFormats: ['epub'] })).toEqual([
      'pdf_large',
    ])
  })

  it('rebuilds everything the book already has when the master is edited', () => {
    // The reason this matters: a PDF built from the old master still
    // renders the errors the edit removed, and nothing would ever
    // rebuild it if only the release set were regenerated.
    const formats = formatsToBuild({
      pendingFormats: [],
      existingFormats: ['docx', 'epub', 'pdf_xl'],
    })
    expect(formats).toContain('epub')
    expect(formats).toContain('pdf_xl')
  })

  it('never asks for the master, which is the input', () => {
    expect(formatsToBuild({ pendingFormats: ['docx'], existingFormats: ['docx'] })).not.toContain(
      'docx',
    )
  })

  it('ignores junk in the stored list', () => {
    expect(
      formatsToBuild({ pendingFormats: ['pdf_large', 'mobi', null, 7], existingFormats: [] }),
    ).toEqual(['pdf_large'])
  })

  it('does not repeat a format asked for twice', () => {
    expect(
      formatsToBuild({ pendingFormats: ['pdf_large', 'pdf_large'], existingFormats: [] }),
    ).toEqual(['pdf_large'])
  })
})

describe('what a converter is handed', () => {
  it('asks for one PDF when one was requested', () => {
    expect(
      claimFor({
        state: 'master_ready',
        hasOwner: true,
        reviewState: 'approved',
        pendingFormats: ['pdf_standard'],
        existingFormats: ['docx', 'epub'],
      }),
    ).toEqual({ kind: 'formats', formats: ['pdf_standard'] })
  })

  it('offers nothing for a resting book', () => {
    for (const state of ['ready', 'draft', 'failed', 'formatting', 'none'] as const) {
      expect(
        claimFor({
          state,
          hasOwner: false,
          reviewState: 'approved',
          pendingFormats: [],
          existingFormats: [],
        }),
      ).toBeNull()
    }
  })
})
