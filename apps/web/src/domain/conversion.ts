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

/*
 * `artifactPrefix`, `artifactKey` and `acceptArtifacts` stood here
 * until 2026-08-26 and are deleted.
 *
 * They were the containment boundary: a converter running elsewhere
 * reported the keys it had written, and `acceptArtifacts` refused any
 * that named a directory other than `books/{id}/` — because a key
 * pointing into another book would serve a restricted book through one
 * the reader is allowed to have.
 *
 * There is no converter (section 13). Keys are minted in the Worker by
 * `domain/bookStorage.ts` and never arrive from outside, so the check
 * had nothing left to check and the prefix had nothing left to enforce.
 * Deleting a boundary is worth being explicit about: what makes it safe
 * is not that the rule became unnecessary, but that the untrusted input
 * it guarded no longer exists.
 */

export function acceptPageCount(value: unknown): number | null {
  const pages = Number(value)
  if (!Number.isFinite(pages) || pages <= 0) return null
  // A book longer than this is a bug in the counter, not a book.
  if (pages > 100_000) return null
  return Math.round(pages)
}
