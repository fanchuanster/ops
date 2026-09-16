import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`books_conversion_sources\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`kind\` text NOT NULL,
  	\`storage_key\` text NOT NULL,
  	\`filename\` text,
  	\`bytes\` numeric,
  	\`added_at\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`books\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)

  await db.run(
    sql`CREATE INDEX \`books_conversion_sources_order_idx\` ON \`books_conversion_sources\` (\`_order\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`books_conversion_sources_parent_id_idx\` ON \`books_conversion_sources\` (\`_parent_id\`);`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`books_conversion_sources\`;`)
}
