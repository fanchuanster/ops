import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * How each shelf orders its own children.
 *
 * The library had one global answer to that — the reader's A–Z /
 * Curated toggle, defaulting to Curated — and one answer is wrong for a
 * library where most shelves have no order of their own and a few have
 * a strong one. A ten-volume set must read in volume order; "Chinese
 * History" just needs to be findable.
 *
 * So the decision moves onto the shelf, and its default is
 * alphabetical: a reader can predict the alphabet, and a curator turns
 * on order ids for the shelves that earn it.
 *
 * `DEFAULT 'alphabetical'` rather than a nullable column, so every
 * existing shelf reads A–Z from the moment this lands and nothing has
 * to interpret an absent value at query time. `domain/shelfOrder.ts`
 * still treats an unrecognised value as alphabetical, which is the
 * belt to this column's braces.
 *
 * Order ids are untouched. Every book already carries one and keeps it;
 * this only decides which shelves consult them. That is what makes this
 * migration safe on a library that already has a curated volume set
 * sitting in it — nothing renumbers, nothing moves, and the one shelf
 * that needs order ids is switched over by hand afterwards.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(
    sql`ALTER TABLE \`book_collections\` ADD \`child_order\` text DEFAULT 'alphabetical';`,
  )
  // Existing rows do not get the column default on SQLite's ADD COLUMN
  // in every version, so it is stated rather than assumed.
  await db.run(
    sql`UPDATE \`book_collections\` SET \`child_order\` = 'alphabetical' WHERE \`child_order\` IS NULL;`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`book_collections\` DROP COLUMN \`child_order\`;`)
}
