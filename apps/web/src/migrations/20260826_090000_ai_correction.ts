import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * Whether the uploader asked for AI-assisted correction.
 *
 * The AI stage sends a book's text to a third-party model to have OCR
 * damage suggested away (CLAUDE.md section 4). Until now the web
 * application passed `allow_third_party_ai: false` as a hard-coded
 * constant, on a rule in section 6.1 that forbade sending a reader's
 * upload to a third party at all.
 *
 * That rule is gone, and what replaced it is not permission-by-default:
 * it is the uploader's own decision, disclosed on the screen where the
 * choice is made. This column is where their answer lives.
 *
 * `DEFAULT false`, and every existing row is set explicitly rather than
 * left to SQLite's ADD COLUMN behaviour. The safe end of the wrong guess
 * is the whole point here — a book whose uploader was never asked must
 * never be sent anywhere, and the books already in the library were
 * uploaded under a regime that promised exactly that.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(
    sql`ALTER TABLE \`books\` ADD \`conversion_ai_correction\` integer DEFAULT false;`,
  )
  await db.run(
    sql`UPDATE \`books\` SET \`conversion_ai_correction\` = 0 WHERE \`conversion_ai_correction\` IS NULL;`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_ai_correction\`;`)
}
