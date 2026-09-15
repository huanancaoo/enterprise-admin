CREATE TABLE "project_translations" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "project_translations_organization_project_locale_unique" UNIQUE("organization_id","project_id","locale"),
	CONSTRAINT "project_translations_locale_check" CHECK ("project_translations"."locale" IN ('zh-CN', 'en-US', 'ar')),
	CONSTRAINT "project_translations_name_check" CHECK (length(btrim("project_translations"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content_locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" IN ('draft', 'active', 'archived')),
	CONSTRAINT "projects_content_locale_check" CHECK ("projects"."content_locale" IN ('zh-CN', 'en-US', 'ar'))
);
--> statement-breakpoint
ALTER TABLE "project_translations" ADD CONSTRAINT "project_translations_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;