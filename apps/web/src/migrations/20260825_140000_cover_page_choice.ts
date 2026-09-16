import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`generated_cover_candidates\` numeric DEFAULT 1;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`generated_cover_page\` numeric DEFAULT 1;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`generated_cover_page\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`generated_cover_candidates\`;`)
}
