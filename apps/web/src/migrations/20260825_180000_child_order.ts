import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(
    sql`ALTER TABLE \`book_collections\` ADD \`child_order\` text DEFAULT 'alphabetical';`,
  )
  await db.run(
    sql`UPDATE \`book_collections\` SET \`child_order\` = 'alphabetical' WHERE \`child_order\` IS NULL;`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`book_collections\` DROP COLUMN \`child_order\`;`)
}
