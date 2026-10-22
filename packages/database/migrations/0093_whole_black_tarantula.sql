CREATE TABLE "platform_file_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"path" text[] NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"current_version_id" uuid,
	"busy_operation_id" uuid,
	"trash_root_id" uuid,
	"deleted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_file_entries_kind_check" CHECK ("platform_file_entries"."kind" IN ('file','folder')),
	CONSTRAINT "platform_file_entries_state_check" CHECK ("platform_file_entries"."state" IN ('active','trashed','purged')),
	CONSTRAINT "platform_file_entries_revision_check" CHECK ("platform_file_entries"."revision" >= 1),
	CONSTRAINT "platform_file_entries_root_check" CHECK (("platform_file_entries"."parent_id" IS NULL AND "platform_file_entries"."kind" = 'folder' AND "platform_file_entries"."name" = '' AND cardinality("platform_file_entries"."path") = 0 AND "platform_file_entries"."state" = 'active') OR ("platform_file_entries"."parent_id" IS NOT NULL AND cardinality("platform_file_entries"."path") > 0 AND "platform_file_entries"."path"[cardinality("platform_file_entries"."path")] = "platform_file_entries"."name")),
	CONSTRAINT "platform_file_entries_name_check" CHECK ("platform_file_entries"."parent_id" IS NULL OR (octet_length("platform_file_entries"."name") BETWEEN 1 AND CASE WHEN "platform_file_entries"."kind" = 'folder' THEN 246 ELSE 255 END AND "platform_file_entries"."name" = btrim("platform_file_entries"."name") AND "platform_file_entries"."name" = normalize("platform_file_entries"."name", NFC) AND "platform_file_entries"."name" NOT IN ('.', '..') AND position('/' in "platform_file_entries"."name") = 0 AND position(chr(92) in "platform_file_entries"."name") = 0 AND "platform_file_entries"."name" !~ '[[:cntrl:]]' AND "platform_file_entries"."name" !~* '%(25)*(2f|5c)')),
	CONSTRAINT "platform_file_entries_path_check" CHECK (octet_length(array_to_string("platform_file_entries"."path", '/')) <= 512),
	CONSTRAINT "platform_file_entries_folder_version_check" CHECK ("platform_file_entries"."kind" = 'file' OR "platform_file_entries"."current_version_id" IS NULL),
	CONSTRAINT "platform_file_entries_trash_check" CHECK ("platform_file_entries"."state" <> 'trashed' OR ("platform_file_entries"."trash_root_id" IS NOT NULL AND "platform_file_entries"."deleted_at" IS NOT NULL AND "platform_file_entries"."expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "platform_file_policy" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"quota_bytes" bigint DEFAULT 10737418240 NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"transient_bytes" bigint DEFAULT 0 NOT NULL,
	"trash_days" integer DEFAULT 30 NOT NULL,
	"history_days" integer DEFAULT 90 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "platform_file_policy_singleton" CHECK ("platform_file_policy"."id" = 1),
	CONSTRAINT "platform_file_policy_values" CHECK ("platform_file_policy"."quota_bytes" >= 0 AND "platform_file_policy"."used_bytes" >= 0 AND "platform_file_policy"."reserved_bytes" >= 0 AND "platform_file_policy"."transient_bytes" >= 0 AND "platform_file_policy"."trash_days" >= 1 AND "platform_file_policy"."history_days" >= 1 AND "platform_file_policy"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "platform_file_entries" ADD CONSTRAINT "platform_file_entries_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."platform_file_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_file_entries_root_unique" ON "platform_file_entries" USING btree ((true)) WHERE "platform_file_entries"."parent_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_file_entries_active_name_unique" ON "platform_file_entries" USING btree ("parent_id","name") WHERE "platform_file_entries"."state" = 'active' AND "platform_file_entries"."parent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "platform_file_entries_parent_idx" ON "platform_file_entries" USING btree ("parent_id","state");--> statement-breakpoint
CREATE INDEX "platform_file_entries_trash_idx" ON "platform_file_entries" USING btree ("state","expires_at");