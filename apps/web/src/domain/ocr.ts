/**
 * Reading an OCR engine's output back as a book.
 *
 * CLAUDE.md section 8 asks for OCR to be an abstraction that can be
 * replaced. The replaceable part is not the HTTP call — that is a dozen
 * lines in `lib/google/documentai.ts` — it is everything downstream of
 * it: how pages are ordered, how a page becomes paragraphs, what counts
 * as a usable result. That lives here, in vendor-neutral shapes, so
 * swapping engines means writing a new adapter into `OcrPage[]` rather
 * than rewriting the pipeline.
 *
 * Framework-independent, like everything in `src/domain`. No fetch, no
 * Payload, no storage client.
 *
 * ## Why offsets, and why they are the hard part
 *
 * Document AI does not hand back text per page. It returns one string
 * for the whole document plus, for every structural element, a byte
 * range into that string. A page's paragraphs are ranges; the page
 * itself is a range. Nothing is nested, so reconstructing a book is
 * entirely a matter of slicing correctly.
 *
 * Two things make that sharper than it looks:
 *
 *  - Long documents come back **sharded** across several output files,
 *    each carrying its own slice of the text and offsets relative to the
 *    *whole* document, not to the shard. Concatenating shards without
 *    rebasing produces text that looks right and slices that are
 *    silently wrong by the length of every preceding shard.
 *
 *  - The offsets are int64, so JSON encodes them as **strings**. `+` on
 *    a string offset concatenates, and the resulting slice is empty
 *    rather than an error.
 */

/**
 * Where a paragraph sits on its page, in normalized coordinates.
 *
 * 0..1 on both axes with the origin at the top left, which is what
 * Document AI's `normalizedVertices` already are — so a box is
 * comparable across pages of different pixel dimensions without
 * carrying the dimensions around. That comparability is the whole
 * point: running heads are found by noticing the same text in the same
 * place on many pages, and "the same place" has to mean something when
 * page 3 was scanned at a different resolution from page 300.
 */
export interface OcrBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** What a paragraph is structurally, once it has been classified. */
export type ParagraphRole = 'body' | 'h1' | 'h2'

/**
 * One paragraph of a scanned page.
 *
 * This was a bare string until the format's version 2. The string was
 * the whole reason headings and running heads could not be handled: the
 * geometry and the type size are what distinguish a chapter title from
 * a sentence, and neither survived the crossing to the converter. Text
 * alone leaves the downstream service guessing, and on Chinese material
 * the usual guesses (short line means heading) misfire constantly.
 */
export interface OcrParagraph {
  text: string
  /** Absent when the engine reported no geometry for this paragraph. */
  box?: OcrBox
  /**
   * Median type size of the paragraph's tokens, in points.
   *
   * Only present when the OCR request asked for style information,
   * which is a paid extra — see `ocrConfig` in `lib/google/documentai.ts`.
   * Everything here degrades to "unknown" rather than to "wrong" when
   * it is absent.
   */
  fontSize?: number
  bold?: boolean
  /** Filled in by `classifyParagraphs`; absent means unclassified. */
  role?: ParagraphRole
}

/** One page of a scanned book, after OCR. */
export interface OcrPage {
  /** 1-based, in reading order. */
  number: number
  /** The page's text, split into paragraphs, in reading order. */
  paragraphs: OcrParagraph[]
}

/**
 * A page range that an engine reported, before slicing.
 *
 * The intermediate shape an adapter produces. Keeping it separate from
 * `OcrPage` is what lets the slicing be tested without a fixture the
 * size of a book.
 */
export interface TextSegment {
  start: number
  end: number
}

/**
 * Parse an offset that arrived as a JSON string, or a number, or not at
 * all.
 *
 * Absent means zero for a start offset — Document AI omits
 * `startIndex` when it is 0 rather than sending it, which is the proto3
 * default-value rule leaking through the JSON mapping. A missing end
 * offset is genuinely missing, so that is the caller's problem, not
 * this function's.
 */
export function offset(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/**
 * Split text into code points, which is the unit the offsets count in.
 *
 * This is not a formality, and for this project it is not an edge case.
 * Document AI's offsets index *code points* — Google's own samples slice
 * Python strings with them, and Python strings are code-point indexed.
 * JavaScript strings are UTF-16, so anything outside the Basic
 * Multilingual Plane counts as two units here and one there.
 *
 * Common Chinese is in the BMP and unaffected. CJK Extension B and
 * beyond (U+20000 and up) is not, and that is precisely where the rare
 * and variant characters in historical texts live — so on the books this
 * project exists to preserve, indexing the raw string would drift by one
 * for every such character and silently truncate every paragraph after
 * the first one.
 *
 * Done once per shard rather than once per paragraph: a shard is a
 * megabyte of text and a book has thousands of paragraphs.
 */
export function codePoints(text: string): string[] {
  return Array.from(text)
}

/**
 * Slice by a segment, tolerating the ways a segment can be wrong.
 *
 * Takes the code-point array from `codePoints`, not a raw string — see
 * above for why the distinction is load-bearing.
 *
 * An out-of-range or inverted segment yields an empty string rather than
 * throwing. A single bad range in a 400-page book must cost that
 * paragraph, not the book — recovering means re-running OCR that took
 * an hour and cost real money.
 */
export function sliceSegment(units: readonly string[], segment: TextSegment): string {
  const start = Math.max(0, Math.min(segment.start, units.length))
  const end = Math.max(start, Math.min(segment.end, units.length))
  return units.slice(start, end).join('')
}

/**
 * Tidy one paragraph of OCR output.
 *
 * Scanned text arrives with a newline at every *typeset* line break,
 * which is a property of the page, not of the sentence. Leaving them in
 * produces an EPUB that ignores the reader's font size and margins —
 * precisely what CLAUDE.md section 10 says reflowable text is for.
 *
 * The join is empty rather than a space because this project's centre of
 * gravity is Chinese, where a line break inside a paragraph is not a
 * word boundary and a space would be a visible defect. Latin text is
 * handled by keeping the space that is already there at the break.
 */
export function tidyParagraph(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .reduce((joined, line) => {
      if (joined === '') return line
      // A hyphen at a line break in Latin text is a split word.
      if (/[A-Za-z]-$/.test(joined)) return joined.slice(0, -1) + line
      // Keep a space only where both sides are Latin script.
      const needsSpace = /[A-Za-z0-9,;.!?)"']$/.test(joined) && /^[A-Za-z0-9("']/.test(line)
      return joined + (needsSpace ? ' ' : '') + line
    }, '')
}

/**
 * Is this page worth keeping?
 *
 * Blank versos, scan separators and the grey pages at the end of a
 * volume all OCR to nothing or near enough. They are not errors, so
 * they are dropped quietly rather than reported.
 */
export function pageHasContent(page: OcrPage): boolean {
  return page.paragraphs.some((paragraph) => paragraph.text.trim().length > 0)
}

/**
 * Did OCR produce something worth building a book from?
 *
 * A scanned PDF that is upside down, or a "scan" that is really a
 * photograph of a shelf, returns pages with a scattering of garbage.
 * Building a DOCX master from that wastes an editor's time on something
 * no proofreading can rescue, so the pipeline should fail loudly instead.
 *
 * The threshold is deliberately low. This is a floor, not a quality
 * measure: judging OCR quality is what human review is for, and a
 * strict rule here would reject damaged books that are exactly the ones
 * this project exists to preserve.
 */
export function looksLikeABook(pages: readonly OcrPage[]): boolean {
  const withContent = pages.filter(pageHasContent)
  if (withContent.length === 0) return false

  const characters = withContent.reduce(
    (total, page) =>
      total + page.paragraphs.map((p) => p.text).join('').replace(/\s/g, '').length,
    0,
  )
  // Averaged over pages that have anything on them at all, so a book
  // with many blank plates is not penalised for them.
  return characters / withContent.length >= 20
}

/**
 * Order pages and drop the empty ones.
 *
 * Sharded output arrives in whatever order the shards were listed, and
 * an object store lists lexicographically — so shard 10 sorts before
 * shard 2. Ordering by the page number the engine reported is the only
 * thing that survives that.
 */
export function orderPages(pages: readonly OcrPage[]): OcrPage[] {
  return [...pages].filter(pageHasContent).sort((a, b) => a.number - b.number)
}

/** Total characters, for the page-count and price sanity checks. */
export function characterCount(pages: readonly OcrPage[]): number {
  return pages.reduce(
    (total, page) => total + page.paragraphs.reduce((sum, p) => sum + p.text.length, 0),
    0,
  )
}

/*
 * ---------------------------------------------------------------------
 * Running heads, feet and page numbers
 * ---------------------------------------------------------------------
 */

/**
 * How close to an edge a paragraph must sit to be a candidate.
 *
 * A twelfth of the page at each end. Generous enough for a running head
 * with a rule under it, tight enough that the first line of body text on
 * a sparse page is not swept up — and being in the band is only ever a
 * *candidate* test, never the decision.
 */
const MARGIN_BAND = 1 / 12

/**
 * The text of a running head, with the varying part removed.
 *
 * A running head is "the same" from page to page even though the folio
 * inside it changes, so the digits go before the comparison. CJK
 * numerals go too: 第三十七頁 and 第三十八頁 are the same running head,
 * and a comparison that only knew about 0-9 would think otherwise.
 */
export function runningHeadKey(text: string): string {
  return text
    .replace(/[0-9]+/g, '#')
    .replace(/[〇零一二三四五六七八九十百千]+/g, '#')
    .replace(/\s+/g, '')
    .trim()
}

/**
 * Is this paragraph nothing but a folio?
 *
 * Checked separately from the repetition test because a page number is
 * the one running element that is *different* on every page — the
 * repetition test is exactly what cannot catch it. What repeats is the
 * shape: something short, in the margin band, made of digits and a
 * little punctuation.
 */
export function looksLikeFolio(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0 || trimmed.length > 12) return false
  return /^[[(（【]?[-—–]?\s*(?:[0-9]+|[〇零一二三四五六七八九十百千]+)\s*[-—–]?[\])）】]?$/.test(
    trimmed,
  )
}

function inMarginBand(box: OcrBox | undefined): boolean {
  if (!box) return false
  return box.y1 <= MARGIN_BAND || box.y0 >= 1 - MARGIN_BAND
}

/**
 * Remove running heads, running feet and page numbers.
 *
 * Two rules, and both require the paragraph to be in a margin band:
 *
 *   - a folio, by shape (`looksLikeFolio`), or
 *   - text whose de-numbered form appears in the same band on at least
 *     `minPages` pages.
 *
 * The repetition threshold is what keeps this safe. A chapter title
 * sitting high on its opening page is in the band but appears once, so
 * it survives; the running head derived from that same title appears on
 * every page of the chapter, so it goes. Requiring repetition means the
 * rule cannot fire on a one-off, which is the failure that would
 * silently delete real text.
 *
 * Deliberately does nothing when no geometry is present. A v1 handoff,
 * or an engine that reported no boxes, leaves every paragraph alone —
 * the honest outcome, since without position there is no evidence.
 */
export function dropRunningHeads(
  pages: readonly OcrPage[],
  { minPages = 3 }: { minPages?: number } = {},
): OcrPage[] {
  const seen = new Map<string, Set<number>>()

  for (const page of pages) {
    for (const paragraph of page.paragraphs) {
      if (!inMarginBand(paragraph.box)) continue
      const key = runningHeadKey(paragraph.text)
      if (key.length === 0) continue
      const pagesWithKey = seen.get(key) ?? new Set<number>()
      pagesWithKey.add(page.number)
      seen.set(key, pagesWithKey)
    }
  }

  // An absolute floor rather than a proportion of the book. A running
  // head usually changes with the chapter, so it may legitimately cover
  // only twenty pages of four hundred — a proportional threshold would
  // miss exactly those and keep every one of them in the text.
  //
  // On a document shorter than the floor the rule cannot have evidence,
  // so it does not run at all.
  if (pages.length < minPages) return pages.map((page) => ({ ...page }))
  const threshold = minPages

  return pages.map((page) => ({
    ...page,
    paragraphs: page.paragraphs.filter((paragraph) => {
      if (!inMarginBand(paragraph.box)) return true
      if (looksLikeFolio(paragraph.text)) return false
      const key = runningHeadKey(paragraph.text)
      return (seen.get(key)?.size ?? 0) < threshold
    }),
  }))
}

/*
 * ---------------------------------------------------------------------
 * Headings
 * ---------------------------------------------------------------------
 */

/** How much larger than the body a paragraph must be to be a heading. */
const H2_RATIO = 1.15
const H1_RATIO = 1.4

/**
 * The longest a heading is allowed to be, in characters.
 *
 * A cheap guard against the failure that matters: a whole paragraph of
 * body text set in a slightly larger face — a preface, an epigraph —
 * being promoted to a chapter title and then breaking the book into
 * chapters at the wrong places.
 */
const HEADING_MAX_LENGTH = 60

/**
 * The body text's type size, as the median of what is on the page.
 *
 * The median rather than the mean, because a title page or a display
 * quotation would drag a mean upwards and then nothing would clear the
 * ratio. Weighted by nothing: one vote per paragraph is enough, and
 * weighting by length would let a single long paragraph define "body".
 */
export function bodyFontSize(pages: readonly OcrPage[]): number | null {
  const sizes = pages
    .flatMap((page) => page.paragraphs)
    .map((paragraph) => paragraph.fontSize)
    .filter((size): size is number => typeof size === 'number' && size > 0)
    .sort((a, b) => a - b)

  if (sizes.length === 0) return null
  return sizes[Math.floor(sizes.length / 2)]!
}

/**
 * Assign a role to every paragraph.
 *
 * Headings are decided from type size relative to the body, never from
 * length or position alone. That is the distinction the converter's
 * `ocr_json.py` refused to make on text alone, and it was right to
 * refuse: "short line means heading" invents chapters in Chinese verse
 * constantly, and a fabricated chapter is far more expensive to fix
 * than a missing one.
 *
 * With no style information every paragraph comes back `body`. That is
 * the honest answer — not a degraded guess — and it is what happens when
 * the paid style feature is switched off.
 */
export function classifyParagraphs(pages: readonly OcrPage[]): OcrPage[] {
  const body = bodyFontSize(pages)

  return pages.map((page) => ({
    ...page,
    paragraphs: page.paragraphs.map((paragraph) => ({
      ...paragraph,
      role: paragraphRole(paragraph, body),
    })),
  }))
}

function paragraphRole(paragraph: OcrParagraph, body: number | null): ParagraphRole {
  if (body === null || !paragraph.fontSize) return 'body'
  if (paragraph.text.trim().length > HEADING_MAX_LENGTH) return 'body'

  const ratio = paragraph.fontSize / body
  if (ratio >= H1_RATIO) return 'h1'
  if (ratio >= H2_RATIO) return 'h2'

  // Bold at body size is emphasis, not structure — except that a short,
  // bold, standalone line in a book set otherwise unbolded is how a
  // great many Chinese editions set a section head. Requiring both
  // bold and brevity keeps this from firing on an emphasised sentence.
  if (paragraph.bold && paragraph.text.trim().length <= HEADING_MAX_LENGTH / 2) return 'h2'

  return 'body'
}

/*
 * ---------------------------------------------------------------------
 * The handoff between the two services
 * ---------------------------------------------------------------------
 *
 * The pipeline is split at this boundary: the web application runs OCR,
 * because Document AI is an HTTP call and a Worker is billed almost
 * nothing for waiting on one; the converter turns the result into a DOCX
 * master and an EPUB, because that is rendering and belongs where CPU is
 * not metered by the millisecond.
 *
 * What crosses between them is this document, in R2. It is the *only*
 * thing the converter needs from the OCR stage — deliberately, so the
 * two services share a format rather than a database.
 */

/**
 * Bumped when the shape below changes incompatibly.
 *
 * The converter checks it and refuses a document it does not understand.
 * Without this, a format change would be discovered as a malformed book
 * after an hour of rendering rather than as a refusal in the first
 * second.
 *
 * Version 2 changed `paragraphs` from `string[]` to `OcrParagraph[]`,
 * carrying position, type size and a structural role across the
 * boundary. Version 1 discarded all three, which is why running heads
 * ended up in the text and why no chapter title ever became a heading:
 * the evidence for both was thrown away in this service before the
 * converter ever saw it.
 *
 * The converter reads both. Books already OCR'd under version 1 keep
 * working and are not re-read — Google has been paid for those pages
 * once already.
 */
export const OCR_FORMAT_VERSION = 2

export interface OcrDocument {
  version: number
  bookId: string
  /** Pages with content, in reading order. Blank pages are not included. */
  pages: OcrPage[]
  /** Pages the engine saw, including blank ones. The book's real length. */
  pageCount: number
}

/**
 * Where a book's OCR text lives.
 *
 * Under the book's own prefix, for the same reason artifacts are
 * (`domain/conversion.ts`): everything belonging to a book is contained
 * by a path that names it, so a key can be checked rather than trusted.
 *
 * Not under `conversion/`, which the R2 lifecycle rule sweeps after 30
 * days. OCR output is expensive — it is the thing we paid Google for —
 * and re-running it to recover from a storage rule would be the most
 * annoying possible way to lose money.
 */
export function ocrTextKey(bookId: string | number): string {
  return `books/${bookId}/ocr/pages.json`
}

/** Assemble the document the converter will read. */
export function buildOcrDocument({
  bookId,
  pages,
  pageCount,
}: {
  bookId: string | number
  pages: readonly OcrPage[]
  pageCount: number
}): OcrDocument {
  // Order first, because running-head detection counts distinct pages
  // and blank ones would otherwise dilute nothing but still be counted.
  // Then strip the furniture, then classify what is left — classifying
  // first would let a running head's type size vote on what "body" is.
  const ordered = classifyParagraphs(dropRunningHeads(orderPages(pages)))
  return {
    version: OCR_FORMAT_VERSION,
    bookId: String(bookId),
    pages: ordered,
    // The engine's own count when we have it, since blank pages are
    // real pages of a real book and the price is per page.
    pageCount: Math.max(pageCount, ordered.length),
  }
}

/**
 * Does this source need OCR at all?
 *
 * A DOCX or a plain text file already *is* text; sending it to an OCR
 * engine would cost money to recover characters we were handed. Those go
 * straight to the converter, which reads the original.
 *
 * PDFs always go through Document AI, including ones with a text layer.
 * Telling a scanned PDF from a born-digital one reliably is its own
 * problem, and Document AI reads the text layer when there is one — so
 * the cost of being wrong in this direction is a little money, and in
 * the other direction it is a book of empty pages.
 */
export function needsOcr(filename: string, mimeType?: string | null): boolean {
  if (mimeType === 'application/pdf') return true
  if (mimeType && mimeType !== 'application/octet-stream') return false
  return /\.pdf$/i.test(filename.trim())
}
