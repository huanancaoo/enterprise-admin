CREATE TABLE "file_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"path" text[] NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"current_version_id" uuid,
	"busy_operation_id" uuid,
	"trash_root_id" uuid,
	"deleted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_entries_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "file_entries_kind_check" CHECK ("file_entries"."kind" IN ('file', 'folder')),
	CONSTRAINT "file_entries_state_check" CHECK ("file_entries"."state" IN ('active', 'trashed', 'purged')),
	CONSTRAINT "file_entries_revision_check" CHECK ("file_entries"."revision" >= 1),
	CONSTRAINT "file_entries_root_check" CHECK (("file_entries"."parent_id" IS NULL AND "file_entries"."kind" = 'folder' AND "file_entries"."name" = '' AND cardinality("file_entries"."path") = 0 AND "file_entries"."state" = 'active') OR ("file_entries"."parent_id" IS NOT NULL AND cardinality("file_entries"."path") > 0 AND "file_entries"."path"[cardinality("file_entries"."path")] = "file_entries"."name")),
	CONSTRAINT "file_entries_name_check" CHECK ("file_entries"."parent_id" IS NULL OR (octet_length("file_entries"."name") BETWEEN 1 AND CASE WHEN "file_entries"."kind" = 'folder' THEN 246 ELSE 255 END AND "file_entries"."name" = btrim("file_entries"."name") AND "file_entries"."name" = normalize("file_entries"."name", NFC) AND "file_entries"."name" NOT IN ('.', '..') AND position('/' in "file_entries"."name") = 0 AND position(chr(92) in "file_entries"."name") = 0 AND "file_entries"."name" !~ '[[:cntrl:]]' AND "file_entries"."name" !~* '%(25)*(2f|5c)')),
	CONSTRAINT "file_entries_path_check" CHECK (octet_length(array_to_string("file_entries"."path", '/')) <= 512),
	CONSTRAINT "file_entries_folder_version_check" CHECK ("file_entries"."kind" = 'file' OR "file_entries"."current_version_id" IS NULL),
	CONSTRAINT "file_entries_trash_check" CHECK ("file_entries"."state" <> 'trashed' OR ("file_entries"."trash_root_id" IS NOT NULL AND "file_entries"."deleted_at" IS NOT NULL AND "file_entries"."expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "file_namespace_reservations" (
	"organization_id" uuid NOT NULL,
	"parent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"operation_id" uuid NOT NULL,
	CONSTRAINT "file_namespace_reservations_organization_id_parent_id_name_pk" PRIMARY KEY("organization_id","parent_id","name")
);
--> statement-breakpoint
CREATE TABLE "file_operation_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"version_id" uuid,
	"directory" boolean NOT NULL,
	"source_area" text,
	"source_path" text[],
	"target_area" text,
	"target_path" text[],
	"expected_bytes" bigint,
	"expected_sha256" text,
	"actual_bytes" bigint,
	"actual_sha256" text,
	"transient_bytes" bigint DEFAULT 0 NOT NULL,
	"prepared_at" timestamp with time zone,
	"source_deleted_at" timestamp with time zone,
	"source_restored_at" timestamp with time zone,
	"target_deleted_at" timestamp with time zone,
	CONSTRAINT "file_operation_objects_bytes_check" CHECK (("file_operation_objects"."expected_bytes" IS NULL OR "file_operation_objects"."expected_bytes" >= 0) AND ("file_operation_objects"."actual_bytes" IS NULL OR "file_operation_objects"."actual_bytes" >= 0) AND "file_operation_objects"."transient_bytes" >= 0),
	CONSTRAINT "file_operation_objects_source_check" CHECK (("file_operation_objects"."source_area" IS NULL) = ("file_operation_objects"."source_path" IS NULL)),
	CONSTRAINT "file_operation_objects_target_check" CHECK (("file_operation_objects"."target_area" IS NULL) = ("file_operation_objects"."target_path" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "file_operations" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"request_hash" text NOT NULL,
	"request_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"plans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"phase" text DEFAULT 'pending' NOT NULL,
	"reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"committed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"result" jsonb,
	"lease_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "file_operations_organization_id_id_pk" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "file_operations_phase_check" CHECK ("file_operations"."phase" IN ('pending', 'preparing', 'committed', 'cleaning', 'completed', 'failed')),
	CONSTRAINT "file_operations_action_check" CHECK ("file_operations"."action" IN ('upload', 'overwrite', 'create-folder', 'rename', 'move', 'trash', 'restore', 'purge')),
	CONSTRAINT "file_operations_hash_check" CHECK ("file_operations"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "file_operations_reserved_check" CHECK ("file_operations"."reserved_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "file_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"locale" text,
	"reference_key" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"file_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	CONSTRAINT "file_references_business_slot_unique" UNIQUE NULLS NOT DISTINCT("organization_id","project_id","kind","locale","reference_key"),
	CONSTRAINT "file_references_kind_locale_check" CHECK (("file_references"."kind" = 'project_attachment' AND "file_references"."locale" IS NULL) OR ("file_references"."kind" = 'project_rich_text' AND "file_references"."locale" IN ('zh-CN', 'en-US', 'ar'))),
	CONSTRAINT "file_references_position_check" CHECK ("file_references"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "file_storage_usage" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"quota_bytes" bigint DEFAULT 10737418240 NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"transient_bytes" bigint DEFAULT 0 NOT NULL,
	"trash_days" integer DEFAULT 30 NOT NULL,
	"history_days" integer DEFAULT 90 NOT NULL,
	"policy_revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "file_storage_usage_values_check" CHECK ("file_storage_usage"."quota_bytes" >= 0 AND "file_storage_usage"."used_bytes" >= 0 AND "file_storage_usage"."reserved_bytes" >= 0 AND "file_storage_usage"."transient_bytes" >= 0 AND "file_storage_usage"."trash_days" >= 1 AND "file_storage_usage"."history_days" >= 1 AND "file_storage_usage"."policy_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "file_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	"storage_area" text NOT NULL,
	"storage_path" text[] NOT NULL,
	"archived_path" text[],
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	CONSTRAINT "file_versions_organization_file_id_unique" UNIQUE("organization_id","file_id","id"),
	CONSTRAINT "file_versions_bytes_check" CHECK ("file_versions"."bytes" >= 0),
	CONSTRAINT "file_versions_sha256_check" CHECK ("file_versions"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "file_versions_area_check" CHECK ("file_versions"."storage_area" IN ('files', 'history', 'trash', 'staging'))
);
--> statement-breakpoint
CREATE TABLE "project_file_contents" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"document" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_file_contents_organization_id_project_id_locale_pk" PRIMARY KEY("organization_id","project_id","locale"),
	CONSTRAINT "project_file_contents_locale_check" CHECK ("project_file_contents"."locale" IN ('zh-CN', 'en-US', 'ar')),
	CONSTRAINT "project_file_contents_revision_check" CHECK ("project_file_contents"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "file_entries" ADD CONSTRAINT "file_entries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_entries" ADD CONSTRAINT "file_entries_parent_fk" FOREIGN KEY ("organization_id","parent_id") REFERENCES "public"."file_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_entries" ADD CONSTRAINT "file_entries_busy_operation_fk" FOREIGN KEY ("organization_id","busy_operation_id") REFERENCES "public"."file_operations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_namespace_reservations" ADD CONSTRAINT "file_namespace_reservations_operation_fk" FOREIGN KEY ("organization_id","operation_id") REFERENCES "public"."file_operations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_namespace_reservations" ADD CONSTRAINT "file_namespace_reservations_parent_fk" FOREIGN KEY ("organization_id","parent_id") REFERENCES "public"."file_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_operation_objects" ADD CONSTRAINT "file_operation_objects_operation_fk" FOREIGN KEY ("organization_id","operation_id") REFERENCES "public"."file_operations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_operations" ADD CONSTRAINT "file_operations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_references" ADD CONSTRAINT "file_references_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_references" ADD CONSTRAINT "file_references_version_fk" FOREIGN KEY ("organization_id","file_id","version_id") REFERENCES "public"."file_versions"("organization_id","file_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_storage_usage" ADD CONSTRAINT "file_storage_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_fk" FOREIGN KEY ("organization_id","file_id") REFERENCES "public"."file_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_file_contents" ADD CONSTRAINT "project_file_contents_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_entries_root_unique" ON "file_entries" USING btree ("organization_id") WHERE "file_entries"."parent_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "file_entries_active_name_unique" ON "file_entries" USING btree ("organization_id","parent_id","name") WHERE "file_entries"."state" = 'active' AND "file_entries"."parent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "file_entries_parent_idx" ON "file_entries" USING btree ("organization_id","parent_id","state");--> statement-breakpoint
CREATE INDEX "file_entries_trash_idx" ON "file_entries" USING btree ("organization_id","state","expires_at");--> statement-breakpoint
CREATE INDEX "file_operation_objects_operation_idx" ON "file_operation_objects" USING btree ("organization_id","operation_id");--> statement-breakpoint
CREATE INDEX "file_operations_claim_idx" ON "file_operations" USING btree ("phase","lease_expires_at","created_at");--> statement-breakpoint
CREATE INDEX "file_operations_organization_created_idx" ON "file_operations" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "file_references_version_idx" ON "file_references" USING btree ("organization_id","file_id","version_id");--> statement-breakpoint
CREATE INDEX "file_versions_file_idx" ON "file_versions" USING btree ("organization_id","file_id","created_at","id");--> statement-breakpoint
CREATE INDEX "file_versions_expiry_idx" ON "file_versions" USING btree ("expires_at") WHERE "file_versions"."purged_at" IS NULL;