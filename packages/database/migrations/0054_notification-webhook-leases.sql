ALTER TABLE "business_notifications" ADD COLUMN "email_lease_token" uuid;--> statement-breakpoint
ALTER TABLE "business_notifications" ADD COLUMN "email_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "lease_until" timestamp with time zone;