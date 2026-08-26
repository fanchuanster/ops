/**
 * The structure a book passes through on its way to a reading edition.
 *
 * This was `services/converter/app/models.py` until 2026-08-26, when the
 * conversion pipeline moved into the Worker and the container it lived
 * in was deleted (CLAUDE.md section 13). What crossed is only what the
 * four job kinds actually touch — `Box`, `OcrSpan`, `OcrPage` and `Line`
 * did not, because they described OCR geometry and nothing has read a
 * page image since PaddleOCR went.
 *
 * These types deliberately know nothing about DOCX, EPUB or the model
 * that proofreads them. A reader produces a `Document`, a builder
 * consumes one, and either can be replaced without touching the other.
 */

/** What a structural unit of the book *is*. */
export const BLOCK_KINDS = [
  'chapter', // Word "Heading 1"
  'section', // a heading below chapter level — Word "Heading 2"
  'marker', // （十一） — a poem's number within a chapter
  'verse', // a poem; line breaks are significant
  'attribution', // ——唐·李白《静夜思》
  'body', // ordinary reflowable prose
  'footnote', // set below the rule at the foot of the page
] as const

export type BlockKind = (typeof BLOCK_KINDS)[number]

export function isBlockKind(value: unknown): value is BlockKind {
  return typeof value === 'string' && (BLOCK_KINDS as readonly string[]).includes(value)
}

/**
 * A structural unit of the reconstructed book.
 *
 * `lines` holds one entry per printed line. For `verse` that distinction
 * is load-bearing — the lines are the poem's lines and must survive to
 * the DOCX and onward to the EPUB. For `body` the lines are joined into
 * a paragraph, because there the breaks really are an artifact of the
 * printed measure.
 */
export interface Block {
  kind: BlockKind
  lines: string[]
  /** A DOCX has no pages until it is laid out, so this is 0 for one. */
  page: number
  confidence: number
  /** （见第 71 页）, into the cited edition. */
  sourceRef?: string | null
  /** `body` only: this line was first-line indented. */
  startsParagraph?: boolean
}

/** A whole reconstructed book, ready for format generation. */
export interface Document {
  title: string
  author?: string | null
  blocks: Block[]
}

export function blockText(block: Block): string {
  return block.lines.join('\n')
}

export function makeBlock(kind: BlockKind, lines: string[], extra: Partial<Block> = {}): Block {
  return { kind, lines, page: 0, confidence: 1, ...extra }
}

/**
 * One proposed correction to one line, awaiting a human decision.
 *
 * The AI stage never edits a document (CLAUDE.md section 7). It emits
 * these, a human sets `approved`, and only then does anything change.
 * `original` is kept so the apply step can refuse to act on a line that
 * has moved on since the suggestion was made.
 *
 * `category` is derived from the edit itself, not claimed by the model:
 * "punctuation" if only punctuation and spacing differ, "characters" if
 * the wording is touched at all. The second kind deserves a closer read.
 */
export interface Suggestion {
  block: number
  line: number
  original: string
  suggested: string
  reason: string
  confidence: number
  /**
   * Derived from the edit, never claimed by the model. Typed as a plain
   * string rather than the union `classify` produces because this is
   * also the shape read back from the suggestions file, which crosses a
   * trust boundary — see `readSuggestions` in `correction.ts`.
   */
  category: string
  /** `null`/absent = nobody has looked at it yet. */
  approved?: boolean | null
}
