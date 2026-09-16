import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`generated_cover_state\` text DEFAULT 'pending';`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`generated_cover_key\` text;`)
  await db.run(
    sql`CREATE INDEX \`books_generated_cover_generated_cover_state_idx\` ON \`books\` (\`generated_cover_state\`);`,
  )
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`books_generated_cover_generated_cover_state_idx\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`generated_cover_key\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`generated_cover_state\`;`)
}
