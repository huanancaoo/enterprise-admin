ALTER TABLE "audit_events" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "resource_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "scope" text DEFAULT 'tenant' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "resource_type" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "result" text DEFAULT 'succeeded' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "operation_id" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "tenant_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "public_summary" text;--> statement-breakpoint
CREATE INDEX "audit_events_organization_occurred_id_idx" ON "audit_events" USING btree ("organization_id","occurred_at","id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_scope_check" CHECK ("audit_events"."scope" IN ('tenant', 'platform', 'user', 'security'));--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_type_check" CHECK ("audit_events"."actor_type" IN ('user', 'deployment_operator', 'system'));--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_result_check" CHECK ("audit_events"."result" IN ('succeeded', 'denied', 'failed', 'no_change'));