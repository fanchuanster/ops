import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * Whole books, credits, entitlements and the conversion portal.
 *
 * Written by hand rather than generated. `payload migrate:create` hangs
 * against the D1 adapter on this change — no output, no file — so the
 * DDL below follows the conventions of the generated migrations either
 * side of it: Payload's column naming (`conversion.state` becomes
 * `conversion_state`), its index naming, and its array-field tables.
 *
 * DESTRUCTIVE, deliberately and with the owner's approval. `parts` and
 * `parts_artifacts` are dropped outright. The seed re-creates the
 * library's books as whole works with their artifacts attached, so
 * nothing of value is in those tables at the time this runs — but if
 * this is ever replayed against a database with real part rows, their
 * content is gone. `down` restores the shape, never the rows.
 *
 * SQLite specifics worth knowing before editing:
 *   - DROP COLUMN refuses to touch an indexed column, so every index is
 *     dropped before its column.
 *   - A table cannot be dropped while another table's FK points at it,
 *     which is why `downloads.part_id` and the locked-documents
 *     relationship go first.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // --- readers gain a balance ---------------------------------------
  await db.run(sql`ALTER TABLE \`users\` ADD \`credits\` numeric DEFAULT 10;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`credits_granted_through\` text;`)

  // --- books absorb what parts used to carry -------------------------
  await db.run(sql`ALTER TABLE \`books\` ADD \`page_count\` numeric;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`price_credits\` numeric;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_state\` text DEFAULT 'none';`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_source_key\` text;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_source_filename\` text;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_job_id\` text;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`conversion_message\` text;`)
  await db.run(sql`CREATE INDEX \`books_page_count_idx\` ON \`books\` (\`page_count\`);`)
  await db.run(sql`CREATE INDEX \`books_price_credits_idx\` ON \`books\` (\`price_credits\`);`)
  await db.run(
    sql`CREATE INDEX \`books_conversion_conversion_state_idx\` ON \`books\` (\`conversion_state\`);`,
  )

  // Staged release paced a reader through a book's parts. No parts, no
  // pacing — the credit price is what governs access now.
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`staged_release_enabled\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`staged_release_unlock_delay_hours\`;`)

  await db.run(sql`CREATE TABLE \`books_artifacts\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`format\` text NOT NULL,
  	\`storage_key\` text NOT NULL,
  	\`bytes\` numeric,
  	\`checksum\` text,
  	\`downloadable\` integer DEFAULT true,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`books\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`books_artifacts_order_idx\` ON \`books_artifacts\` (\`_order\`);`)
  await db.run(
    sql`CREATE INDEX \`books_artifacts_parent_id_idx\` ON \`books_artifacts\` (\`_parent_id\`);`,
  )

  // --- deliveries are per book, and cost credits ---------------------
  //
  // Rebuilt rather than altered: SQLite refuses DROP COLUMN on a column
  // named in a foreign key, and `part_id` references `parts`. The
  // surviving rows are carried across; their part_id is dropped on the
  // floor, which is the point.
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_downloads\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`user_id\` integer NOT NULL,
  	\`book_id\` integer NOT NULL,
  	\`format\` text NOT NULL,
  	\`credits_paid\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`book_id\`) REFERENCES \`books\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(
    sql`INSERT INTO \`__new_downloads\`("id", "user_id", "book_id", "format", "updated_at", "created_at") SELECT "id", "user_id", "book_id", "format", "updated_at", "created_at" FROM \`downloads\`;`,
  )
  await db.run(sql`DROP TABLE \`downloads\`;`)
  await db.run(sql`ALTER TABLE \`__new_downloads\` RENAME TO \`downloads\`;`)
  await db.run(sql`CREATE INDEX \`downloads_user_idx\` ON \`downloads\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`downloads_book_idx\` ON \`downloads\` (\`book_id\`);`)
  await db.run(sql`CREATE INDEX \`downloads_updated_at_idx\` ON \`downloads\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`downloads_created_at_idx\` ON \`downloads\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`user_createdAt_idx\` ON \`downloads\` (\`user_id\`,\`created_at\`);`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)

  // --- reading progress is per book ----------------------------------
  await db.run(sql`ALTER TABLE \`reading_progress\` DROP COLUMN \`part_order\`;`)
  await db.run(sql`DROP INDEX \`user_book_idx\`;`)
  // (book, user) rather than (user, book): the name is global in SQLite
  // and `user_book_idx` is taken below by entitlements.
  await db.run(
    sql`CREATE UNIQUE INDEX \`book_user_idx\` ON \`reading_progress\` (\`book_id\`,\`user_id\`);`,
  )

  // --- books a reader has bought -------------------------------------
  // `user_id` cascades rather than SET NULLing: the column is NOT NULL,
  // so a SET NULL rule makes deleting a reader fail outright. Cascading
  // is also the right answer — a departed reader's purchases and credit
  // history should leave with them. `credit_ledger.book_id` is nullable
  // and keeps SET NULL, so deleting a book does not erase the record
  // that someone once paid for it.
  await db.run(sql`CREATE TABLE \`entitlements\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`user_id\` integer NOT NULL,
  	\`book_id\` integer NOT NULL,
  	\`credits_paid\` numeric NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`book_id\`) REFERENCES \`books\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`entitlements_user_idx\` ON \`entitlements\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`entitlements_book_idx\` ON \`entitlements\` (\`book_id\`);`)
  await db.run(
    sql`CREATE INDEX \`entitlements_updated_at_idx\` ON \`entitlements\` (\`updated_at\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`entitlements_created_at_idx\` ON \`entitlements\` (\`created_at\`);`,
  )
  // One purchase per reader per book. This is the constraint that makes
  // "already owned" a fact rather than a race.
  await db.run(
    sql`CREATE UNIQUE INDEX \`user_book_idx\` ON \`entitlements\` (\`user_id\`,\`book_id\`);`,
  )

  // --- every credit gained or spent ----------------------------------
  await db.run(sql`CREATE TABLE \`credit_ledger\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`user_id\` integer NOT NULL,
  	\`delta\` numeric NOT NULL,
  	\`reason\` text NOT NULL,
  	\`book_id\` integer,
  	\`month\` text,
  	\`balance_after\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`book_id\`) REFERENCES \`books\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`credit_ledger_user_idx\` ON \`credit_ledger\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`credit_ledger_reason_idx\` ON \`credit_ledger\` (\`reason\`);`)
  await db.run(sql`CREATE INDEX \`credit_ledger_book_idx\` ON \`credit_ledger\` (\`book_id\`);`)
  await db.run(sql`CREATE INDEX \`credit_ledger_month_idx\` ON \`credit_ledger\` (\`month\`);`)
  await db.run(
    sql`CREATE INDEX \`credit_ledger_updated_at_idx\` ON \`credit_ledger\` (\`updated_at\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`credit_ledger_created_at_idx\` ON \`credit_ledger\` (\`created_at\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`user_createdAt_credit_idx\` ON \`credit_ledger\` (\`user_id\`,\`created_at\`);`,
  )

  // --- the admin's lock table learns the new collections -------------
  //
  // Rebuilt for the same reason as downloads: `parts_id` is a foreign
  // key. These rows are transient editor locks, so nothing is carried
  // across — a stale lock is worth less than a clean table.
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	\`media_id\` integer,
  	\`books_id\` integer,
  	\`book_collections_id\` integer,
  	\`downloads_id\` integer,
  	\`entitlements_id\` integer,
  	\`credit_ledger_id\` integer,
  	\`reading_progress_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`books_id\`) REFERENCES \`books\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`book_collections_id\`) REFERENCES \`book_collections\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`downloads_id\`) REFERENCES \`downloads\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`entitlements_id\`) REFERENCES \`entitlements\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`credit_ledger_id\`) REFERENCES \`credit_ledger\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`reading_progress_id\`) REFERENCES \`reading_progress\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_books_id_idx\` ON \`payload_locked_documents_rels\` (\`books_id\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_book_collections_id_idx\` ON \`payload_locked_documents_rels\` (\`book_collections_id\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_downloads_id_idx\` ON \`payload_locked_documents_rels\` (\`downloads_id\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_entitlements_id_idx\` ON \`payload_locked_documents_rels\` (\`entitlements_id\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_credit_ledger_id_idx\` ON \`payload_locked_documents_rels\` (\`credit_ledger_id\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_reading_progress_id_idx\` ON \`payload_locked_documents_rels\` (\`reading_progress_id\`);`,
  )

  // --- and parts are gone --------------------------------------------
  await db.run(sql`DROP TABLE \`parts_artifacts\`;`)
  await db.run(sql`DROP TABLE \`parts\`;`)
}

/**
 * Restores the shape, not the content.
 *
 * `parts` and `parts_artifacts` come back empty, and the artifacts that
 * moved onto books are not moved back. This is a one-way change in
 * practice; `down` exists so the migration can be rolled off a database
 * during development, not so a production mistake can be undone.
 */
export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`parts\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`title\` text NOT NULL,
  	\`book_id\` integer NOT NULL,
  	\`order\` numeric DEFAULT 1 NOT NULL,
  	\`rights_status\` text,
  	\`status\` text DEFAULT 'draft' NOT NULL,
  	\`structured_content\` text,
  	\`structured_schema_version\` numeric DEFAULT 1,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`book_id\`) REFERENCES \`books\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`parts_book_idx\` ON \`parts\` (\`book_id\`);`)
  await db.run(sql`CREATE INDEX \`parts_order_idx\` ON \`parts\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`parts_updated_at_idx\` ON \`parts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`parts_created_at_idx\` ON \`parts\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`parts_artifacts\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`format\` text NOT NULL,
  	\`storage_key\` text NOT NULL,
  	\`bytes\` numeric,
  	\`checksum\` text,
  	\`downloadable\` integer DEFAULT true,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`parts\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`parts_artifacts_order_idx\` ON \`parts_artifacts\` (\`_order\`);`)
  await db.run(
    sql`CREATE INDEX \`parts_artifacts_parent_id_idx\` ON \`parts_artifacts\` (\`_parent_id\`);`,
  )

  await db.run(sql`DROP INDEX \`payload_locked_documents_rels_entitlements_id_idx\`;`)
  await db.run(sql`DROP INDEX \`payload_locked_documents_rels_credit_ledger_id_idx\`;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`entitlements_id\`;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`credit_ledger_id\`;`)
  await db.run(
    sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`parts_id\` integer REFERENCES parts(id);`,
  )
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_parts_id_idx\` ON \`payload_locked_documents_rels\` (\`parts_id\`);`,
  )

  await db.run(sql`DROP TABLE \`credit_ledger\`;`)
  await db.run(sql`DROP TABLE \`entitlements\`;`)
  await db.run(sql`DROP TABLE \`books_artifacts\`;`)

  await db.run(sql`DROP INDEX \`book_user_idx\`;`)
  await db.run(sql`CREATE INDEX \`user_book_idx\` ON \`reading_progress\` (\`user_id\`,\`book_id\`);`)
  await db.run(sql`ALTER TABLE \`reading_progress\` ADD \`part_order\` numeric NOT NULL DEFAULT 1;`)

  await db.run(sql`ALTER TABLE \`downloads\` DROP COLUMN \`credits_paid\`;`)
  await db.run(sql`ALTER TABLE \`downloads\` ADD \`part_id\` integer REFERENCES parts(id);`)
  await db.run(sql`CREATE INDEX \`downloads_part_idx\` ON \`downloads\` (\`part_id\`);`)

  await db.run(sql`DROP INDEX \`books_page_count_idx\`;`)
  await db.run(sql`DROP INDEX \`books_price_credits_idx\`;`)
  await db.run(sql`DROP INDEX \`books_conversion_conversion_state_idx\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`page_count\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`price_credits\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_state\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_source_key\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_source_filename\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_job_id\`;`)
  await db.run(sql`ALTER TABLE \`books\` DROP COLUMN \`conversion_message\`;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`staged_release_enabled\` integer DEFAULT false;`)
  await db.run(
    sql`ALTER TABLE \`books\` ADD \`staged_release_unlock_delay_hours\` numeric DEFAULT 24;`,
  )

  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`credits\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`credits_granted_through\`;`)
}
