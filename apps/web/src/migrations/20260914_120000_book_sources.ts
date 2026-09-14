import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * Every file a book was made from, not just the one being converted.
 *
 * A book had exactly one source until now — `conversion.source_kind`,
 * `source_key` and `source_filename` — chosen at upload and never
 * revisited. This table is what lets it hold several, so that its owner
 * can say which one the DOCX master is built from and change their mind
 * (`domain/sources.ts`).
 *
 * The case it exists for is a scan and a transcription of the same book.
 * Adobe reading the scan costs money, takes minutes and gets characters
 * wrong; a transcription is free, instant and right. Under one source
 * per book the uploader had to choose before seeing either result.
 *
 * ## Nothing is backfilled, deliberately
 *
 * Every existing book has one source and will have no row here, which is
 * exactly the state `readSources` is written for: an empty list falls
 * back to synthesizing the single entry from the three columns on
 * `books`. A backfill would have to invent a `storage_key` for each —
 * and the honest one is not `conversion_source_key`, which for most rows
 * still points into the `conversion/` prefix the R2 lifecycle rule
 * sweeps after 30 days. Rows are written when a file is *filed* under
 * the book, by `fileOriginal` in `lib/masterPipeline.ts`, which is where
 * the durable key is minted.
 *
 * So this is purely additive: safe to apply before the Worker that
 * reads it, and a Worker deployed before it simply finds no rows and
 * behaves exactly as it did.
 *
 * `storage_key` is NOT NULL because a source with no file is not a
 * source; `filename` is nullable because a name is how a person
 * recognises the file, not how anything finds it.
 */
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
  // The list is only ever read for a book already in hand, so this is
  // the one index that earns its place — and it is the one the cascade
  // delete uses too.
  await db.run(
    sql`CREATE INDEX \`books_conversion_sources_parent_id_idx\` ON \`books_conversion_sources\` (\`_parent_id\`);`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`books_conversion_sources\`;`)
}
