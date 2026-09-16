import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_source_hash\` text;`)
  await db.run(
    sql`CREATE INDEX \`books_conversion_conversion_source_hash_idx\` ON \`books\` (\`conversion_source_hash\`);`,
  )
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`books_conversion_conversion_source_hash_idx\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_source_hash\`;`)
}
