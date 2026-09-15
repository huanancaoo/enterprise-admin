-- 身份与组织关系必须能在 TenantContext 建立前读取；租户业务 RLS 在 S3 单独实现。
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."user", public.session, public.account, public.verification,
  public.organization, public.member, public.invitation, public.organization_role
TO app_runtime;
--> statement-breakpoint
-- 平台只读取公开身份和组织关系元数据；不授予 token、密码或任意 JSON metadata。
GRANT SELECT (id, name, email, email_verified, image, created_at, updated_at)
ON public."user" TO platform_runtime;
--> statement-breakpoint
GRANT SELECT (id, name, slug, logo, created_at)
ON public.organization TO platform_runtime;
--> statement-breakpoint
GRANT SELECT (id, organization_id, user_id, role, created_at)
ON public.member TO platform_runtime;
