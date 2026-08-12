import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`users_roles\` (
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`value\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`users_roles_order_idx\` ON \`users_roles\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`users_roles_parent_idx\` ON \`users_roles\` (\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`users_sessions\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`created_at\` text,
  	\`expires_at\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`users_sessions_order_idx\` ON \`users_sessions\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`users_sessions_parent_id_idx\` ON \`users_sessions\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`users\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`display_name\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`email\` text NOT NULL,
  	\`reset_password_token\` text,
  	\`reset_password_expiration\` text,
  	\`salt\` text,
  	\`hash\` text,
  	\`login_attempts\` numeric DEFAULT 0,
  	\`lock_until\` text
  );
  `)
  await db.run(sql`CREATE INDEX \`users_updated_at_idx\` ON \`users\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`users_created_at_idx\` ON \`users\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_email_idx\` ON \`users\` (\`email\`);`)
  await db.run(sql`CREATE TABLE \`media\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`alt\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`url\` text,
  	\`thumbnail_u_r_l\` text,
  	\`filename\` text,
  	\`mime_type\` text,
  	\`filesize\` numeric,
  	\`width\` numeric,
  	\`height\` numeric,
  	\`focal_x\` numeric,
  	\`focal_y\` numeric
  );
  `)
  await db.run(sql`CREATE INDEX \`media_updated_at_idx\` ON \`media\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`media_created_at_idx\` ON \`media\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`media_filename_idx\` ON \`media\` (\`filename\`);`)
  await db.run(sql`CREATE TABLE \`books\` (
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
  await db.run(sql`CREATE INDEX \`books_title_idx\` ON \`books\` (\`title\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`books_slug_idx\` ON \`books\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`books_author_idx\` ON \`books\` (\`author\`);`)
  await db.run(sql`CREATE INDEX \`books_cover_idx\` ON \`books\` (\`cover_id\`);`)
  await db.run(sql`CREATE INDEX \`books_rights_status_idx\` ON \`books\` (\`rights_status\`);`)
  await db.run(sql`CREATE INDEX \`books_owner_idx\` ON \`books\` (\`owner_id\`);`)
  await db.run(sql`CREATE INDEX \`books_updated_at_idx\` ON \`books\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`books_created_at_idx\` ON \`books\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`books_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`book_collections_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`books\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`book_collections_id\`) REFERENCES \`book_collections\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`books_rels_order_idx\` ON \`books_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`books_rels_parent_idx\` ON \`books_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`books_rels_path_idx\` ON \`books_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`books_rels_book_collections_id_idx\` ON \`books_rels\` (\`book_collections_id\`);`)
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
  await db.run(sql`CREATE INDEX \`parts_artifacts_parent_id_idx\` ON \`parts_artifacts\` (\`_parent_id\`);`)
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
  await db.run(sql`CREATE TABLE \`book_collections\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`title\` text NOT NULL,
  	\`slug\` text NOT NULL,
  	\`description\` text,
  	\`parent_id\` integer,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`book_collections\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`book_collections_slug_idx\` ON \`book_collections\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`book_collections_parent_idx\` ON \`book_collections\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`book_collections_updated_at_idx\` ON \`book_collections\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`book_collections_created_at_idx\` ON \`book_collections\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`downloads\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`user_id\` integer NOT NULL,
  	\`book_id\` integer NOT NULL,
  	\`part_id\` integer NOT NULL,
  	\`format\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`book_id\`) REFERENCES \`books\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`part_id\`) REFERENCES \`parts\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`downloads_user_idx\` ON \`downloads\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`downloads_book_idx\` ON \`downloads\` (\`book_id\`);`)
  await db.run(sql`CREATE INDEX \`downloads_part_idx\` ON \`downloads\` (\`part_id\`);`)
  await db.run(sql`CREATE INDEX \`downloads_updated_at_idx\` ON \`downloads\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`downloads_created_at_idx\` ON \`downloads\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`user_createdAt_idx\` ON \`downloads\` (\`user_id\`,\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`reading_progress\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`user_id\` integer NOT NULL,
  	\`book_id\` integer NOT NULL,
  	\`part_order\` numeric NOT NULL,
  	\`started_at\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`book_id\`) REFERENCES \`books\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`reading_progress_user_idx\` ON \`reading_progress\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`reading_progress_book_idx\` ON \`reading_progress\` (\`book_id\`);`)
  await db.run(sql`CREATE INDEX \`reading_progress_updated_at_idx\` ON \`reading_progress\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`reading_progress_created_at_idx\` ON \`reading_progress\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`user_book_idx\` ON \`reading_progress\` (\`user_id\`,\`book_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_kv\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`data\` text NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payload_kv_key_idx\` ON \`payload_kv\` (\`key\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`global_slug\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_global_slug_idx\` ON \`payload_locked_documents\` (\`global_slug\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_updated_at_idx\` ON \`payload_locked_documents\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_created_at_idx\` ON \`payload_locked_documents\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	\`media_id\` integer,
  	\`books_id\` integer,
  	\`parts_id\` integer,
  	\`book_collections_id\` integer,
  	\`downloads_id\` integer,
  	\`reading_progress_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`books_id\`) REFERENCES \`books\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`parts_id\`) REFERENCES \`parts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`book_collections_id\`) REFERENCES \`book_collections\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`downloads_id\`) REFERENCES \`downloads\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`reading_progress_id\`) REFERENCES \`reading_progress\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_books_id_idx\` ON \`payload_locked_documents_rels\` (\`books_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parts_id_idx\` ON \`payload_locked_documents_rels\` (\`parts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_book_collections_id_idx\` ON \`payload_locked_documents_rels\` (\`book_collections_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_downloads_id_idx\` ON \`payload_locked_documents_rels\` (\`downloads_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_reading_progress_id_idx\` ON \`payload_locked_documents_rels\` (\`reading_progress_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text,
  	\`value\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_key_idx\` ON \`payload_preferences\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_updated_at_idx\` ON \`payload_preferences\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_created_at_idx\` ON \`payload_preferences\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_preferences\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_order_idx\` ON \`payload_preferences_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_parent_idx\` ON \`payload_preferences_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_path_idx\` ON \`payload_preferences_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_users_id_idx\` ON \`payload_preferences_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_migrations\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text,
  	\`batch\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_migrations_updated_at_idx\` ON \`payload_migrations\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_migrations_created_at_idx\` ON \`payload_migrations\` (\`created_at\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`users_roles\`;`)
  await db.run(sql`DROP TABLE \`users_sessions\`;`)
  await db.run(sql`DROP TABLE \`users\`;`)
  await db.run(sql`DROP TABLE \`media\`;`)
  await db.run(sql`DROP TABLE \`books\`;`)
  await db.run(sql`DROP TABLE \`books_rels\`;`)
  await db.run(sql`DROP TABLE \`parts_artifacts\`;`)
  await db.run(sql`DROP TABLE \`parts\`;`)
  await db.run(sql`DROP TABLE \`book_collections\`;`)
  await db.run(sql`DROP TABLE \`downloads\`;`)
  await db.run(sql`DROP TABLE \`reading_progress\`;`)
  await db.run(sql`DROP TABLE \`payload_kv\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_migrations\`;`)
}
