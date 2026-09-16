export const BLOCK_KINDS = [
  'chapter',
  'section',
  'marker',
  'verse',
  'attribution',
  'body',
  'footnote',
] as const

export type BlockKind = (typeof BLOCK_KINDS)[number]

export function isBlockKind(value: unknown): value is BlockKind {
  return typeof value === 'string' && (BLOCK_KINDS as readonly string[]).includes(value)
}

export interface Block {
  kind: BlockKind
  lines: string[]
  page: number
  confidence: number
  sourceRef?: string | null
  startsParagraph?: boolean
}

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

export interface Suggestion {
  block: number
  line: number
  original: string
  suggested: string
  reason: string
  confidence: number
  category: string
  approved?: boolean | null
}
