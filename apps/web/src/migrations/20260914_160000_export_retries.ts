import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_export_retries\` numeric DEFAULT 0;`)
  await db.run(
    sql`UPDATE \`books\` SET \`conversion_export_retries\` = 0 WHERE \`conversion_export_retries\` IS NULL;`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_export_retries\`;`)
}
