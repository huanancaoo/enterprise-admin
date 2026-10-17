CREATE TABLE "login_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text,
	"masked_email" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"result" text NOT NULL,
	"reason_code" text,
	"ip_address" text,
	"user_agent" text,
	"request_id" text NOT NULL,
	CONSTRAINT "login_events_method_check" CHECK ("login_events"."method" IN ('email', 'github', 'totp')),
	CONSTRAINT "login_events_result_check" CHECK ("login_events"."result" IN ('succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "user_account_status" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_account_status_status_check" CHECK ("user_account_status"."status" IN ('active', 'suspended')),
	CONSTRAINT "user_account_status_version_check" CHECK ("user_account_status"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "user_account_status" ADD CONSTRAINT "user_account_status_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_events_occurred_id_idx" ON "login_events" USING btree ("occurred_at","id");--> statement-breakpoint
CREATE INDEX "login_events_user_occurred_id_idx" ON "login_events" USING btree ("user_id","occurred_at","id");