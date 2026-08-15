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

/** One page of a scanned book, after OCR. */
export interface OcrPage {
  /** 1-based, in reading order. */
  number: number
  /** The page's text, split into paragraphs, in reading order. */
  paragraphs: string[]
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
  return page.paragraphs.some((paragraph) => paragraph.trim().length > 0)
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
    (total, page) => total + page.paragraphs.join('').replace(/\s/g, '').length,
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
    (total, page) => total + page.paragraphs.reduce((sum, p) => sum + p.length, 0),
    0,
  )
}
