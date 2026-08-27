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
import { artifactKey } from './bookStorage'

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
 *  - **Text** gets the same choice a PDF does, since 2026-08-26. It was
 *    always converted until then, on the reasoning that a .txt has no
 *    layout of its own so publishing it as it stands is publishing a
 *    text file. That is true and it is not a reason to refuse: a text
 *    file *reflows*, which is the whole property this project is trying
 *    to give a scan. What converting adds is structure — chapters, a
 *    contents list, an EPUB a device can navigate — and that is worth
 *    offering rather than imposing, especially while it means waiting
 *    for a converter to pick the book up.
 */
export function plansFor(kind: SourceKind): PublicationPlan[] {
  switch (kind) {
    case 'pdf':
    case 'text':
      return ['as_is', 'convert']
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
 * It is the first plan `plansFor` offers, which for a PDF is `as_is` —
 * publish the file as it stands, convert nothing, wait for nothing.
 *
 * That is a reversal, on 2026-08-25. Converting was the default until
 * then, on the reasoning that the mission is books that are pleasant to
 * *read* and an unconverted scan is the thing that mission exists to
 * improve on. That reasoning is still true about the finished book; it
 * was wrong about this moment. Converting is the expensive path — an
 * Adobe export, a converter that may not be polling, minutes to hours
 * before the uploader sees anything — and it was being taken on behalf
 * of someone who had done nothing but choose a file.
 *
 * The default is now the one that finishes immediately, because it is
 * the one that cannot be regretted: the original is kept whatever
 * happens (`originalArtifact`), and converting later is a button on the
 * book's own page. The reverse is not symmetric — a reader who wanted
 * the file published today cannot un-wait for a conversion.
 *
 * Nothing about the mission is conceded by this. The uploader is still
 * offered `convert` first-class on the same screen, and what publishing
 * as it stands costs — no EPUB, no reflow, no Kindle-shaped text — is
 * said in the option's own copy rather than left for them to discover.
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
 * master, an EPUB upload *is* its EPUB, and a text upload is its own
 * `txt`.
 *
 * Text returned null until 2026-08-26, which had two consequences and
 * only one of them was intended. The intended one was that a .txt could
 * not be published as it stands, since there was nothing filed to read.
 * The other was that the original was not kept at all: it stayed at the
 * `conversion/` key the upload wrote, which the R2 lifecycle rule sweeps
 * after 30 days. A converted text book now keeps its source like every
 * other book, whether or not anybody reads it.
 */
export function originalArtifact(kind: SourceKind): ArtifactFormat | null {
  switch (kind) {
    case 'pdf':
      return 'pdf'
    case 'docx':
      return 'docx'
    case 'epub':
      return 'epub'
    case 'text':
      return 'txt'
    default:
      return null
  }
}

const ORIGINAL_FORMAT = { pdf: 'pdf', docx: 'docx', epub: 'epub', text: 'txt' } as const

/**
 * Where the original is kept once it belongs to a book.
 *
 * Named from the uploaded file, and deliberately not left at the
 * `conversion/` key it was uploaded to: the R2 lifecycle rule sweeps
 * that prefix after 30 days. An original that is also a published
 * artifact must outlive the conversion that produced it, and "always
 * keep the original" is not a promise a 30-day sweep can keep.
 */
export function originalKey(stem: string, kind: SourceKind): string {
  // The original *is* one of the book's artifacts — a PDF upload is its
  // PDF, a DOCX upload is its master — so it is named by the same rule,
  // and the two agreeing is what makes "always keep the original" cost
  // nothing extra rather than doubling every book.
  return artifactKey(stem, ORIGINAL_FORMAT[kind])
}

/**
 * What phase 2 has to build for a book with this kind of source.
 *
 * **The EPUB, and nothing else.** Only ever asked of a book being
 * converted — a book published as it stands never reaches phase 2 at
 * all (`needsConverter`).
 *
 * A PDF is never *generated*, since 2026-08-26. It used to be, for a
 * DOCX or text source that had none: WeasyPrint typeset one from the
 * master, or LibreOffice rendered the Word layout. Both are gone, and
 * the reasoning is the same one that killed the three type sizes before
 * them (section 11) — a PDF's job in this library is to be a faithful
 * picture of the *original*, and a book whose original is a DOCX or a
 * text file has no such picture to be faithful to. What that rendering
 * produced was our own typography frozen into a fixed layout: strictly
 * worse than the EPUB beside it, for every reader and every device.
 *
 * So a PDF artifact now only ever means "the uploader uploaded a PDF",
 * which is exactly what makes it worth keeping. Everything else reads
 * the EPUB.
 *
 * The consequence for deployment is the point of the change: nothing in
 * phase 2 needs a PDF renderer any more, and a PDF renderer was the
 * last thing in the pipeline that needed native libraries — Cairo and
 * Pango behind WeasyPrint, a whole office suite behind LibreOffice.
 */
export function formatsToGenerate(kind: SourceKind): ArtifactFormat[] {
  return kind === 'epub' ? [] : ['epub']
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
 * Has a book that was published as it stands just been asked to convert
 * after all?
 *
 * The reversal in `defaultPlanFor` is what makes this a rule worth
 * naming rather than a condition in a form handler. Publishing as it
 * stands is the default, so "convert it after all" is no longer an
 * unusual second thought — it is the ordinary road to an EPUB, taken
 * *after* the book has already settled and stopped moving.
 *
 * A book in that position has to re-enter the queue, which is the one
 * thing a settled book otherwise never does. Nothing it already has is
 * lost by doing so: the uploaded PDF is filed as the book's own PDF
 * artifact, and `formatsToGenerate` builds only the EPUB on top of it.
 *
 * Deliberately one-way. A converted book set back to `as_is` is a
 * record of a preference, not an instruction to delete an EPUB that may
 * already have been sent to somebody's device.
 */
export function reopensForConversion(
  kind: SourceKind,
  previous: PublicationPlan,
  next: PublicationPlan,
): boolean {
  return previous === 'as_is' && needsConverter(kind, next)
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
 * Plain text is last and is not a consolation prize either. It reflows,
 * so it reads better than the PDF above it; it is below the PDF only
 * because a book that has both was converted from text and the PDF is
 * the typeset edition of it. For a text file published as it stands, it
 * is the whole book and reads as well as anything here.
 *
 * Takes formats rather than artifacts so the catalog page — which asks
 * only whether a book is readable at all — can call it with the same
 * rule the authorization uses, instead of re-deriving the order.
 */
export function readingFormat(formats: readonly string[]): 'epub' | 'pdf' | 'txt' | null {
  if (formats.includes('epub')) return 'epub'
  if (formats.includes('pdf')) return 'pdf'
  if (formats.includes('txt')) return 'txt'
  return null
}
