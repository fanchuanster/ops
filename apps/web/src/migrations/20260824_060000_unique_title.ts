import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`books_title_idx\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`books_title_idx\` ON \`books\` (\`title\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`books_title_idx\`;`)
  await db.run(sql`CREATE INDEX \`books_title_idx\` ON \`books\` (\`title\`);`)
}
