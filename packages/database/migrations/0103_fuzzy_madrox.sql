ALTER TABLE "platform_announcement_resources" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "platform_announcement_resources" CASCADE;--> statement-breakpoint
ALTER TABLE "platform_resources" DROP CONSTRAINT "platform_resources_purpose_check";--> statement-breakpoint
ALTER TABLE "platform_resources" ADD CONSTRAINT "platform_resources_purpose_check" CHECK ("platform_resources"."purpose" IN ('task-input','task-output'));