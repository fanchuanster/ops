import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * The level an uploader suggested when they submitted their book.
 *
 * Additive and nullable, because null is the ordinary answer: most
 * submissions express no preference, and a default would put a
 * suggestion in every uploader's mouth that they never made.
 *
 * Deliberately *not* a second copy of `level`. The book's own level is
 * unchanged by any of this and stays an administrator field — this
 * column records what was asked for, beside the submission that asked.
 * Nothing in the catalog query reads it.
 *
 * No index: it is read one book at a time, on a page that already has
 * the row.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`review_proposed_level\` numeric;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`review_proposed_level\`;`)
}
