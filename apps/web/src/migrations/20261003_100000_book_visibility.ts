import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(
    sql`UPDATE \`books\` SET \`visibility\` = CASE WHEN \`review_state\` = 'approved' THEN 'public' ELSE 'private' END WHERE \`owner_id\` IS NOT NULL;`,
  )
  await db.run(sql`UPDATE \`books\` SET \`visibility\` = 'public' WHERE \`owner_id\` IS NULL;`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`books_visibility_idx\` ON \`books\` (\`visibility\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX IF EXISTS \`books_visibility_idx\`;`)
}
