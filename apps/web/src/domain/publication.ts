/**
 * What a book is made of, and which path it takes to get there.
 *
 * Every book ends up with the same small set of files:
 *
 *   the original      preserved, whatever it was
 *   the DOCX master   the editorial source of truth, owner-only
 *   the EPUB          the reading edition
 *   one PDF           mirroring the original's own layout
 *
 * The PDF used to be three — standard, large and extra large, rendered
 * from the master at different type sizes so a reader could pick their
 * typography. That is gone. It was solving a problem the EPUB already
 * solves better: a reflowable book lets the *device* set the type size,
 * so rendering three fixed alternatives was three answers to a question
 * nobody needed asked. What a PDF is actually good for is being a
 * faithful picture of the original, and there is only one of those.
 *
 * The consequence worth stating: **for a PDF upload, the PDF artifact is
 * the uploaded file itself.** Nothing renders it, nothing can drift from
 * it, and it costs no conversion time. Fidelity to the original is free
 * when you stop trying to improve on it.
 *
 * Framework-independent, like everything in `src/domain`.
 */

import type { ArtifactFormat } from './conversion'

/**
 * What kind of file was uploaded.
 *
 * These are the shapes the pipeline branches on, not a MIME taxonomy —
 * which is why `text` covers both plain text and Markdown, and why an
 * unrecognised file is `null` rather than a fifth kind.
 */
export type SourceKind = 'pdf' | 'docx' | 'epub' | 'text'

/**
 * The largest file the portal accepts, in bytes.
 *
 * Lives here rather than in the upload route because two places need
 * the same number and they must not drift: the route rejects above it,
 * and the form says so before a byte is sent.
 *
 * **100 MB, and three separate ceilings now agree on it**, which is why
 * it is the right place to stop rather than a round number:
 *
 *   - Cloudflare caps a Worker request body at 100 MB on Free and Pro.
 *     Above that the request never reaches our code, so no message we
 *     could write would ever be shown.
 *   - Adobe's Export PDF refuses a source over 100 MB
 *     (`MAX_SOURCE_BYTES`, `domain/adobe.ts`). A larger scan could be
 *     stored but never read into a master, so it could only ever be
 *     published as it stands — no EPUB, which is the opposite of what
 *     the portal is for.
 *   - Worker memory is 128 MB for everything, which used to be the
 *     binding constraint and no longer is. See below.
 *
 * It was **64 MB** until 2026-08-24, and that number was a memory bound:
 * uploads arrived through a Next server action, which parses the whole
 * request as `FormData` and therefore holds the file in memory before
 * any of our code runs. Half the Worker's budget was as far as that
 * could be pushed.
 *
 * Uploads no longer go through a server action. `api/upload/route.ts`
 * takes the file as the raw request body and pipes it straight into R2,
 * so the bytes are never all resident at once and memory stops being
 * the thing that decides this number. That is what raising it required
 * — the constant on its own would only have moved the failure from a
 * clear refusal to an out-of-memory.
 *
 * Going higher means a Cloudflare Business plan (200 MB) *and* an
 * answer for PDFs Adobe will not read. Neither is a code change.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

/** The limit as a human sees it: "100 MB". */
export const MAX_UPLOAD_LABEL = `${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`

const BY_MIME: Record<string, SourceKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/epub+zip': 'epub',
  'text/plain': 'text',
  'text/markdown': 'text',
}

const BY_EXTENSION: Record<string, SourceKind> = {
  pdf: 'pdf',
  docx: 'docx',
  epub: 'epub',
  txt: 'text',
  md: 'text',
}

/**
 * Classify a source, by declared type first and by extension after.
 *
 * The extension is the fallback rather than the rule because a browser
 * that declares `application/pdf` is more reliable than a filename, and
 * `application/octet-stream` — which is what several browsers send for
 * EPUB — carries no information at all.
 */
export function sourceKindOf(filename: string, mimeType?: string | null): SourceKind | null {
  if (mimeType) {
    const byMime = BY_MIME[mimeType]
    if (byMime) return byMime
  }
  const extension = filename.trim().toLowerCase().split('.').pop() ?? ''
  return BY_EXTENSION[extension] ?? null
}

/**
 * What an uploader has decided to do with their file.
 *
 * `convert` produces the full set — master, EPUB, PDF. `as_is` publishes
 * the uploaded file and builds nothing.
 */
export type PublicationPlan = 'convert' | 'as_is'

/**
 * Which plans this kind of source can honestly offer.
 *
 * Only a PDF gets a real choice, and it is a real one: a scan has to be
 * read before it can reflow, which costs money and time and can go
 * wrong, while a born-digital PDF may already be perfectly good as it
 * stands. Nobody but the uploader can weigh that.
 *
 * The others have no choice to offer, in both directions:
 *
 *  - A **DOCX is already the master**, so there is nothing to convert
 *    *to*. It goes straight to building the EPUB and the PDF.
 *  - An **EPUB is already the reading edition**. Converting it would
 *    mean parsing a reflowable book into a DOCX and rendering it back,
 *    which can only lose.
 *  - **Text** has no layout of its own, so publishing it as it stands
 *    would be publishing a .txt file. It is always converted.
 */
export function plansFor(kind: SourceKind): PublicationPlan[] {
  switch (kind) {
    case 'pdf':
      return ['convert', 'as_is']
    case 'epub':
      return ['as_is']
    default:
      return ['convert']
  }
}

/**
 * The plan to take when the uploader has not chosen, or chose something
 * this source cannot do.
 *
 * Converting is the default for a PDF. The mission is books that are
 * pleasant to *read* (CLAUDE.md), and an unconverted scan is the thing
 * that mission exists to improve on — so the reflowable edition is what
 * happens unless someone decides otherwise.
 */
export function defaultPlanFor(kind: SourceKind): PublicationPlan {
  return plansFor(kind)[0]!
}

/** Is this plan one the source can actually carry out? */
export function planIsAvailable(kind: SourceKind, plan: unknown): plan is PublicationPlan {
  return plansFor(kind).includes(plan as PublicationPlan)
}

/** The plan to record, given what the uploader asked for. */
export function resolvePlan(kind: SourceKind, requested: unknown): PublicationPlan {
  return planIsAvailable(kind, requested) ? requested : defaultPlanFor(kind)
}

/**
 * Which artifact slot the uploaded file itself occupies.
 *
 * This is the rule that makes "always keep the original" cost nothing
 * extra: a PDF upload *is* the book's PDF, a DOCX upload *is* its
 * master, an EPUB upload *is* its EPUB. Only text has no slot of its
 * own, because a .txt file is not an edition of anything.
 */
export function originalArtifact(kind: SourceKind): ArtifactFormat | null {
  switch (kind) {
    case 'pdf':
      return 'pdf'
    case 'docx':
      return 'docx'
    case 'epub':
      return 'epub'
    default:
      return null
  }
}

/**
 * Where the original is kept once it belongs to a book.
 *
 * Under the book's own prefix, and deliberately not left at the
 * `conversion/` key it was uploaded to: the R2 lifecycle rule sweeps
 * that prefix after 30 days. An original that is also a published
 * artifact must outlive the conversion that produced it, and "always
 * keep the original" is not a promise a 30-day sweep can keep.
 */
export function originalKey(bookId: string | number, kind: SourceKind): string {
  const name = { pdf: 'original.pdf', docx: 'master.docx', epub: 'book.epub', text: 'source.txt' }[
    kind
  ]
  return `books/${bookId}/book/${name}`
}

/**
 * What phase 2 has to build for a book with this kind of source.
 *
 * The PDF is conditional and that is the whole point. A book whose
 * original is a PDF already has its PDF — rendering another from the
 * master would produce a file that looks nothing like the scan it came
 * from, which is the opposite of what a PDF is for here. A DOCX or text
 * source has no PDF yet, so one is rendered.
 *
 * The EPUB is unconditional except for an EPUB source, which already is
 * one.
 */
export function formatsToGenerate(kind: SourceKind): ArtifactFormat[] {
  switch (kind) {
    case 'pdf':
      return ['epub']
    case 'epub':
      return []
    default:
      return ['epub', 'pdf']
  }
}

/**
 * Does this source need Adobe's export before there is a master?
 *
 * Only a PDF does. A DOCX is the master already, an EPUB never gets one,
 * and text is turned into one by the converter — none of which involves
 * reading pages off an image.
 */
export function needsExport(kind: SourceKind, plan: PublicationPlan): boolean {
  return kind === 'pdf' && plan === 'convert'
}

/**
 * Does the converter have anything to do for this book?
 *
 * False for a book published as it stands, and for an EPUB upload. Both
 * are finished the moment their original is filed under the book, which
 * is why neither ever reaches a converter — and why a deployment with no
 * converter running can still publish them.
 */
export function needsConverter(kind: SourceKind, plan: PublicationPlan): boolean {
  return plan === 'convert' && formatsToGenerate(kind).length > 0
}

/**
 * This book's source kind, from the stored field or the filename.
 *
 * The field is authoritative and the filename is the fallback, for rows
 * written before the field existed. Defaulting to `pdf` when neither
 * answers is the safe end of the wrong guess: it builds only the EPUB,
 * so a misclassified book is missing a PDF rather than having one
 * rendered over the top of an original it should have kept.
 */
export function readSourceKind(conversion: {
  sourceKind?: unknown
  sourceFilename?: unknown
}): SourceKind {
  const stored = conversion.sourceKind
  if (stored === 'pdf' || stored === 'docx' || stored === 'epub' || stored === 'text') {
    return stored
  }
  const filename = typeof conversion.sourceFilename === 'string' ? conversion.sourceFilename : ''
  return sourceKindOf(filename) ?? 'pdf'
}

/**
 * Which edition the online reader should open, given what a book has.
 *
 * EPUB first, because EPUB is the point: reflowable, resizable, the
 * reading experience the whole project exists to provide.
 *
 * The PDF is not a consolation prize, it is the only honest answer for
 * a book published as it stands. Its owner chose a faithful copy of the
 * original over a reflowable one (`plansFor` above), so the original
 * *is* its edition and there will never be an EPUB to wait for.
 * Refusing to open it meant such a book could not be read by the one
 * reader entitled to it, and could not be reviewed by the administrator
 * deciding whether to publish it — while the file sat in storage the
 * whole time.
 *
 * The DOCX never appears here whatever else is missing: the master is
 * the editorial source of truth, not an edition (CLAUDE.md section 5).
 *
 * Takes formats rather than artifacts so the catalog page — which asks
 * only whether a book is readable at all — can call it with the same
 * rule the authorization uses, instead of re-deriving the order.
 */
export function readingFormat(formats: readonly string[]): 'epub' | 'pdf' | null {
  if (formats.includes('epub')) return 'epub'
  if (formats.includes('pdf')) return 'pdf'
  return null
}
