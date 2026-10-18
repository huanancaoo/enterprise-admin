ALTER TABLE "business_tasks" DROP CONSTRAINT "business_tasks_type_check";--> statement-breakpoint
ALTER TABLE "invitation_delivery_attempts" ADD COLUMN "actor_id" uuid;--> statement-breakpoint
ALTER TABLE "invitation_delivery_attempts" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "business_tasks" ADD CONSTRAINT "business_tasks_type_check" CHECK ("business_tasks"."type" IN ('projects.import', 'projects.export', 'members.export', 'audit.export', 'invitations.import'));