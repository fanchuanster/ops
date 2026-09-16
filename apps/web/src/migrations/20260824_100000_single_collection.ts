import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

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
