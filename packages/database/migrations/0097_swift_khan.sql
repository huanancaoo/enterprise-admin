CREATE TABLE "platform_file_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"bytes" bigint NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"storage_area" text NOT NULL,
	"storage_path" text[] NOT NULL,
	"state" text DEFAULT 'available' NOT NULL,
	"retired_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_file_versions_content_check" CHECK ("platform_file_versions"."bytes" >= 0 AND "platform_file_versions"."sha256" ~ '^[0-9a-f]{64}$' AND length("platform_file_versions"."content_type")>0),
	CONSTRAINT "platform_file_versions_location_check" CHECK ("platform_file_versions"."storage_area" IN ('files','history','trash') AND cardinality("platform_file_versions"."storage_path")>0),
	CONSTRAINT "platform_file_versions_state_check" CHECK ("platform_file_versions"."state" IN ('available','purged'))
);
--> statement-breakpoint
ALTER TABLE "platform_file_versions" ADD CONSTRAINT "platform_file_versions_file_id_platform_file_entries_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."platform_file_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_file_versions_file_idx" ON "platform_file_versions" USING btree ("file_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_file_versions_expiry_idx" ON "platform_file_versions" USING btree ("state","expires_at");