CREATE TABLE "business_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"task_type" text NOT NULL,
	"type" text NOT NULL,
	"read_at" timestamp with time zone,
	"email_status" text DEFAULT 'pending' NOT NULL,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"email_next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_notifications_task_recipient_unique" UNIQUE("task_id","recipient_id"),
	CONSTRAINT "business_notifications_type_check" CHECK ("business_notifications"."type" IN ('task.completed', 'task.failed')),
	CONSTRAINT "business_notifications_email_status_check" CHECK ("business_notifications"."email_status" IN ('pending', 'sent', 'disabled', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "business_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"format" text NOT NULL,
	"locale" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"job_id" text NOT NULL,
	"intent_fingerprint" text NOT NULL,
	"request_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"result_content" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_tasks_intent_unique" UNIQUE("organization_id","actor_id","type","idempotency_key"),
	CONSTRAINT "business_tasks_job_unique" UNIQUE("job_id"),
	CONSTRAINT "business_tasks_type_check" CHECK ("business_tasks"."type" IN ('projects.import', 'projects.export')),
	CONSTRAINT "business_tasks_status_check" CHECK ("business_tasks"."status" IN ('submitted', 'queued', 'running', 'completed', 'failed', 'rejected')),
	CONSTRAINT "business_tasks_format_check" CHECK ("business_tasks"."format" IN ('csv', 'xlsx')),
	CONSTRAINT "business_tasks_locale_check" CHECK ("business_tasks"."locale" IN ('zh-CN', 'en-US', 'ar'))
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "notification_preferences_user_unique" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_status_code" integer,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "webhook_deliveries_event_endpoint_unique" UNIQUE("webhook_id","event_id"),
	CONSTRAINT "webhook_deliveries_status_check" CHECK ("webhook_deliveries"."status" IN ('pending', 'delivered', 'failed')),
	CONSTRAINT "webhook_deliveries_attempts_check" CHECK ("webhook_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"events" jsonb NOT NULL,
	"signing_secret" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_notifications" ADD CONSTRAINT "business_notifications_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_notifications" ADD CONSTRAINT "business_notifications_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_notifications" ADD CONSTRAINT "business_notifications_task_id_business_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."business_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_tasks" ADD CONSTRAINT "business_tasks_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_tasks" ADD CONSTRAINT "business_tasks_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhook_endpoints_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_domain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."domain_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_notifications_recipient_created_idx" ON "business_notifications" USING btree ("organization_id","recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "business_tasks_organization_created_idx" ON "business_tasks" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "domain_events_organization_created_idx" ON "domain_events" USING btree ("organization_id","created_at");