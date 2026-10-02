CREATE TABLE "personal_media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	"storage_path" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"purge_operation_id" uuid,
	"purge_lease_id" uuid,
	"purge_lease_expires_at" timestamp with time zone,
	"purge_error_code" text,
	CONSTRAINT "personal_media_size_check" CHECK ("personal_media"."bytes" BETWEEN 1 AND 5242880),
	CONSTRAINT "personal_media_hash_check" CHECK ("personal_media"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "personal_media_type_check" CHECK ("personal_media"."content_type" IN ('image/jpeg','image/png','image/webp','image/gif')),
	CONSTRAINT "personal_media_path_check" CHECK (cardinality("personal_media"."storage_path") = 1 AND "personal_media"."storage_path"[1] = "personal_media"."id"::text)
);
--> statement-breakpoint
CREATE TABLE "personal_media_operations" (
	"id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"request_id" text NOT NULL,
	"declared_bytes" bigint NOT NULL,
	"phase" text DEFAULT 'pending' NOT NULL,
	"actual_bytes" bigint,
	"actual_sha256" text,
	"content_type" text,
	"committed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cleaned_at" timestamp with time zone,
	"lease_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "personal_media_operations_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "personal_media_operations_media_unique" UNIQUE("media_id"),
	CONSTRAINT "personal_media_operations_hash_check" CHECK ("personal_media_operations"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "personal_media_operations_size_check" CHECK ("personal_media_operations"."declared_bytes" BETWEEN 1 AND 5242880 AND ("personal_media_operations"."actual_bytes" IS NULL OR "personal_media_operations"."actual_bytes" = "personal_media_operations"."declared_bytes")),
	CONSTRAINT "personal_media_operations_phase_check" CHECK ("personal_media_operations"."phase" IN ('pending','preparing','completed','failed')),
	CONSTRAINT "personal_media_operations_commit_check" CHECK (("personal_media_operations"."phase" = 'completed' AND "personal_media_operations"."committed_at" IS NOT NULL AND "personal_media_operations"."completed_at" IS NOT NULL) OR ("personal_media_operations"."phase" <> 'completed' AND "personal_media_operations"."committed_at" IS NULL AND "personal_media_operations"."completed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "personal_media" ADD CONSTRAINT "personal_media_operation_fk" FOREIGN KEY ("user_id","operation_id") REFERENCES "public"."personal_media_operations"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personal_media_user_idx" ON "personal_media" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "personal_media_expiry_idx" ON "personal_media" USING btree ("expires_at","purge_lease_expires_at") WHERE "personal_media"."purged_at" IS NULL;--> statement-breakpoint
CREATE INDEX "personal_media_operations_expiry_idx" ON "personal_media_operations" USING btree ("phase","expires_at","lease_expires_at");