CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"type" text NOT NULL,
	"template_key" text NOT NULL,
	"template_version" integer NOT NULL,
	"locale" text NOT NULL,
	"provider" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"recipient_hash" "bytea" NOT NULL,
	"payload_ciphertext" "bytea" NOT NULL,
	"payload_key_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_message_id" text,
	"last_error_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_messages_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "email_messages_status_check" CHECK ("email_messages"."status" IN ('queued', 'sending', 'retry', 'accepted', 'failed', 'expired')),
	CONSTRAINT "email_messages_template_version_check" CHECK ("email_messages"."template_version" >= 1),
	CONSTRAINT "email_messages_attempt_count_check" CHECK ("email_messages"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "email_messages_dispatch_idx" ON "email_messages" USING btree ("status","next_attempt_at","created_at");