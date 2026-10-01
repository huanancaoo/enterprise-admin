CREATE TABLE "operation_receipts" (
	"actor_id" uuid NOT NULL,
	"scope_key" text NOT NULL,
	"action" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"safe_result" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "operation_receipts_actor_id_scope_key_action_idempotency_key_pk" PRIMARY KEY("actor_id","scope_key","action","idempotency_key"),
	CONSTRAINT "operation_receipts_scope_check" CHECK (length("operation_receipts"."scope_key") > 0)
);
--> statement-breakpoint
CREATE INDEX "operation_receipts_expires_idx" ON "operation_receipts" USING btree ("expires_at");