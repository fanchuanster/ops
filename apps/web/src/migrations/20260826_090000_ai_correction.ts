import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(
    sql`ALTER TABLE \`books\` ADD \`conversion_ai_correction\` integer DEFAULT false;`,
  )
  await db.run(
    sql`UPDATE \`books\` SET \`conversion_ai_correction\` = 0 WHERE \`conversion_ai_correction\` IS NULL;`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_ai_correction\`;`)
}
