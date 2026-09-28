CREATE TABLE "invitation_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "invitation_delivery_status_check" CHECK ("invitation_delivery_attempts"."status" IN ('pending', 'smtp_accepted', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "invitation_send_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"email" text NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "invitation_delivery_latest_idx" ON "invitation_delivery_attempts" USING btree ("invitation_id","created_at");--> statement-breakpoint
CREATE INDEX "invitation_send_window_idx" ON "invitation_send_events" USING btree ("created_at");
