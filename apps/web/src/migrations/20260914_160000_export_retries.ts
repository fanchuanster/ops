import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * How many times the pipeline has re-sent this book's export.
 *
 * Adobe fails an export for two reasons and reports both identically: a
 * PDF it cannot read, which will fail the same way for ever, and a
 * service that was busy — "The operation has timed out, please try
 * after some time." Until now both landed the book in `failed` and
 * waited for a person to press Try again, so an uploader was shown a
 * fault of ours, in Adobe's own words and with a request id attached, as
 * though their scan were at fault.
 *
 * The pipeline now re-submits a transient failure itself
 * (`isTransientExportFailure` in `domain/adobe.ts`). This column is what
 * stops it doing so for ever: every submission is a document
 * transaction per 50 pages, so an unbounded retry on a book that can
 * never succeed would spend a monthly allowance on one file.
 *
 * `DEFAULT 0` and every existing row set explicitly. Zero is the honest
 * value for a book that predates the counter — none of them was ever
 * re-submitted automatically, because nothing could — and it means a
 * book sitting in `failed` from a timeout today gets the full budget
 * the moment somebody requeues it.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_export_retries\` numeric DEFAULT 0;`)
  await db.run(
    sql`UPDATE \`books\` SET \`conversion_export_retries\` = 0 WHERE \`conversion_export_retries\` IS NULL;`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_export_retries\`;`)
}
