import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * Fields the monthly conversion quota needs.
 *
 * `estimated_pages` is what a book was charged for at upload, before
 * anything was rendered; `conversion_started_at` is what scopes the
 * count to a month. Both are additive — the old code ignores them — so
 * this is safe to apply before deploying the Worker.
 *
 * Hand-written for the same reason as the migration before it:
 * `payload migrate:create` hangs against the D1 adapter.
 */
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
