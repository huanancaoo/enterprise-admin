ALTER TABLE "organization" ADD COLUMN "default_locale" text DEFAULT 'zh-CN' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "preferred_locale" text;