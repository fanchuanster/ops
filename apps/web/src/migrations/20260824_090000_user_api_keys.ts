import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * Per-user API keys, so a script can act as its owner.
 *
 * The three columns Payload's `useAPIKey` adds to an auth collection.
 * They are nullable and default to nothing, so every account that
 * already exists is unaffected and nobody gains access by this running
 * — a key exists only once its owner asks for one.
 *
 * `api_key_index` is what a lookup actually matches on, so it is
 * indexed: authenticating a key must not cost a scan of the users
 * table. It is deliberately *not* unique. Payload derives it from the
 * key and the payload secret, and a unique index here would turn a
 * hash collision into a failed write for an unrelated account rather
 * than a failed authentication.
 *
 * A shared secret in the environment was the alternative, and it is the
 * pattern `CONVERTER_SECRET` already uses. It loses the one thing that
 * matters here: publishing a book records who approved it, and a token
 * with no owner has no answer.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`users\` ADD \`enable_a_p_i_key\` integer;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`api_key\` text;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`api_key_index\` text;`)
  await db.run(sql`CREATE INDEX \`users_api_key_index_idx\` ON \`users\` (\`api_key_index\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`users_api_key_index_idx\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`api_key_index\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`api_key\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`enable_a_p_i_key\`;`)
}
