import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * Page one of a book, as its default cover.
 *
 * Two columns beside the existing `cover_id`, never replacing it: the
 * upload is an editor's deliberate choice and always wins, and this is
 * only ever the fallback (`domain/cover.ts`).
 *
 * `generated_cover_state` defaults to `pending`, which is what makes
 * every book that already exists eligible without a backfill — the
 * converter's next poll picks them up one at a time, oldest first, and
 * the ones with nothing renderable yet are simply not offered.
 *
 * The state is indexed because the claim query filters on it on every
 * converter poll, and a poll that finds nothing must not cost a scan of
 * the whole catalog. `generated_cover_key` is not: it is read one book
 * at a time, on a page that already has the row.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`generated_cover_state\` text DEFAULT 'pending';`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`generated_cover_key\` text;`)
  await db.run(
    sql`CREATE INDEX \`books_generated_cover_generated_cover_state_idx\` ON \`books\` (\`generated_cover_state\`);`,
  )
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`books_generated_cover_generated_cover_state_idx\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`generated_cover_key\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`generated_cover_state\`;`)
}
