import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`credit_purchases\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`user_id\` integer NOT NULL,
  	\`order_id\` text NOT NULL,
  	\`credits\` numeric NOT NULL,
  	\`price_usd\` numeric NOT NULL,
  	\`pay_currency\` text NOT NULL,
  	\`provider_payment_id\` text,
  	\`pay_address\` text,
  	\`pay_amount\` text,
  	\`status\` text DEFAULT 'pending' NOT NULL,
  	\`expires_at\` text,
  	\`credited_at\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`credit_purchases_user_idx\` ON \`credit_purchases\` (\`user_id\`);`)
  await db.run(
    sql`CREATE UNIQUE INDEX \`credit_purchases_order_id_idx\` ON \`credit_purchases\` (\`order_id\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`credit_purchases_provider_payment_id_idx\` ON \`credit_purchases\` (\`provider_payment_id\`);`,
  )
  await db.run(sql`CREATE INDEX \`credit_purchases_status_idx\` ON \`credit_purchases\` (\`status\`);`)
  await db.run(
    sql`CREATE INDEX \`credit_purchases_updated_at_idx\` ON \`credit_purchases\` (\`updated_at\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`credit_purchases_created_at_idx\` ON \`credit_purchases\` (\`created_at\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`user_createdAt_purchase_idx\` ON \`credit_purchases\` (\`user_id\`,\`created_at\`);`,
  )

  await db.run(
    sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`credit_purchases_id\` integer REFERENCES credit_purchases(id);`,
  )
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_credit_purchases_id_idx\` ON \`payload_locked_documents_rels\` (\`credit_purchases_id\`);`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`payload_locked_documents_rels_credit_purchases_id_idx\`;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`credit_purchases_id\`;`)
  await db.run(sql`DROP TABLE \`credit_purchases\`;`)
}
