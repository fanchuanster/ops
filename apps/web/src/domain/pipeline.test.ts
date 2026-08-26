/**
 * The two-phase pipeline.
 *
 * The behaviour worth protecting is that correcting a DOCX master costs
 * a rebuild of the formats and nothing else. Everything about the shape
 * of these states exists to make that true — if editing a master ever
 * re-ran the export, the project would be paying Adobe again to re-read
 * pages it had already read, and discarding the correction that
 * prompted it.
 */

import { describe, expect, it } from 'vitest'

import {
  type ConversionState,
  claimableAs,
  completedState,
  hasMaster,
  inProgressState,
  claimFor,
  formatsToBuild,
  isConversionState,
  isInFlight,
  needsMasterRun,
  recoversFromFailure,
  retryStateFor,
  stateAfterMasterEdit,
  uploadStep,
} from './pipeline'

describe('a failure nothing will retry', () => {
  it('rescues a book published as it stands', () => {
    // The bug: a text upload was converted by default, a converter
    // refused it, and switching it to "as it stands" left it failed —
    // unreadable and unsubmittable over a conversion nobody wanted.
    expect(
      recoversFromFailure({ state: 'failed', sourceKind: 'text', plan: 'as_is' }),
    ).toBe(true)
    expect(recoversFromFailure({ state: 'failed', sourceKind: 'pdf', plan: 'as_is' })).toBe(true)
    expect(recoversFromFailure({ state: 'failed', sourceKind: 'epub', plan: 'as_is' })).toBe(true)
  })

  it('leaves a failure alone while the book still wants converting', () => {
    expect(recoversFromFailure({ state: 'failed', sourceKind: 'text', plan: 'convert' })).toBe(
      false,
    )
    expect(recoversFromFailure({ state: 'failed', sourceKind: 'docx', plan: 'convert' })).toBe(
      false,
    )
  })

  it('never re-settles a finished book', () => {
    // A converted book flipped back to `as_is` is a metadata change, not
    // a request to rebuild anything — its EPUB may already have been
    // sent to somebody's device.
    expect(recoversFromFailure({ state: 'ready', sourceKind: 'pdf', plan: 'as_is' })).toBe(false)
    expect(recoversFromFailure({ state: 'queued', sourceKind: 'text', plan: 'as_is' })).toBe(false)
  })
})

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

describe('deciding to start an export', () => {
  it('runs for a freshly queued book', () => {
    expect(needsMasterRun({ state: 'queued' })).toBe(true)
  })

  it('does not start a second export for one already running', () => {
    // A retried poll must not submit the same book again -- that is a
    // second Adobe bill for one book.
    expect(
      needsMasterRun({ state: 'queued', exportJob: 'https://pdf-services.adobe.io/ops/id/abc' }),
    ).toBe(false)
  })

  it('does not run for a book past phase 1', () => {
    expect(needsMasterRun({ state: 'master_ready' })).toBe(false)
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

describe('review does not stand in front of phase 2', () => {
  /*
   * Phase 2 was held until an administrator approved the book, until
   * 2026-08-17. The gate was the wrong way round: what a reviewer reads
   * is the finished EPUB, so holding the EPUB for the review left them
   * nothing to read -- and an uploader who never submitted their private
   * book, which section 6.2 explicitly permits, could never read it at
   * all. Publication is where review belongs, and the Books collection
   * is where it is enforced.
   */
  it('builds the formats for an unsubmitted private upload', () => {
    expect(claimFor({ state: 'master_ready', sourceKind: 'pdf', existingFormats: [] })).toEqual({
      kind: 'formats',
      formats: ['epub'],
    })
  })

  it('offers phase 1 the same as it always did', () => {
    expect(claimFor({ state: 'ocr_ready', sourceKind: 'text', existingFormats: [] })).toEqual({
      kind: 'master',
      formats: [],
    })
  })

  it('offers nothing from a state that is not a phase boundary', () => {
    for (const state of ['queued', 'ocr', 'mastering', 'formatting', 'ready'] as const) {
      expect(claimFor({ state, sourceKind: 'pdf', existingFormats: [] })).toBeNull()
    }
  })

  it('does not treat a book at the hinge as in flight', () => {
    // Nothing is running at `master_ready` -- a converter has to claim
    // it. That was true when review held it there and stays true now.
    expect(isInFlight('master_ready')).toBe(false)
  })
})

describe('choosing which formats to build', () => {
  it('builds only the EPUB for a scanned PDF', () => {
    // The book's PDF is the scan itself, so rendering one from the
    // master would replace a faithful picture of the original with
    // something that looks nothing like it.
    expect(formatsToBuild({ sourceKind: 'pdf', existingFormats: [] })).toEqual(['epub'])
  })

  it('builds only the EPUB for a DOCX upload', () => {
    // Not a PDF as well. Nothing renders one from a master any more —
    // that was our own typography frozen flat, strictly worse than the
    // EPUB beside it (`domain/publication.ts`).
    expect(formatsToBuild({ sourceKind: 'docx', existingFormats: [] })).toEqual(['epub'])
  })

  it('builds nothing for an EPUB upload, and so is not claimable', () => {
    // It is already the reading edition. Handing a converter an empty
    // job list would have it report success on work it never did.
    expect(formatsToBuild({ sourceKind: 'epub', existingFormats: [] })).toEqual([])
    expect(claimFor({ state: 'master_ready', sourceKind: 'epub', existingFormats: [] })).toBeNull()
  })

  it('rebuilds everything the book already has when the master is edited', () => {
    // The reason this matters: an EPUB built from the old master still
    // carries the errors the edit removed, and nothing would ever
    // rebuild it if only the missing formats were regenerated.
    const formats = formatsToBuild({ sourceKind: 'docx', existingFormats: ['docx', 'epub'] })
    expect(formats).toContain('epub')
  })

  it('never rebuilds a PDF a book still carries, because none was built', () => {
    // A `pdf` on a DOCX-sourced book could only be a rendering from
    // before 2026-08-26. It is left exactly where it is: still
    // downloadable, never regenerated, and not treated as work.
    expect(
      formatsToBuild({ sourceKind: 'docx', existingFormats: ['docx', 'epub', 'pdf'] }),
    ).toEqual(['epub'])
  })

  it('never asks for the master, which is the input', () => {
    expect(formatsToBuild({ sourceKind: 'docx', existingFormats: ['docx'] })).not.toContain('docx')
  })

  it('ignores junk, and the retired PDF variants, in the stored list', () => {
    expect(
      formatsToBuild({ sourceKind: 'pdf', existingFormats: ['mobi', null, 7, 'pdf_large'] }),
    ).toEqual(['epub'])
  })

  it('does not give a PDF source a rendered PDF, even if one is listed', () => {
    // A stale row from before the split. The source rule wins.
    expect(formatsToBuild({ sourceKind: 'pdf', existingFormats: ['epub', 'pdf'] })).toEqual(['epub'])
  })
})

describe('what a converter is handed', () => {
  it('offers nothing for a resting book', () => {
    for (const state of ['ready', 'draft', 'failed', 'formatting', 'none'] as const) {
      expect(claimFor({ state, sourceKind: 'pdf', existingFormats: [] })).toBeNull()
    }
  })
})

describe('which step of the flow a book is standing on', () => {
  it('starts on Upload while it is still a draft', () => {
    expect(uploadStep({ state: 'draft' })).toBe(0)
  })

  it('sits on Process for everything the converter is doing', () => {
    for (const state of ['queued', 'ocr', 'ocr_ready', 'mastering', 'master_ready', 'formatting'] as const) {
      expect(uploadStep({ state })).toBe(1)
    }
  })

  // A failure belongs to the phase that was running, not to a step of
  // its own — that is the phase the reader will restart.
  it('keeps a failure on Process rather than inventing a step', () => {
    expect(uploadStep({ state: 'failed' })).toBe(1)
  })

  it('reaches Review once there is something to judge', () => {
    expect(uploadStep({ state: 'ready' })).toBe(2)
    expect(uploadStep({ state: 'ready', reviewState: 'submitted' })).toBe(2)
    expect(uploadStep({ state: 'ready', reviewState: 'rejected' })).toBe(2)
  })

  // Submitting is optional (CLAUDE.md section 6.2), so a private upload
  // may sit at Review forever. Lighting Publish for it would claim
  // something of a book its owner never offered to anyone.
  it('reaches Publish only on an approved review', () => {
    expect(uploadStep({ state: 'ready', reviewState: 'approved' })).toBe(3)
    expect(uploadStep({ state: 'none', reviewState: 'unsubmitted' })).toBe(2)
  })
})
