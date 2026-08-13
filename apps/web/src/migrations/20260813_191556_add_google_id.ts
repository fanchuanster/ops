import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`users\` ADD \`google_id\` text;`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_google_id_idx\` ON \`users\` (\`google_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`users_google_id_idx\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`google_id\`;`)
}
