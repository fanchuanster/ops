import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`books\` ADD \`level\` numeric DEFAULT 20 NOT NULL;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`review_state\` text DEFAULT 'unsubmitted' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`review_submitted_at\` text;`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`review_reviewed_by_id\` integer REFERENCES users(id);`)
  await db.run(sql`ALTER TABLE \`books\` ADD \`review_note\` text;`)
  await db.run(sql`CREATE INDEX \`books_level_idx\` ON \`books\` (\`level\`);`)
  await db.run(sql`CREATE INDEX \`books_review_review_state_idx\` ON \`books\` (\`review_state\`);`)
  await db.run(sql`CREATE INDEX \`books_review_review_reviewed_by_idx\` ON \`books\` (\`review_reviewed_by_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_books\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`title\` text NOT NULL,
  	\`slug\` text NOT NULL,
  	\`subtitle\` text,
  	\`original_title\` text,
  	\`author\` text,
  	\`translator\` text,
  	\`language\` text DEFAULT 'zh-Hant',
  	\`description\` text,
  	\`cover_id\` integer,
  	\`rights_status\` text DEFAULT 'unknown' NOT NULL,
  	\`visibility\` text DEFAULT 'private' NOT NULL,
  	\`owner_id\` integer,
  	\`status\` text DEFAULT 'draft' NOT NULL,
  	\`staged_release_enabled\` integer DEFAULT false,
  	\`staged_release_unlock_delay_hours\` numeric DEFAULT 24,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`cover_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`owner_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_books\`("id", "title", "slug", "subtitle", "original_title", "author", "translator", "language", "description", "cover_id", "rights_status", "visibility", "owner_id", "status", "staged_release_enabled", "staged_release_unlock_delay_hours", "updated_at", "created_at") SELECT "id", "title", "slug", "subtitle", "original_title", "author", "translator", "language", "description", "cover_id", "rights_status", "visibility", "owner_id", "status", "staged_release_enabled", "staged_release_unlock_delay_hours", "updated_at", "created_at" FROM \`books\`;`)
  await db.run(sql`DROP TABLE \`books\`;`)
  await db.run(sql`ALTER TABLE \`__new_books\` RENAME TO \`books\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`books_title_idx\` ON \`books\` (\`title\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`books_slug_idx\` ON \`books\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`books_author_idx\` ON \`books\` (\`author\`);`)
  await db.run(sql`CREATE INDEX \`books_cover_idx\` ON \`books\` (\`cover_id\`);`)
  await db.run(sql`CREATE INDEX \`books_rights_status_idx\` ON \`books\` (\`rights_status\`);`)
  await db.run(sql`CREATE INDEX \`books_owner_idx\` ON \`books\` (\`owner_id\`);`)
  await db.run(sql`CREATE INDEX \`books_updated_at_idx\` ON \`books\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`books_created_at_idx\` ON \`books\` (\`created_at\`);`)
}
