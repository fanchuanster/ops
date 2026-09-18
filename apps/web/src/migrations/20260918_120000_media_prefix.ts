import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`media\` ADD \`prefix\` text DEFAULT 'covers';`)
  await db.run(sql`UPDATE \`media\` SET \`prefix\` = 'covers';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`media\` DROP COLUMN \`prefix\`;`)
}
