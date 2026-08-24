import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * One book, one title.
 *
 * `books_title_idx` has existed since the first migration as an ordinary
 * index — the catalog searches on title, so it was there for the read.
 * This makes it unique, which is a constraint rather than a lookup: the
 * same scan was uploaded twice and sat in the library as two books, and
 * nothing in the write path would ever have noticed. Every upload mints
 * its own job id and the slug carries eight characters of it precisely
 * so that two uploads *cannot* collide, and the one content-hash check
 * that exists (`conversion.sourceHash`) only runs in the Adobe export
 * path, which a PDF published as it stands never enters.
 *
 * SQLite cannot alter an index in place, so this drops and recreates.
 * Both statements are cheap on a catalog this size, and the recreate is
 * what will fail — loudly, before anything else runs — if two rows
 * still share a title. That is the correct failure: silently keeping
 * the old index would leave the schema disagreeing with the collection.
 *
 * Trailing whitespace is not a way around it. `title` carries a
 * `beforeValidate` hook that trims, so what reaches this index is
 * already normalised (`collections/Books.ts`).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`books_title_idx\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`books_title_idx\` ON \`books\` (\`title\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`books_title_idx\`;`)
  await db.run(sql`CREATE INDEX \`books_title_idx\` ON \`books\` (\`title\`);`)
}
