import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_goal\` text DEFAULT 'editions';`)
  await db.run(
    sql`UPDATE \`books\` SET \`conversion_goal\` = 'editions' WHERE \`conversion_goal\` IS NULL;`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_goal\`;`)
}
