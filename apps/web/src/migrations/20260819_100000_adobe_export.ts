import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * Phase 1 moves from Google Document AI to Adobe Export PDF.
 *
 * Document AI read a scan into text and the converter turned that text
 * into a DOCX master. Adobe's Export PDF does both in one call, so the
 * three columns that tracked the OCR half are replaced by three that
 * track an export job: the job URL to poll, the uploaded asset to delete
 * afterwards, and when it started.
 *
 * The old columns are dropped rather than kept. Their contents are
 * Document AI operation names and scratch-bucket prefixes, which name
 * resources in a project this application no longer calls — keeping them
 * would preserve pointers to things nothing can follow.
 *
 * **Books mid-flight are not migrated.** A book in `ocr` at deploy time
 * holds a Document AI operation that nothing will poll again; it stalls
 * until its state is set back to `queued`, which re-runs it through
 * Adobe. That is a handful of books at most — a conversion is minutes
 * long — and the alternative is carrying a second engine to finish them.
 *
 * `conversion_ocr_key` is dropped with the rest. It pointed at
 * `books/{id}/ocr/pages.json` in R2, which stays where it is: those
 * pages were paid for once, and deleting them here would make this
 * migration destructive of something outside the database.
 *
 * `conversion_state` needs no migration. It is a plain text column with
 * a default and no CHECK constraint, and no state was added or removed —
 * `ocr` now means an export is running and `ocr_ready` now means the
 * converter has the whole of phase 1, both of which are changes of
 * meaning rather than of value.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_export_job\` text;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_export_asset\` text;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_export_started_at\` text;`)

  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_ocr_operation\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_ocr_output_prefix\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_ocr_key\`;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_ocr_operation\` text;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_ocr_output_prefix\` text;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_ocr_key\` text;`)

  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_export_job\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_export_asset\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_export_started_at\`;`)
}
