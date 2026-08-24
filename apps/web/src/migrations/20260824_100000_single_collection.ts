import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * One book, one shelf.
 *
 * `books.collections` was `hasMany`, so the pairs lived in `books_rels`.
 * They move to a column, because a book belongs on one shelf and a
 * reader finds it under every parent of that shelf without it being
 * filed there twice (`domain/collectionTree.ts`).
 *
 * **Which shelf a dual-filed book keeps: the lowest `order`.** That is
 * the one an editor picked first, and on this catalog it is the right
 * answer every time — all three books on two shelves carry Chinese
 * Classics at order 1 and their second shelf at order 2. It is a
 * choice rather than a derivation, and the losing row is deleted, so
 * this is the statement to read if a book turns up on the wrong shelf
 * afterwards.
 *
 * The `DELETE` is scoped to `path = 'collections'`. `books_rels` is
 * shared by every relationship on the collection, and an unscoped
 * delete would take the rest with it.
 *
 * `down` puts the rows back at order 1. It cannot restore the second
 * shelf of a book that had two — that information is gone the moment
 * `up` runs, which is worth knowing before running it.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(
    sql`ALTER TABLE \`books\` ADD \`collection_id\` integer REFERENCES \`book_collections\`(\`id\`) ON UPDATE no action ON DELETE set null;`,
  )
  await db.run(sql`
    UPDATE \`books\` SET \`collection_id\` = (
      SELECT \`book_collections_id\` FROM \`books_rels\`
      WHERE \`books_rels\`.\`parent_id\` = \`books\`.\`id\`
        AND \`books_rels\`.\`path\` = 'collections'
        AND \`books_rels\`.\`book_collections_id\` IS NOT NULL
      ORDER BY \`books_rels\`.\`order\`
      LIMIT 1
    );
  `)
  await db.run(sql`DELETE FROM \`books_rels\` WHERE \`path\` = 'collections';`)
  await db.run(sql`CREATE INDEX \`books_collection_idx\` ON \`books\` (\`collection_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`
    INSERT INTO \`books_rels\` (\`order\`, \`parent_id\`, \`path\`, \`book_collections_id\`)
    SELECT 1, \`id\`, 'collections', \`collection_id\` FROM \`books\`
    WHERE \`collection_id\` IS NOT NULL;
  `)
  await db.run(sql`DROP INDEX \`books_collection_idx\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`collection_id\`;`)
}
