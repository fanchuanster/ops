import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * Which page of itself a book wears.
 *
 * `generated_cover_key` already held one rendered page and page one was
 * the only page there could be. The converter now renders the first few
 * (`COVER_CANDIDATE_PAGES` in `domain/cover.ts`) and these two columns
 * record how many it made and which one was chosen — because the page a
 * publisher printed the cover on is often not the first leaf a scanner
 * fed: a blank verso, a library stamp or a half-title comes first often
 * enough to be worth a choice.
 *
 * Both default to 1, which is exactly right for every book already in
 * the table and needs no backfill: one candidate, wearing it. Those
 * books keep the cover they have — page one's key is still the
 * unsuffixed `cover.jpg` it has always been — and are simply offered no
 * alternatives, since the alternatives were never rendered. Clearing
 * `generated_cover_state` back to `pending` by hand is what re-renders
 * one with candidates, and it is the same lever that already existed
 * for a cover that failed.
 *
 * Neither is indexed. `state` carries the claim query on every
 * converter poll; these two are read one book at a time, on a page that
 * already has the row.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`generated_cover_candidates\` numeric DEFAULT 1;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`generated_cover_page\` numeric DEFAULT 1;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`generated_cover_page\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`generated_cover_candidates\`;`)
}
