ALTER TABLE "business_notifications" DROP CONSTRAINT "business_notifications_task_id_business_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_webhook_id_webhook_endpoints_id_fk";
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_event_id_domain_events_id_fk";
--> statement-breakpoint
ALTER TABLE "business_tasks" ADD CONSTRAINT "business_tasks_tenant_id_unique" UNIQUE("organization_id","id");
--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_unique" UNIQUE("organization_id","id");
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_unique" UNIQUE("organization_id","id");
--> statement-breakpoint
ALTER TABLE "business_notifications" ADD CONSTRAINT "business_notifications_tenant_task_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."business_tasks"("organization_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_endpoint_fk" FOREIGN KEY ("organization_id","webhook_id") REFERENCES "public"."webhook_endpoints"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_event_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."domain_events"("organization_id","id") ON DELETE no action ON UPDATE no action;
