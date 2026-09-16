import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`estimated_pages\` numeric;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_started_at\` text;`)
  await db.run(
    sql`CREATE INDEX \`books_conversion_conversion_started_at_idx\` ON \`books\` (\`conversion_started_at\`);`,
  )
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`books_conversion_conversion_started_at_idx\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`estimated_pages\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_started_at\`;`)
}
