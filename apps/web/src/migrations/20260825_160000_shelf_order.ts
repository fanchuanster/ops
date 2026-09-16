import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`collection_order\` numeric;`)

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
