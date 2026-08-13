/**
 * Reading levels — how much of the library a reader is browsing.
 *
 * Three levels, nested rather than exclusive. A reader browsing at
 * `essential` sees only essential books; at `normal`, essential and
 * normal; at `extensive`, everything. So the level is a depth, and each
 * one contains the ones before it.
 *
 * WHAT THIS IS NOT: a security boundary. A reader chooses their own
 * level and can raise it at any time, so `extensive` is always one click
 * away and nothing here keeps anyone from anything. Rights clearance,
 * private-workspace ownership and staged release are the access rules
 * (`rights.ts`), and they are enforced independently of this. Levels are
 * curation — a way to meet the mission's "low visual distraction" by
 * letting a reader start with the core and open up the tail when they
 * want it.
 *
 * Framework-independent, like everything in `src/domain`.
 */

export const BOOK_LEVELS = ['essential', 'normal', 'extensive'] as const

export type BookLevel = (typeof BOOK_LEVELS)[number]

/**
 * The ordering, stated rather than implied.
 *
 * These ids are what the database stores and what every comparison uses:
 * a reader at id N sees every book whose id is ≤ N. Nothing anywhere
 * compares level *names*, because names have no order — only this table
 * does.
 *
 * The gaps are deliberate. A level inserted later between normal and
 * extensive takes id 25 and needs no rewrite of stored rows, which a
 * 1/2/3 scheme would force.
 */
export const LEVEL_IDS = {
  essential: 10,
  normal: 20,
  extensive: 30,
} as const satisfies Record<BookLevel, number>

export type LevelId = (typeof LEVEL_IDS)[BookLevel]

export function levelId(level: BookLevel): number {
  return LEVEL_IDS[level]
}

/**
 * The level a stored id names.
 *
 * Falls back to the default rather than throwing: an id written by a
 * future version of the schema must degrade to a sensible view, not
 * break the catalog for everyone.
 */
export function levelFromId(id: number): BookLevel {
  return BOOK_LEVELS.find((level) => LEVEL_IDS[level] === id) ?? DEFAULT_BOOK_LEVEL
}

/**
 * What a reader sees before choosing.
 *
 * `normal` rather than `essential`: defaulting to the narrowest view
 * would hide most of the library from a first-time visitor who has not
 * been told the control exists, which reads as an empty library rather
 * than as a curated one.
 */
export const DEFAULT_BROWSE_LEVEL: BookLevel = 'normal'

/** Assigned to a book that has not been levelled yet. */
export const DEFAULT_BOOK_LEVEL: BookLevel = 'normal'

export function isBookLevel(value: unknown): value is BookLevel {
  return typeof value === 'string' && (BOOK_LEVELS as readonly string[]).includes(value)
}

/**
 * Read a level off a query string, falling back rather than failing.
 *
 * An unrecognised `?level=` is a typo or a stale bookmark, and the right
 * answer to it is the default view — not an error page, and emphatically
 * not "show everything", which is how a lenient parser turns a curation
 * control into a leak of the tail it was meant to fold away.
 */
export function parseBrowseLevel(value: string | null | undefined): BookLevel {
  return isBookLevel(value) ? value : DEFAULT_BROWSE_LEVEL
}

/** Is a book at `bookLevel` shown to a reader browsing at `browseLevel`? */
export function isVisibleAtLevel(bookLevel: BookLevel, browseLevel: BookLevel): boolean {
  return levelId(bookLevel) <= levelId(browseLevel)
}

/**
 * The levels a reader at `browseLevel` can see.
 *
 * The catalog query does not use this — it compares ids directly with a
 * single `<=`, which is one indexed comparison instead of a set. This
 * exists for the UI and for the test that holds the two forms to the
 * same answer.
 */
export function levelsVisibleAt(browseLevel: BookLevel): readonly BookLevel[] {
  return BOOK_LEVELS.filter((level) => isVisibleAtLevel(level, browseLevel))
}

/** Reader-facing labels, kept beside the vocabulary they describe. */
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
