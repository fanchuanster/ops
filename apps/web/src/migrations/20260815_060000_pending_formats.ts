import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * Which formats a reader has asked for and not yet been given.
 *
 * Phase 2 no longer builds everything. A release builds the EPUB; the
 * three PDF variants are rendered when somebody wants one, and this
 * column is where the wanting is recorded — see `formatsToBuild` in
 * `domain/pipeline.ts`.
 *
 * Stored as JSON in one column rather than as a `hasMany` select, which
 * Payload would put in a side table. A side table would buy queryability
 * this never needs: the list is only ever read from a book already
 * fetched by state, never searched across. One nullable column, one
 * additive statement, no join.
 *
 * Null and `[]` mean the same thing — nothing asked for — so no backfill
 * is needed and this is safe to apply before the Worker that reads it.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_pending_formats\` text;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_pending_formats\`;`)
}
