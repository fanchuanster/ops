import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * One PDF instead of three, and a choice about what to do with an
 * upload.
 *
 * ## The formats
 *
 * `pdf_standard`, `pdf_large` and `pdf_xl` were the same book rendered
 * at three type sizes, so a reader could pick their typography. The EPUB
 * already does that better by letting the device decide, so the three
 * collapse to one `pdf` — which now means something different: a
 * faithful picture of the original's own layout, and for a PDF upload
 * *is* the uploaded file.
 *
 * Existing rows are folded rather than dropped. A book with all three
 * keeps the standard one as its `pdf`; the other two rows go, and their
 * objects are left in R2 for a human to sweep. Deleting reader-facing
 * files from inside a schema migration is not a trade worth making —
 * an orphaned object costs a fraction of a penny and a deleted one
 * cannot be got back.
 *
 * The column is plain text with no CHECK constraint, so the new value is
 * valid the moment it is written; only the data needs moving.
 *
 * ## The plan
 *
 * `conversion_plan` records what the uploader chose — convert, or
 * publish the original as it stands — and `conversion_source_kind` what
 * they uploaded. Only a PDF gets the choice; everything else has one
 * sensible path (`domain/publication.ts`).
 *
 * Both are additive and nullable. Books uploaded before this have
 * neither, and `readSourceKind` derives the kind from the filename for
 * exactly that reason, defaulting to `pdf` — which is what every book in
 * the pipeline before today was.
 *
 * `conversion_pending_formats` goes with the on-demand PDF request it
 * existed for. Nothing asks for a format any more: a book gets
 * everything its source can give it on the first run.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_plan\` text DEFAULT 'convert';`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_source_kind\` text;`)

  // Promote the standard rendering to be the book's one PDF, then drop
  // the alternatives. Order matters: doing it the other way round would
  // leave a book whose only PDF was `pdf_large` with none at all.
  await db.run(
    sql`UPDATE \`books_artifacts\` SET \`format\` = 'pdf' WHERE \`format\` = 'pdf_standard';`,
  )
  await db.run(
    sql`UPDATE \`books_artifacts\` SET \`format\` = 'pdf' WHERE \`format\` = 'pdf_large'
        AND \`_parent_id\` NOT IN (SELECT \`_parent_id\` FROM \`books_artifacts\` WHERE \`format\` = 'pdf');`,
  )
  await db.run(
    sql`UPDATE \`books_artifacts\` SET \`format\` = 'pdf' WHERE \`format\` = 'pdf_xl'
        AND \`_parent_id\` NOT IN (SELECT \`_parent_id\` FROM \`books_artifacts\` WHERE \`format\` = 'pdf');`,
  )
  await db.run(
    sql`DELETE FROM \`books_artifacts\` WHERE \`format\` IN ('pdf_standard', 'pdf_large', 'pdf_xl');`,
  )

  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_pending_formats\`;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_pending_formats\` text;`)
  await db.run(
    sql`UPDATE \`books_artifacts\` SET \`format\` = 'pdf_standard' WHERE \`format\` = 'pdf';`,
  )
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_source_kind\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_plan\`;`)
}
