CREATE TABLE "password_login_lock" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"failure_times" timestamp with time zone[] DEFAULT '{}' NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_assignment_role" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "platform_assignment_role_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "platform_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_role_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "password_login_lock" ADD CONSTRAINT "password_login_lock_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_assignment_role" ADD CONSTRAINT "platform_assignment_role_user_id_platform_assignment_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_assignment"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_assignment_role" ADD CONSTRAINT "platform_assignment_role_role_id_platform_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."platform_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 在移除旧角色列前完整迁移有效任职，撤销任职不携带可恢复的角色。
INSERT INTO public.platform_role(key,name,built_in,status,permissions) VALUES
('platform_admin','超级管理员',true,'active',ARRAY['platform.authorization:manage','platform.organization:read','platform.organization:update','platform.organization:export','platform.user:read','platform.user:create','platform.user:update','platform.user:suspend','platform.user:resetPassword','platform.user:readSensitive','platform.user:unlock','platform.user:export','platform.audit:read','platform.audit:export','platform.settings:read','platform.settings:update','platform.login:read','platform.login:export','platform.session:read','platform.session:revoke','platform.session:export','platform.employee:read','platform.employee:create','platform.employee:update','platform.employee:delete','platform.employee:export','platform.role:read','platform.role:create','platform.role:update','platform.role:delete','platform.role:export','platform.menu:read','platform.menu:create','platform.menu:update','platform.menu:delete','platform.menu:export','platform.department:read','platform.department:create','platform.department:update','platform.department:delete','platform.department:export','platform.post:read','platform.post:create','platform.post:update','platform.post:delete','platform.post:export','platform.dictionary:read','platform.dictionary:create','platform.dictionary:update','platform.dictionary:delete','platform.dictionary:export','platform.dictionary:refresh','platform.parameter:read','platform.parameter:create','platform.parameter:update','platform.parameter:delete','platform.parameter:export','platform.parameter:refresh','platform.announcement:read','platform.announcement:create','platform.announcement:update','platform.announcement:delete','platform.announcement:publish','platform.announcement:readers','platform.task:read','platform.task:download']::text[]),
('platform_auditor','审计员',true,'active',ARRAY['platform.organization:read','platform.user:read','platform.audit:read','platform.settings:read','platform.login:read','platform.session:read','platform.employee:read','platform.role:read','platform.menu:read','platform.department:read','platform.post:read','platform.dictionary:read','platform.parameter:read','platform.announcement:read','platform.task:read']::text[]);
INSERT INTO public.platform_assignment_role(user_id,role_id)
SELECT a.user_id,r.id FROM public.platform_assignment a JOIN public.platform_role r ON r.key=a.role WHERE a.status='active';
ALTER TABLE public.platform_assignment DROP CONSTRAINT platform_assignment_role_check;
ALTER TABLE public.platform_assignment DROP CONSTRAINT platform_assignment_status_check;
ALTER TABLE public.platform_assignment ADD CONSTRAINT platform_assignment_status_check CHECK(status IN ('active','suspended','revoked'));
ALTER TABLE public.platform_assignment DROP CONSTRAINT platform_assignment_revocation_fields_check;
ALTER TABLE public.platform_assignment ADD CONSTRAINT platform_assignment_revocation_fields_check CHECK(
(status='active' AND revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR
(status IN ('suspended','revoked') AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "platform_assignment" DROP COLUMN "role";
