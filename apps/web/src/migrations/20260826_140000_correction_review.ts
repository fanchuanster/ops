import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * Where AI correction keeps its state, so a person can decide on it.
 *
 * `conversion_ai_correction` recorded the uploader's *consent* and
 * nothing acted on it: the flag reached the converter, which advanced a
 * progress label and never called the correction stage at all. The stage
 * existed only in the CLI, so the checkbox proposed nothing and sent no
 * text anywhere.
 *
 * These columns are what the checkbox now drives. Correction is three
 * acts with a human in the middle — propose, decide, apply — and it runs
 * beside the conversion pipeline on its own state rather than inside it,
 * because a book waiting on a reader's judgement is not converting and
 * must not hold up the EPUB. See `domain/correction.ts`.
 *
 * Every existing row is set to 'none' explicitly rather than left to
 * SQLite's ADD COLUMN default. A NULL here would be worse than untidy:
 * the claim query is a compare-and-swap over this column, and in SQL
 * `state != 'running'` is NULL for a NULL row — so a book with no value
 * would be invisible to every query that looks for work and could never
 * be corrected or repaired.
 */
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

  // The claim loop asks for one state at a time across every book, so
  // this is the index that keeps a poll from scanning the table.
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
