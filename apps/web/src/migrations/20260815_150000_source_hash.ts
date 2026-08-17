import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * The content hash of an uploaded original.
 *
 * OCR is the only part of this pipeline billed per page by a third
 * party, and the same scanned book reaching us twice is not far-fetched:
 * the public-domain texts this library exists to preserve circulate as a
 * handful of widely-copied PDFs. Recognising that we have already read a
 * byte-identical file lets the second upload reuse the first's text and
 * cost nothing.
 *
 * Indexed, because it is only ever queried by equality and the lookup
 * happens on the path that decides whether to spend money.
 *
 * Nullable and additive. Books uploaded before this simply have no hash
 * and take the ordinary path — there is no backfill, because computing
 * one would mean reading every source out of R2 to save a cost that has
 * already been paid.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_source_hash\` text;`)
  await db.run(
    sql`CREATE INDEX \`books_conversion_conversion_source_hash_idx\` ON \`books\` (\`conversion_source_hash\`);`,
  )
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`books_conversion_conversion_source_hash_idx\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_source_hash\`;`)
}
