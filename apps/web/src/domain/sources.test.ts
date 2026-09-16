import { describe, expect, it } from 'vitest'

import {
  ADD_SOURCE_ERRORS,
  canAddSource,
  canMasterFrom,
  planIntake,
  hasSourceKind,
  masterSources,
  offersMasterChoice,
  readSources,
  selectedSource,
  switchedToSource,
} from './sources'

const scan = {
  kind: 'pdf' as const,
  storageKey: 'books/tao.pdf',
  filename: 'tao.pdf',
  bytes: 120,
  addedAt: '2026-09-14T00:00:00.000Z',
}

const typed = {
  kind: 'text' as const,
  storageKey: 'books/tao.txt',
  filename: 'tao.txt',
  bytes: 9,
  addedAt: '2026-09-14T01:00:00.000Z',
}

describe('reading a book’s sources', () => {
  it('reads the stored list', () => {
    const sources = readSources({ sources: [scan, typed], sourceKind: 'pdf' })
    expect(sources.map((source) => source.kind)).toEqual(['pdf', 'text'])
    expect(sources[0]!.storageKey).toBe('books/tao.pdf')
  })

  it('synthesizes the single source of a book written before the list existed', () => {
    const sources = readSources({
      sourceKind: 'pdf',
      sourceKey: 'conversion/abc/input/source.pdf',
      sourceFilename: '道德經.pdf',
    })
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      kind: 'pdf',
      storageKey: 'conversion/abc/input/source.pdf',
      filename: '道德經.pdf',
    })
  })

  it('falls back to the filename for the kind, as readSourceKind does', () => {
    expect(readSources({ sourceKey: 'k', sourceFilename: 'notes.txt' })[0]!.kind).toBe('text')
  })

  it('says a book with nothing at all has no sources', () => {
    expect(readSources({})).toEqual([])
    expect(readSources(null)).toEqual([])
    expect(readSources({ sourceKind: 'pdf' })).toEqual([])
  })

  it('drops entries that name no file', () => {
    expect(readSources({ sources: [{ kind: 'pdf' }, { storageKey: 'x' }, scan] })).toEqual([
      scan,
    ])
  })

  it('keeps only the first of a repeated kind', () => {
    const sources = readSources({
      sources: [scan, { ...scan, storageKey: 'books/other.pdf', filename: 'other.pdf' }],
    })
    expect(sources).toHaveLength(1)
    expect(sources[0]!.filename).toBe('tao.pdf')
  })
})

describe('which source the master comes from', () => {
  it('will build a master from anything but an EPUB', () => {
    expect(canMasterFrom('pdf')).toBe(true)
    expect(canMasterFrom('text')).toBe(true)
    expect(canMasterFrom('docx')).toBe(true)
    expect(canMasterFrom('epub')).toBe(false)
  })

  it('offers a choice only when there is more than one candidate', () => {
    expect(offersMasterChoice([scan])).toBe(false)
    expect(offersMasterChoice([scan, typed])).toBe(true)
  })

  it('does not count an EPUB towards the choice', () => {
    const edition = { kind: 'epub' as const, storageKey: 'books/tao.epub', filename: 'tao.epub' }
    expect(masterSources([scan, edition])).toEqual([scan])
    expect(offersMasterChoice([scan, edition])).toBe(false)
  })

  it('finds the source the pipeline is reading', () => {
    expect(selectedSource({ sources: [scan, typed], sourceKind: 'text' })).toEqual(typed)
  })

  it('returns nothing when the chosen kind is not among the files', () => {
    expect(selectedSource({ sources: [scan], sourceKind: 'docx' })).toBeNull()
  })

  it('knows which kinds a book holds', () => {
    expect(hasSourceKind([scan, typed], 'text')).toBe(true)
    expect(hasSourceKind([scan], 'text')).toBe(false)
  })
})

describe('adding a source', () => {
  it('accepts a kind whose slot is free', () => {
    expect(canAddSource({ kind: 'text', existingFormats: ['pdf', 'docx', 'epub'] })).toEqual({
      allowed: true,
      slot: 'txt',
    })
  })

  it('refuses a kind whose slot is taken', () => {
    const decision = canAddSource({ kind: 'pdf', existingFormats: ['pdf'] })
    expect(decision).toEqual({ allowed: false, reason: 'slot_taken' })
  })

  it('refuses a generated EPUB’s slot as firmly as an uploaded one', () => {
    expect(canAddSource({ kind: 'epub', existingFormats: ['pdf', 'docx', 'epub'] })).toEqual({
      allowed: false,
      reason: 'slot_taken',
    })
  })

  it('sends a DOCX at an existing master to the replace control instead', () => {
    const decision = canAddSource({ kind: 'docx', existingFormats: ['docx'] })
    expect(decision).toEqual({ allowed: false, reason: 'master_exists' })
    expect(ADD_SOURCE_ERRORS.master_exists).toMatch(/Replace and rebuild/)
  })

  it('accepts a DOCX when there is no master yet', () => {
    expect(canAddSource({ kind: 'docx', existingFormats: ['pdf'] })).toEqual({
      allowed: true,
      slot: 'docx',
    })
  })

  it('has a sentence for every refusal', () => {
    for (const reason of ['unsupported', 'slot_taken', 'master_exists'] as const) {
      expect(ADD_SOURCE_ERRORS[reason]).toBeTruthy()
    }
  })
})

describe('switching to another source', () => {
  it('names the new file and clears the old file’s hash', () => {
    expect(switchedToSource(typed)).toEqual({
      sourceKind: 'text',
      sourceKey: 'books/tao.txt',
      sourceFilename: 'tao.txt',
      sourceHash: null,
    })
  })
})

describe('reconciling a source against where the file actually is', () => {
  it('repoints a legacy entry at the artifact it was filed as', () => {
    const sources = readSources(
      {
        sourceKind: 'pdf',
        sourceKey: 'conversion/abc/input/source.pdf',
        sourceFilename: 'tao.pdf',
      },
      [{ format: 'pdf', storageKey: 'books/tao.pdf', bytes: 4096 }],
    )
    expect(sources[0]!.storageKey).toBe('books/tao.pdf')
    expect(sources[0]!.bytes).toBe(4096)
  })

  it('leaves an entry alone when its slot has not been filed', () => {
    const sources = readSources(
      { sourceKind: 'pdf', sourceKey: 'conversion/abc/input/source.pdf' },
      [],
    )
    expect(sources[0]!.storageKey).toBe('conversion/abc/input/source.pdf')
  })

  it('does not confuse one slot for another', () => {
    const sources = readSources({ sources: [scan, typed] }, [
      { format: 'pdf', storageKey: 'books/tao.pdf' },
    ])
    expect(sources.map((source) => source.storageKey)).toEqual([
      'books/tao.pdf',
      'books/tao.txt',
    ])
  })

  it('keeps the source’s own byte count over the artifact’s', () => {
    const sources = readSources({ sources: [scan] }, [
      { format: 'pdf', storageKey: 'books/tao.pdf', bytes: 999 },
    ])
    expect(sources[0]!.bytes).toBe(120)
  })
})

describe('planIntake', () => {
  const file = (name: string, kind: 'pdf' | 'docx' | 'epub' | 'text' | null) => ({ name, kind })

  it('puts a DOCX first, because a Word file is already the master', () => {
    const plan = planIntake([file('scan.pdf', 'pdf'), file('typed.docx', 'docx')])
    expect(plan.ok && plan.ordered.map((entry) => entry.name)).toEqual([
      'typed.docx',
      'scan.pdf',
    ])
  })

  it('puts the scan ahead of a transcription when there is no master', () => {
    const plan = planIntake([file('typed.txt', 'text'), file('scan.pdf', 'pdf')])
    expect(plan.ok && plan.ordered.map((entry) => entry.name)).toEqual([
      'scan.pdf',
      'typed.txt',
    ])
  })

  it('takes one file of each kind at once', () => {
    const plan = planIntake([
      file('book.epub', 'epub'),
      file('typed.txt', 'text'),
      file('scan.pdf', 'pdf'),
      file('master.docx', 'docx'),
    ])
    expect(plan.ok && plan.ordered.map((entry) => entry.kind)).toEqual([
      'docx',
      'pdf',
      'text',
      'epub',
    ])
  })

  it('refuses a second file of a kind, naming the one it refused', () => {
    const plan = planIntake([file('scan.pdf', 'pdf'), file('other.pdf', 'pdf')])
    expect(plan).toEqual({ ok: false, reason: 'duplicate_kind', name: 'other.pdf' })
  })

  it('refuses a file it cannot place', () => {
    const plan = planIntake([file('scan.pdf', 'pdf'), file('notes.rtf', null)])
    expect(plan).toEqual({ ok: false, reason: 'unsupported', name: 'notes.rtf' })
  })

  it('leaves a single file alone', () => {
    const plan = planIntake([file('scan.pdf', 'pdf')])
    expect(plan.ok && plan.ordered).toHaveLength(1)
  })
})
