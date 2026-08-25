import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * `books.translator` goes.
 *
 * It was on the book from the first migration and on the upload form
 * since 2026-08-21, and in that time nothing ever filled it in
 * automatically: `domain/metadata.ts` reads a title, an author, a
 * language and a length out of a file, and no source carries a
 * translator. So it was the one field on that form that was always
 * empty and always prose — a box asking an uploader confirming their
 * own scan to compose something, which is exactly the argument that
 * kept it off the form in the first place.
 *
 * Where the credit actually belongs is the description, which is where
 * both seed books already carried it ("This edition presents James
 * Legge's 1891 translation…") — so the byline on the book page loses
 * nothing a reader was relying on.
 *
 * **`down` restores the column, not the data.** SQLite drops the values
 * with it and no copy is kept: the two seed books are re-seedable, and
 * the field is empty on every uploaded book by construction. Worth
 * reading before running it against a database where someone had been
 * filling it in by hand through the admin API.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`translator\`;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`translator\` text;`)
}
