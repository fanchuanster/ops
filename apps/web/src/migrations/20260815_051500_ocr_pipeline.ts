import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

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
