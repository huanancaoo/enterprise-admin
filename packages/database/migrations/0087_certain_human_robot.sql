CREATE TABLE "platform_schedule_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"schedule_name" text NOT NULL,
	"task_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"requested_by" uuid,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"result" jsonb,
	CONSTRAINT "platform_schedule_runs_type_check" CHECK ("platform_schedule_runs"."task_type" = 'platform.health-check'),
	CONSTRAINT "platform_schedule_runs_trigger_check" CHECK ("platform_schedule_runs"."trigger" IN ('automatic','manual')),
	CONSTRAINT "platform_schedule_runs_status_check" CHECK ("platform_schedule_runs"."status" IN ('running','succeeded','failed','rejected')),
	CONSTRAINT "platform_schedule_runs_result_check" CHECK (("platform_schedule_runs"."status"='running' AND "platform_schedule_runs"."finished_at" IS NULL AND "platform_schedule_runs"."error_code" IS NULL AND "platform_schedule_runs"."result" IS NULL) OR ("platform_schedule_runs"."status"='succeeded' AND "platform_schedule_runs"."finished_at" IS NOT NULL AND "platform_schedule_runs"."error_code" IS NULL AND jsonb_typeof("platform_schedule_runs"."result")='object') OR ("platform_schedule_runs"."status" IN ('failed','rejected') AND "platform_schedule_runs"."finished_at" IS NOT NULL AND "platform_schedule_runs"."error_code" IS NOT NULL AND "platform_schedule_runs"."result" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "platform_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"task_type" text NOT NULL,
	"cron" text NOT NULL,
	"time_zone" text NOT NULL,
	"status" text NOT NULL,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_schedules_type_check" CHECK ("platform_schedules"."task_type" = 'platform.health-check'),
	CONSTRAINT "platform_schedules_status_check" CHECK ("platform_schedules"."status" IN ('enabled','disabled')),
	CONSTRAINT "platform_schedules_name_check" CHECK (length(btrim("platform_schedules"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "platform_schedules_version_check" CHECK ("platform_schedules"."version" >= 1),
	CONSTRAINT "platform_schedules_next_check" CHECK (("platform_schedules"."status"='enabled' AND "platform_schedules"."next_run_at" IS NOT NULL) OR ("platform_schedules"."status"='disabled' AND "platform_schedules"."next_run_at" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "platform_schedule_runs_page_idx" ON "platform_schedule_runs" USING btree ("schedule_id","started_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_schedule_runs_running_unique" ON "platform_schedule_runs" USING btree ("schedule_id") WHERE "platform_schedule_runs"."status"='running';--> statement-breakpoint
CREATE INDEX "platform_schedules_due_idx" ON "platform_schedules" USING btree ("status","next_run_at","id");