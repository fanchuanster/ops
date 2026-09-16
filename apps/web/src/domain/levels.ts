export const BOOK_LEVELS = ['essential', 'normal', 'extensive'] as const

export type BookLevel = (typeof BOOK_LEVELS)[number]

export const LEVEL_IDS = {
  essential: 10,
  normal: 20,
  extensive: 30,
} as const satisfies Record<BookLevel, number>

export type LevelId = (typeof LEVEL_IDS)[BookLevel]

export function levelId(level: BookLevel): number {
  return LEVEL_IDS[level]
}

export function levelFromId(id: number): BookLevel {
  return BOOK_LEVELS.find((level) => LEVEL_IDS[level] === id) ?? DEFAULT_BOOK_LEVEL
}

export const DEFAULT_BROWSE_LEVEL: BookLevel = 'normal'

export const DEFAULT_BOOK_LEVEL: BookLevel = 'normal'

export function isBookLevel(value: unknown): value is BookLevel {
  return typeof value === 'string' && (BOOK_LEVELS as readonly string[]).includes(value)
}

export function parseBrowseLevel(value: string | null | undefined): BookLevel {
  return isBookLevel(value) ? value : DEFAULT_BROWSE_LEVEL
}

export function parseProposedLevel(value: unknown): BookLevel | null {
  return isBookLevel(value) ? value : null
}

export function isVisibleAtLevel(bookLevel: BookLevel, browseLevel: BookLevel): boolean {
  return levelId(bookLevel) <= levelId(browseLevel)
}

export function levelsVisibleAt(browseLevel: BookLevel): readonly BookLevel[] {
  return BOOK_LEVELS.filter((level) => isVisibleAtLevel(level, browseLevel))
}

export const LEVEL_LABELS: Record<BookLevel, string> = {
  essential: 'Essential',
  normal: 'Normal',
  extensive: 'Extensive',
}

export const LEVEL_DESCRIPTIONS: Record<BookLevel, string> = {
  essential: 'The core works — start here.',
  normal: 'The main library.',
  extensive: 'Everything, including specialist and supplementary works.',
}

export const LEVEL_APPLY_MODES = ['cap', 'exact'] as const

export type LevelApplyMode = (typeof LEVEL_APPLY_MODES)[number]

export function isLevelApplyMode(value: unknown): value is LevelApplyMode {
  return typeof value === 'string' && (LEVEL_APPLY_MODES as readonly string[]).includes(value)
}

export const LEVEL_APPLY_LABELS: Record<LevelApplyMode, string> = {
  cap: 'As a cap',
  exact: 'Exactly',
}

export const LEVEL_APPLY_DESCRIPTIONS: Record<LevelApplyMode, string> = {
  cap: 'Nothing under this shelf sits deeper. Books already shallower keep what they have.',
  exact: 'Every book under this shelf takes this level, whatever it had.',
}

export function shelfLevelFor(
  mode: LevelApplyMode,
  shelfLevel: BookLevel,
  bookLevel: BookLevel,
): BookLevel | null {
  if (mode === 'exact') return bookLevel === shelfLevel ? null : shelfLevel
  return levelId(bookLevel) > levelId(shelfLevel) ? shelfLevel : null
}
