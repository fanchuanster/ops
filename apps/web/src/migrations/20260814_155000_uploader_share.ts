import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * The uploader's carried share.
 *
 * Hundredths of a credit earned but not yet worth a whole one. Additive
 * and defaulted, so the old code ignores the column and this is safe to
 * apply before the Worker is deployed.
 *
 * `credit_ledger.reason` needs no change: it is a text column, and the
 * new `uploader_share` value is validated in application code.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`users\` ADD \`credit_share_points\` numeric DEFAULT 0;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`credit_share_points\`;`)
}
