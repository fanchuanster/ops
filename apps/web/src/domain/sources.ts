/**
 * The files a book was made from, when there is more than one.
 *
 * A book used to have exactly one source: the file its uploader chose,
 * recorded as `conversion.sourceKind` / `sourceKey` / `sourceFilename`,
 * and every branch in the pipeline read those three fields. That is
 * still true of most books and is still how the pipeline reads the
 * source it is working on — what changes here is that a book may now
 * hold several, and that **which one the DOCX master is built from is a
 * choice its owner makes** rather than a fact settled at upload.
 *
 * The case that asks for it is ordinary. Someone preserving a book
 * frequently has the scan *and* a plain-text transcription of it —
 * their own typing, or one that circulates beside the scan. Adobe
 * reading the scan costs money, takes minutes and gets characters
 * wrong; the transcription is free, instant and right. Under one source
 * per book the uploader had to pick before they had seen either result,
 * and picking wrong meant a second upload and a second book.
 *
 * ## What a source is, and what it is not
 *
 * A source is an uploaded original. It is not an *edition*: the EPUB
 * phase 2 builds is not a source, and neither is a master Adobe
 * returned. That distinction cannot be recovered from the artifact list
 * — `docx` and `epub` are each sometimes an upload and sometimes
 * generated — which is why the list is stored rather than derived.
 *
 * ## One source per artifact slot
 *
 * A book's objects are named by format, not by upload
 * (`domain/bookStorage.ts`): there is one `books/{stem}.pdf`, one
 * `.docx`, one `.epub`, one `.txt`. An uploaded original *is* the
 * artifact in its slot (`originalArtifact` in `domain/publication.ts`),
 * so two PDFs on one book would be two files competing for one name.
 *
 * So the rule is simply that a source may be added when its slot is
 * free — which is the same sentence as "a book holds at most one source
 * of each kind", said in terms of the thing that actually constrains
 * it. A reader who genuinely has two different scans of the same work
 * has two editions, and editions are separate books.
 *
 * Framework-independent, like everything in `src/domain`.
 */

import type { ArtifactFormat } from './conversion'
import { type SourceKind, originalArtifact, readSourceKind } from './publication'

/**
 * One uploaded original, as the book records it.
 *
 * `storageKey` is where the file lives **under the book** — the
 * `books/{stem}.{ext}` key, not the `conversion/{job}/input/` key it
 * arrived at. The latter is swept by the R2 lifecycle rule after 30
 * days, so a list of sources pointing at it would quietly empty itself
 * a month after upload.
 */
export interface BookSource {
  kind: SourceKind
  storageKey: string
  /** The name the uploader's own file had, which is what they recognise it by. */
  filename: string
  bytes?: number | null
  addedAt?: string | null
}

/** The shape the conversion group presents to everything here. */
interface ConversionLike {
  sources?: unknown
  sourceKind?: unknown
  sourceKey?: unknown
  sourceFilename?: unknown
}

function isKind(value: unknown): value is SourceKind {
  return value === 'pdf' || value === 'docx' || value === 'epub' || value === 'text'
}

function readEntry(value: unknown): BookSource | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (!isKind(row.kind)) return null
  if (typeof row.storageKey !== 'string' || row.storageKey.length === 0) return null
  return {
    kind: row.kind,
    storageKey: row.storageKey,
    filename: typeof row.filename === 'string' ? row.filename : '',
    bytes: typeof row.bytes === 'number' ? row.bytes : null,
    addedAt: typeof row.addedAt === 'string' ? row.addedAt : null,
  }
}

/** As much of an artifact as deciding where a source really lives needs. */
interface ArtifactLike {
  format?: string | null
  storageKey?: string | null
  bytes?: number | null
}

/**
 * Every source this book holds.
 *
 * **The legacy fallback is the important half.** Every book uploaded
 * before this list existed has one source and an empty array, and so
 * does every draft — the array is written when a file is *filed* under
 * the book, which happens as the book leaves `draft`. Synthesizing the
 * entry from the three `source*` fields is what lets one reader with
 * one file go on being a book with one source, with nothing migrated
 * and no row rewritten.
 *
 * Which is also why every writer composes from this rather than from
 * the stored array: appending to an empty array on a book that plainly
 * has a source would lose the source it has.
 *
 * ## Why `artifacts` is worth passing
 *
 * **An uploaded original *is* the artifact in its slot**, so the book's
 * artifact list is the authority on where that file actually lives, and
 * passing it is what keeps a synthesized entry honest. `sourceKey` on a
 * book filed before this existed still points into the `conversion/`
 * prefix the R2 lifecycle rule sweeps after 30 days — harmless while
 * nothing but a filename was read off it, and a live hazard the moment
 * that key can be persisted into the list and switched back to later.
 *
 * The reconciliation is a repair, not a lookup: an entry written by
 * `fileUnderBook` already names its slot's key and the two agree. It is
 * cheap enough to do unconditionally, and doing it unconditionally is
 * what stops the two ever drifting.
 *
 * Deduplicated by kind, first entry winning, because the slot rule says
 * there can only be one of each and a list that disagreed with that
 * would offer the same choice twice.
 */
export function readSources(
  conversion: ConversionLike | null | undefined,
  artifacts?: readonly ArtifactLike[] | null,
): BookSource[] {
  const stored = Array.isArray(conversion?.sources)
    ? conversion.sources.map(readEntry).filter((entry): entry is BookSource => entry !== null)
    : []

  const seen = new Set<SourceKind>()
  const sources = stored.filter((entry) => {
    if (seen.has(entry.kind)) return false
    seen.add(entry.kind)
    return true
  })

  if (sources.length === 0) {
    const storageKey = typeof conversion?.sourceKey === 'string' ? conversion.sourceKey : ''
    if (!storageKey) return []
    sources.push({
      kind: readSourceKind(conversion ?? {}),
      storageKey,
      filename:
        typeof conversion?.sourceFilename === 'string' ? conversion.sourceFilename : '',
      bytes: null,
      addedAt: null,
    })
  }

  if (!artifacts) return sources
  return sources.map((source) => {
    const slot = originalArtifact(source.kind)
    const filed = artifacts.find(
      (artifact) =>
        artifact?.format === slot &&
        typeof artifact.storageKey === 'string' &&
        artifact.storageKey.length > 0,
    )
    if (!filed) return source
    return {
      ...source,
      storageKey: filed.storageKey as string,
      bytes: source.bytes ?? filed.bytes ?? null,
    }
  })
}

/**
 * Can a DOCX master be built from this kind of file at all?
 *
 * Everything except an EPUB. A PDF goes to Adobe, a plain text file is
 * parsed into a document by the runner, and a DOCX upload *is* a master
 * already. An EPUB is the reading edition — converting one back into a
 * master and rendering it forward again can only lose, which is why
 * `formatsToGenerate` gives an EPUB source nothing to build.
 */
export function canMasterFrom(kind: SourceKind): boolean {
  return kind !== 'epub'
}

/** The sources a master could be built from, in the order they are held. */
export function masterSources(sources: readonly BookSource[]): BookSource[] {
  return sources.filter((source) => canMasterFrom(source.kind))
}

/**
 * Is there a choice of master source to offer?
 *
 * Two or more, because one is not a choice — a book with a single
 * source is shown what will happen to it, not asked to pick it out of a
 * list of one. The same rule the publication plan follows
 * (`BookDetailsForm`).
 */
export function offersMasterChoice(sources: readonly BookSource[]): boolean {
  return masterSources(sources).length > 1
}

/** The source the pipeline is currently reading, if the book still holds it. */
export function selectedSource(
  conversion: ConversionLike | null | undefined,
): BookSource | null {
  const kind = readSourceKind(conversion ?? {})
  return readSources(conversion).find((source) => source.kind === kind) ?? null
}

/** Does this book already hold a source of this kind? */
export function hasSourceKind(
  sources: readonly BookSource[],
  kind: SourceKind,
): boolean {
  return sources.some((source) => source.kind === kind)
}

export type AddSourceRefusal = 'unsupported' | 'slot_taken' | 'master_exists'

export type AddSourceDecision =
  | { allowed: true; slot: ArtifactFormat }
  | { allowed: false; reason: AddSourceRefusal }

/**
 * May this book take another file of this kind?
 *
 * Keyed on the book's **artifacts** rather than on its source list, and
 * that is the whole point: the constraint is the storage slot, so a
 * generated EPUB blocks an uploaded one exactly as an uploaded one
 * would. Asking the source list instead would let a second file be
 * accepted and then silently overwrite an edition readers already have.
 *
 * `master_exists` is the same refusal wearing a different sentence. A
 * DOCX upload is a master, and a book that already has one is asking to
 * have its master *replaced* — which has its own control, its own
 * consequences (the formats are rebuilt from it) and its own copy
 * (`MasterFile`). Sending someone there is more useful than telling
 * them the slot is full.
 */
export function canAddSource({
  kind,
  existingFormats,
}: {
  kind: SourceKind
  existingFormats: readonly unknown[]
}): AddSourceDecision {
  const slot = originalArtifact(kind)
  if (!slot) return { allowed: false, reason: 'unsupported' }
  if (existingFormats.includes(slot)) {
    return { allowed: false, reason: slot === 'docx' ? 'master_exists' : 'slot_taken' }
  }
  return { allowed: true, slot }
}

/** What a refused upload should tell the person who chose the file. */
export const ADD_SOURCE_ERRORS: Record<AddSourceRefusal, string> = {
  unsupported: 'Add a PDF, a DOCX, an EPUB, or a plain text file.',
  slot_taken:
    'This book already has a file of that type. A different scan or edition is a book of its own — upload it as one.',
  master_exists:
    'This book already has a DOCX master. Use “Replace and rebuild” below to put a corrected Word file in its place.',
}

/**
 * What the pipeline should be told to read, given a newly chosen source.
 *
 * Returned as fields to merge over the stored conversion group rather
 * than as a whole group, so the caller keeps everything this does not
 * speak for — the plan, the AI answer, the job id.
 *
 * The clearing is the substance. `sourceHash` is the SHA-256 of the file
 * Adobe was sent, and it is what lets a byte-identical upload skip the
 * export (`alreadyExported` in `lib/masterPipeline.ts`); left in place
 * over a *different* file it would hand this book someone else's master.
 * That is the one mistake here that produces a finished, plausible,
 * completely wrong book, so it is cleared in the same expression that
 * changes the source rather than anywhere a later edit could separate
 * them.
 */
export function switchedToSource(source: BookSource): {
  sourceKind: SourceKind
  sourceKey: string
  sourceFilename: string
  sourceHash: null
} {
  return {
    sourceKind: source.kind,
    sourceKey: source.storageKey,
    sourceFilename: source.filename,
    sourceHash: null,
  }
}
