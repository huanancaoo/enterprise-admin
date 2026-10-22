CREATE TABLE "platform_file_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"request_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"phase" text DEFAULT 'pending' NOT NULL,
	"entry_id" uuid,
	"objects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"committed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"result" jsonb,
	"lease_id" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_file_operations_action_check" CHECK ("platform_file_operations"."action" IN ('create-folder','upload','overwrite','rename','move','trash','restore','purge')),
	CONSTRAINT "platform_file_operations_phase_check" CHECK ("platform_file_operations"."phase" IN ('pending','preparing','committed','cleaning','completed','failed')),
	CONSTRAINT "platform_file_operations_reserved_check" CHECK ("platform_file_operations"."reserved_bytes" >= 0)
);
--> statement-breakpoint
CREATE INDEX "platform_file_operations_pending_idx" ON "platform_file_operations" USING btree ("phase","lease_expires_at");--> statement-breakpoint
CREATE INDEX "platform_file_operations_actor_idx" ON "platform_file_operations" USING btree ("actor_id","created_at");