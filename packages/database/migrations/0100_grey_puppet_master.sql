CREATE TABLE "platform_file_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"input" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_file_references" (
	"announcement_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	CONSTRAINT "platform_file_references_announcement_id_file_id_version_id_pk" PRIMARY KEY("announcement_id","file_id","version_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "platform_file_versions_identity_unique" ON "platform_file_versions" USING btree ("id","file_id");
--> statement-breakpoint
ALTER TABLE "platform_file_references" ADD CONSTRAINT "platform_file_references_announcement_id_platform_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."platform_announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_file_references" ADD CONSTRAINT "platform_file_references_version_fk" FOREIGN KEY ("version_id","file_id") REFERENCES "public"."platform_file_versions"("id","file_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_file_references_version_idx" ON "platform_file_references" USING btree ("version_id");--> statement-breakpoint
