-- 租户身份运行账号可维护组织资料，但组织启停属于平台权限。
REVOKE UPDATE ON public.organization FROM app_runtime;
--> statement-breakpoint
GRANT UPDATE (id, name, slug, logo, created_at, metadata) ON public.organization TO app_runtime;
--> statement-breakpoint
GRANT SELECT (enabled), UPDATE (enabled) ON public.organization TO platform_runtime;
