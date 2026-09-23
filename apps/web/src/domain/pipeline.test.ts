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
  releasedExportHandle,
  retryStateFor,
  stateAfterMasterEdit,
  statusOnQueue,
  uploadStep,
} from './pipeline'

describe('a failure nothing will retry', () => {
  it('rescues a book published as it stands', () => {
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
    expect(recoversFromFailure({ state: 'ready', sourceKind: 'pdf', plan: 'as_is' })).toBe(false)
    expect(recoversFromFailure({ state: 'queued', sourceKind: 'text', plan: 'as_is' })).toBe(false)
  })
})

describe('entering the queue does not take a book out of the library', () => {
  it('keeps a book that already has an edition published', () => {
    expect(statusOnQueue(['pdf'])).toBe('published')
    expect(statusOnQueue(['txt'])).toBe('published')
    expect(statusOnQueue(['epub', 'docx'])).toBe('published')
  })

  it('says in production while there is nothing to read', () => {
    expect(statusOnQueue([])).toBe('in_production')
  })

  it('does not count the master as an edition', () => {
    expect(statusOnQueue(['docx'])).toBe('in_production')
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
  it('moves off the claimable state in both phases', () => {
    for (const state of ['ocr_ready', 'master_ready'] as ConversionState[]) {
      const kind = claimableAs(state)!
      expect(inProgressState(kind)).not.toBe(state)
    }
  })
})

describe('finishing a phase', () => {
  it('does not call a book ready when only the master is built', () => {
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
    expect(
      needsMasterRun({ state: 'queued', exportJob: 'https://pdf-services.adobe.io/ops/id/abc' }),
    ).toBe(false)
  })

  it('does not run for a book past phase 1', () => {
    expect(needsMasterRun({ state: 'master_ready' })).toBe(false)
  })
})

describe('putting a book back in the queue', () => {
  const JOB = 'https://pdf-services.adobe.io/ops/id/abc'

  it('drops the handle from the export that failed', () => {
    expect(releasedExportHandle('queued')).toEqual({
      exportJob: null,
      exportAsset: null,
      exportStartedAt: null,
      exportRetries: 0,
    })
  })

  it('gives a hand-requeued book a fresh automatic retry budget', () => {
    expect(releasedExportHandle('queued').exportRetries).toBe(0)
  })

  it('makes a re-queued book startable again', () => {
    const conversion = { state: 'queued' as const, exportJob: JOB }
    expect(needsMasterRun(conversion)).toBe(false)
    expect(needsMasterRun({ ...conversion, ...releasedExportHandle('queued') })).toBe(true)
  })

  it('leaves a running export alone', () => {
    expect(releasedExportHandle('ocr')).toEqual({})
    expect(releasedExportHandle('master_ready')).toEqual({})
    expect(releasedExportHandle('ready')).toEqual({})
    expect(releasedExportHandle('failed')).toEqual({})
  })
})

describe('retrying a failure', () => {
  it('rebuilds only the formats when a master survived', () => {
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
    expect(isInFlight('master_ready')).toBe(false)
  })
})

describe('choosing which formats to build', () => {
  it('builds only the EPUB for a scanned PDF', () => {
    expect(formatsToBuild({ sourceKind: 'pdf', existingFormats: [] })).toEqual(['epub'])
  })

  it('builds only the EPUB for a DOCX upload', () => {
    expect(formatsToBuild({ sourceKind: 'docx', existingFormats: [] })).toEqual(['epub'])
  })

  it('builds nothing for an EPUB upload, and so is not claimable', () => {
    expect(formatsToBuild({ sourceKind: 'epub', existingFormats: [] })).toEqual([])
    expect(claimFor({ state: 'master_ready', sourceKind: 'epub', existingFormats: [] })).toBeNull()
  })

  it('rebuilds everything the book already has when the master is edited', () => {
    const formats = formatsToBuild({ sourceKind: 'docx', existingFormats: ['docx', 'epub'] })
    expect(formats).toContain('epub')
  })

  it('never rebuilds a PDF a book still carries, because none was built', () => {
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
  it('sits on Process once the file is uploaded and its details are being filled', () => {
    expect(uploadStep({})).toBe(1)
    expect(uploadStep({ reviewState: 'unsubmitted' })).toBe(1)
  })

  it('reaches Submit while an editor is deciding', () => {
    expect(uploadStep({ reviewState: 'submitted' })).toBe(2)
  })

  it('sends a rejection back to Process to be revised', () => {
    expect(uploadStep({ reviewState: 'rejected' })).toBe(1)
  })

  it('completes every step once approved', () => {
    expect(uploadStep({ reviewState: 'approved' })).toBe(3)
  })
})
