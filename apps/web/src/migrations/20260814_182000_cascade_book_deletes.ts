import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * Let a reader actually delete their own book.
 *
 * `downloads` and `reading_progress` both declared `ON DELETE set null`
 * on columns that are `NOT NULL` — a contradiction SQLite only notices
 * at the moment of deletion, when it refuses. So deleting a book worked
 * right up until someone had opened it in the reader or had it
 * delivered, and then failed with a constraint error the reader could
 * do nothing about.
 *
 * The same shape as the entitlements fix in the credits migration. It
 * recurs because Payload generates `set null` for every relationship
 * regardless of whether the column is nullable.
 *
 * Cascade is also the right answer on the merits: a delivery record or a
 * reading position for a book that no longer exists describes nothing.
 * `credit_ledger.book_id` keeps `set null` deliberately — the credits
 * were really spent, and that history outlives the book.
 *
 * Both tables are rebuilt because SQLite cannot alter a foreign key.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`PRAGMA foreign_keys=OFF;`)

  await db.run(sql`CREATE TABLE \`__new_downloads\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`user_id\` integer NOT NULL,
  	\`book_id\` integer NOT NULL,
  	\`format\` text NOT NULL,
  	\`credits_paid\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`book_id\`) REFERENCES \`books\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(
    sql`INSERT INTO \`__new_downloads\` SELECT \`id\`, \`user_id\`, \`book_id\`, \`format\`, \`credits_paid\`, \`updated_at\`, \`created_at\` FROM \`downloads\`;`,
  )
  await db.run(sql`DROP TABLE \`downloads\`;`)
  await db.run(sql`ALTER TABLE \`__new_downloads\` RENAME TO \`downloads\`;`)
  await db.run(sql`CREATE INDEX \`downloads_user_idx\` ON \`downloads\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`downloads_book_idx\` ON \`downloads\` (\`book_id\`);`)
  await db.run(sql`CREATE INDEX \`downloads_updated_at_idx\` ON \`downloads\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`downloads_created_at_idx\` ON \`downloads\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`user_createdAt_idx\` ON \`downloads\` (\`user_id\`,\`created_at\`);`)

  await db.run(sql`CREATE TABLE \`__new_reading_progress\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`user_id\` integer NOT NULL,
  	\`book_id\` integer NOT NULL,
  	\`started_at\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`book_id\`) REFERENCES \`books\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(
    sql`INSERT INTO \`__new_reading_progress\` SELECT \`id\`, \`user_id\`, \`book_id\`, \`started_at\`, \`updated_at\`, \`created_at\` FROM \`reading_progress\`;`,
  )
  await db.run(sql`DROP TABLE \`reading_progress\`;`)
  await db.run(sql`ALTER TABLE \`__new_reading_progress\` RENAME TO \`reading_progress\`;`)
  await db.run(sql`CREATE INDEX \`reading_progress_user_idx\` ON \`reading_progress\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`reading_progress_book_idx\` ON \`reading_progress\` (\`book_id\`);`)
  await db.run(
    sql`CREATE INDEX \`reading_progress_updated_at_idx\` ON \`reading_progress\` (\`updated_at\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`reading_progress_created_at_idx\` ON \`reading_progress\` (\`created_at\`);`,
  )
  await db.run(
    sql`CREATE UNIQUE INDEX \`book_user_idx\` ON \`reading_progress\` (\`book_id\`,\`user_id\`);`,
  )

  await db.run(sql`PRAGMA foreign_keys=ON;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  // Deliberately not reversed. Restoring `set null` on a NOT NULL column
  // would only restore the bug, and nothing depends on the old rule.
}
