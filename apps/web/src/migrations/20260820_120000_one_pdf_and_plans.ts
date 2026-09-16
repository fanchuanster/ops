import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_plan\` text DEFAULT 'convert';`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_source_kind\` text;`)

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
