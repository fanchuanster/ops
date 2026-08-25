import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * The order the books on a shelf are in.
 *
 * Collections got `sort_order` on 2026-08-21 for exactly this reason —
 * the order the shelves appear in was an accident of the alphabet — and
 * the books *on* those shelves were left alphabetical. This gives them
 * the same thing: a number carried by the book, unique among its
 * shelf's books, assigned when it is filed and editable afterwards
 * (`domain/shelfOrder.ts`).
 *
 * ## Backfilled in title order, deliberately
 *
 * Every existing book is numbered 1, 2, 3… down its own shelf **in the
 * alphabetical order it has today**. So nothing a reader sees moves on
 * the day this ships: the curated order starts out as the order that
 * was already there, and becomes a thing an editor can change rather
 * than an accident of the letter A. Numbering by upload date would have
 * silently reshuffled every shelf in the library instead.
 *
 * Books on no shelf keep a null. An order id is a position among a
 * collection's own books, so off the shelf there is nothing for it to
 * be a position in.
 *
 * ## The collections are renumbered too
 *
 * `sort_order` was nullable and mostly null — the catalog sorted on it
 * *then* title precisely so that unset rows still landed somewhere
 * sensible. That fallback stays, but leaving most shelves unnumbered
 * would mean the number an editor types into the new box has nothing to
 * be relative to. So every collection is given one, per parent, in the
 * order it is displayed in today (`sort_order` then title). Shelves
 * somebody had already ordered keep that order; the numbers underneath
 * it become dense and 1-based.
 *
 * `books.collection_order` is indexed: the catalog sorts on it on every
 * browse of the library. `book_collections.sort_order` still is not —
 * there are tens of collections and the query that reads them fetches
 * all of them anyway.
 *
 * `down` drops the book column and leaves the collection numbers as
 * they are. They are valid `sort_order` values whether this migration
 * ran or not, and throwing away an editor's ordering to undo a
 * renumbering is not a reversal, it is a second loss.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`collection_order\` numeric;`)

  // Rank within the shelf, by the title the shelf is displayed in
  // today. The ranking is a **materialized** CTE and not a correlated
  // subquery over the table being written: SQLite evaluates a
  // correlated subquery against the live table, so a statement that
  // ranks rows by a column it is also rewriting reads its own writes
  // and produces duplicates. That is not hypothetical — it is what the
  // first draft of the collection update below did, and three root
  // shelves came out numbered 7.
  //
  // Titles are unique (`20260824_060000_unique_title`), so the id
  // tie-break can never actually be reached; it is there so the rank is
  // a total order regardless.
  await db.run(sql`
    WITH \`ranked\` AS MATERIALIZED (
      SELECT \`id\`, ROW_NUMBER() OVER (
        PARTITION BY \`collection_id\` ORDER BY \`title\`, \`id\`
      ) AS \`rank\`
      FROM \`books\` WHERE \`collection_id\` IS NOT NULL
    )
    UPDATE \`books\` SET \`collection_order\` = (
      SELECT \`rank\` FROM \`ranked\` WHERE \`ranked\`.\`id\` = \`books\`.\`id\`
    )
    WHERE \`collection_id\` IS NOT NULL;
  `)

  await db.run(sql`CREATE INDEX \`books_collection_order_idx\` ON \`books\` (\`collection_order\`);`)

  // The same rank, per parent, over the order the shelves are displayed
  // in now: `sort_order` first, title second. A null `sort_order` sorts
  // after every number — the catalog's `['sortOrder', 'title']` already
  // behaves that way, and it is restated here because SQLite orders
  // NULL first.
  await db.run(sql`
    WITH \`ranked\` AS MATERIALIZED (
      SELECT \`id\`, ROW_NUMBER() OVER (
        PARTITION BY \`parent_id\`
        ORDER BY (\`sort_order\` IS NULL), \`sort_order\`, \`title\`, \`id\`
      ) AS \`rank\`
      FROM \`book_collections\`
    )
    UPDATE \`book_collections\` SET \`sort_order\` = (
      SELECT \`rank\` FROM \`ranked\` WHERE \`ranked\`.\`id\` = \`book_collections\`.\`id\`
    );
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`books_collection_order_idx\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`collection_order\`;`)
}
