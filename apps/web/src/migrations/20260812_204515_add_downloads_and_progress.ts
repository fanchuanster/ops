import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "downloads" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"book_id" integer NOT NULL,
  	"part_id" integer NOT NULL,
  	"format" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "reading_progress" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"book_id" integer NOT NULL,
  	"part_order" numeric NOT NULL,
  	"started_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "downloads_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "reading_progress_id" integer;
  ALTER TABLE "downloads" ADD CONSTRAINT "downloads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "downloads" ADD CONSTRAINT "downloads_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "downloads" ADD CONSTRAINT "downloads_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "downloads_user_idx" ON "downloads" USING btree ("user_id");
  CREATE INDEX "downloads_book_idx" ON "downloads" USING btree ("book_id");
  CREATE INDEX "downloads_part_idx" ON "downloads" USING btree ("part_id");
  CREATE INDEX "downloads_updated_at_idx" ON "downloads" USING btree ("updated_at");
  CREATE INDEX "downloads_created_at_idx" ON "downloads" USING btree ("created_at");
  CREATE INDEX "user_createdAt_idx" ON "downloads" USING btree ("user_id","created_at");
  CREATE INDEX "reading_progress_user_idx" ON "reading_progress" USING btree ("user_id");
  CREATE INDEX "reading_progress_book_idx" ON "reading_progress" USING btree ("book_id");
  CREATE INDEX "reading_progress_updated_at_idx" ON "reading_progress" USING btree ("updated_at");
  CREATE INDEX "reading_progress_created_at_idx" ON "reading_progress" USING btree ("created_at");
  CREATE INDEX "user_book_idx" ON "reading_progress" USING btree ("user_id","book_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_downloads_fk" FOREIGN KEY ("downloads_id") REFERENCES "public"."downloads"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_reading_progress_fk" FOREIGN KEY ("reading_progress_id") REFERENCES "public"."reading_progress"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_downloads_id_idx" ON "payload_locked_documents_rels" USING btree ("downloads_id");
  CREATE INDEX "payload_locked_documents_rels_reading_progress_id_idx" ON "payload_locked_documents_rels" USING btree ("reading_progress_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "downloads" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "reading_progress" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "downloads" CASCADE;
  DROP TABLE "reading_progress" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_downloads_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_reading_progress_fk";
  
  DROP INDEX "payload_locked_documents_rels_downloads_id_idx";
  DROP INDEX "payload_locked_documents_rels_reading_progress_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "downloads_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "reading_progress_id";`)
}
