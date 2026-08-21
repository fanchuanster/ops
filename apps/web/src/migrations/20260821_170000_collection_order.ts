import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * The order the shelves appear in.
 *
 * Collections were listed alphabetically, which is an ordering nobody
 * chose: "Chinese Classics" leading and "Philosophy & Wisdom" trailing
 * is an accident of the letter C, not an editorial judgement about
 * where a reader should start. The home page is a row of shelves and
 * the first one is the one most readers will ever look at, so somebody
 * should be deciding.
 *
 * Nullable rather than defaulted to 0, and the catalog sorts on
 * `sortOrder` then `title`. That way every existing row keeps exactly
 * the order it has today until an editor moves something, and the
 * alphabetical fallback stays underneath as the tie-break for anything
 * never touched.
 *
 * No index: there are tens of collections, not thousands, and the
 * query that reads them already fetches all of them.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`book_collections\` ADD \`sort_order\` numeric;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`book_collections\` DROP COLUMN \`sort_order\`;`)
}
