/**
 * What the converter is allowed to say about a book.
 *
 * The conversion service reports its results over HTTP, and those
 * results become the book's artifacts — the files readers are sent.
 * So the completion payload is untrusted input in the sense that
 * matters: it is authenticated, but a converter that has been tampered
 * with, or simply has a bug, must not be able to point one book's
 * artifacts at another book's files.
 *
 * These rules live here rather than in the route handler for the reason
 * every rule in this directory does (CLAUDE.md section 2.1): a check
 * buried in a route is exercised only by making an HTTP request, and a
 * security check nobody can test cheaply is one nobody tests.
 *
 * Framework-independent, like everything in `src/domain`.
 */

/**
 * The formats a book may have. Anything else is not ours to serve.
 *
 * One PDF, not three. `pdf_standard`, `pdf_large` and `pdf_xl` were the
 * same book rendered at three type sizes so a reader could choose their
 * typography — which is a job the EPUB does properly, by letting the
 * device decide. What replaced them is a single PDF that mirrors the
 * original's own layout, and for a PDF upload that *is* the uploaded
 * file (`domain/publication.ts`).
 *
 * `txt` joined them on 2026-08-26, and is never *generated* — nothing
 * builds a text file. It is only ever a plain text upload kept as
 * itself, which is what lets such a book be published as it stands the
 * way a PDF can be. It reflows, so unlike the PDF it is a perfectly good
 * thing to read and to send to a device; it simply carries no structure,
 * which is what converting it to an EPUB adds.
 */
export const ARTIFACT_FORMATS = ['docx', 'epub', 'pdf', 'txt'] as const

export type ArtifactFormat = (typeof ARTIFACT_FORMATS)[number]

export interface AcceptedArtifact {
  format: ArtifactFormat
  storageKey: string
  downloadable: boolean
}

/**
 * Every artifact lives under its own book's prefix.
 *
 * This is the containment boundary. A storage key is what the download
 * path streams, so a key naming another book's directory would let a
 * compromised converter serve a restricted book through a book the
 * reader is allowed to have.
 */
export function artifactPrefix(bookId: string | number): string {
  return `books/${bookId}/`
}

/**
 * Where a finished artifact lives.
 *
 * One level below `artifactPrefix`, and the difference matters. The
 * prefix is the *containment* boundary — broad enough to admit the cover
 * sitting directly under `books/{id}/` — while the artifacts themselves
 * go in `book/`, which is where every book already in R2 has them and
 * what CLAUDE.md section 14 draws. `originalKey` in `publication.ts`
 * arrives at the same layout from the other direction, and for a DOCX
 * upload the two name the same object: the upload is the master.
 */
export function artifactKey(bookId: string | number, filename: string): string {
  return `${artifactPrefix(bookId)}book/${filename}`
}

/**
 * Filter a converter's reported artifacts down to what may be stored.
 *
 * Silently dropping bad entries rather than rejecting the whole payload
 * is deliberate: a converter that reports four good formats and one
 * malformed key has still done four fifths of a useful job, and failing
 * the book entirely would mean re-running hours of OCR to recover it.
 * The caller decides what to do when nothing survives.
 */
export function acceptArtifacts({
  bookId,
  artifacts,
}: {
  bookId: string | number
  artifacts: unknown
}): AcceptedArtifact[] {
  if (typeof artifacts !== 'object' || artifacts === null) return []

  const prefix = artifactPrefix(bookId)
  const accepted: AcceptedArtifact[] = []

  for (const [format, key] of Object.entries(artifacts as Record<string, unknown>)) {
    if (!ARTIFACT_FORMATS.includes(format as ArtifactFormat)) continue
    if (typeof key !== 'string' || !key.startsWith(prefix)) continue

    // `books/3/../4/x` starts with the right prefix and resolves
    // somewhere else entirely. Object stores treat the key as an opaque
    // string, but anything that later maps it onto a path would not.
    if (key.includes('..')) continue

    accepted.push({
      format: format as ArtifactFormat,
      storageKey: key,
      // The DOCX master is the editorial source of truth, never a
      // reader download (CLAUDE.md section 5).
      downloadable: format !== 'docx',
    })
  }

  return accepted
}

/**
 * The page count a converter reported, or null if it is not usable.
 *
 * Page count sets the price, so a nonsense value is a nonsense charge.
 * Null means "leave what is already there", which for a new book means
 * the minimum price — the right way to fail.
 */
export function acceptPageCount(value: unknown): number | null {
  const pages = Number(value)
  if (!Number.isFinite(pages) || pages <= 0) return null
  // A book longer than this is a bug in the counter, not a book.
  if (pages > 100_000) return null
  return Math.round(pages)
}
