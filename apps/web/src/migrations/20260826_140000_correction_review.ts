import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(
    sql`ALTER TABLE \`books\` ADD \`conversion_correction_state\` text DEFAULT 'none';`,
  )
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_correction_suggestions_key\` text;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_correction_decisions_key\` text;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_correction_count\` numeric;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_correction_adopted\` numeric;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_correction_message\` text;`)

  await db.run(
    sql`UPDATE \`books\` SET \`conversion_correction_state\` = 'none' WHERE \`conversion_correction_state\` IS NULL;`,
  )

  await db.run(
    sql`CREATE INDEX IF NOT EXISTS \`books_conversion_correction_state_idx\` ON \`books\` (\`conversion_correction_state\`);`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX IF EXISTS \`books_conversion_correction_state_idx\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_correction_message\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_correction_adopted\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_correction_count\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_correction_decisions_key\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_correction_suggestions_key\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_correction_state\`;`)
}
