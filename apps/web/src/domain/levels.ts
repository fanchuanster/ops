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

/**
 * A level named by a form field, or null if it named nothing we know.
 *
 * Deliberately unlike `parseBrowseLevel` above, which falls back to the
 * default. That one answers "what should this reader see", where a
 * silent fallback is the kind thing to do with a stale bookmark. This
 * one answers "what did the uploader propose", and inventing an answer
 * there would put a suggestion in their mouth that they never made —
 * which an administrator would then read as theirs.
 *
 * Null is a real answer: no preference, which is most submissions.
 */
export function parseProposedLevel(value: unknown): BookLevel | null {
  return isBookLevel(value) ? value : null
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

/**
 * Levelling a whole shelf at once.
 *
 * Setting a level book by book is right for a handful of titles and
 * hopeless for a shelf of eighty, so a collection can hand its level
 * down to everything beneath it — the whole subtree, because a parent
 * carries every shelf standing on it (`collectionTree.ts`).
 *
 * Two modes, and the difference matters:
 *
 *   cap    — nothing under this shelf sits deeper than the level given.
 *            A book already shallower keeps what it has. This is the
 *            one to reach for on a shelf that has been curated already:
 *            it pulls the tail forward without flattening the work
 *            somebody did picking out the essential titles.
 *
 *   exact  — every book under this shelf takes the level given,
 *            whatever it had. Destructive on purpose: it is what you
 *            want after re-filing a batch, and what you do not want on
 *            a shelf you have levelled by hand.
 *
 * Cap is the default offered because it is the reversible-looking one:
 * it can only ever move books shallower, and it never touches a book
 * somebody deliberately marked essential.
 */
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

/**
 * What a book beneath the shelf should become, or null to leave it be.
 *
 * Null rather than "the level it already has" so the caller can skip
 * the write entirely: applying a cap to a shelf of eighty books
 * typically moves three of them, and eighty updates to D1 to change
 * three rows is eighty round trips a Worker pays for.
 */
export function shelfLevelFor(
  mode: LevelApplyMode,
  shelfLevel: BookLevel,
  bookLevel: BookLevel,
): BookLevel | null {
  if (mode === 'exact') return bookLevel === shelfLevel ? null : shelfLevel
  return levelId(bookLevel) > levelId(shelfLevel) ? shelfLevel : null
}
