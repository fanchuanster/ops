import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * Where a book is in the OCR half of phase 1.
 *
 * Batch OCR answers into a bucket minutes later, so the operation has to
 * outlive the request that started it. Without these columns a Worker
 * restart between submitting and polling would lose a job Google has
 * already been paid for, and the only recovery would be to pay again.
 *
 * `conversion_state` needs no migration. It is a plain text column with
 * a default and no CHECK constraint, so the new phase states —
 * `ocr`, `ocr_ready`, `mastering`, `master_ready`, `formatting` — are
 * valid the moment the application writes them. The old `converting`
 * value is not migrated because nothing is in it: conversions in flight
 * are minutes long and the state is not durable across a deploy in any
 * meaningful sense.
 *
 * All three columns are additive and nullable, so this is safe to apply
 * before the Worker that reads them is deployed.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_ocr_operation\` text;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_ocr_output_prefix\` text;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_ocr_key\` text;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_ocr_operation\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_ocr_output_prefix\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_ocr_key\`;`)
}
