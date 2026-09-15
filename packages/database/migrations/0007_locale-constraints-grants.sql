-- 语言配置只有已支持的三种值；用户未设置时继续按组织与平台语言协商。
ALTER TABLE public."user" ADD CONSTRAINT user_preferred_locale_check
CHECK (preferred_locale IN ('zh-CN', 'en-US', 'ar'));
--> statement-breakpoint
ALTER TABLE public.organization ADD CONSTRAINT organization_default_locale_check
CHECK (default_locale IN ('zh-CN', 'en-US', 'ar'));
--> statement-breakpoint
-- 沿用组织资料的列级授权，不恢复 app_runtime 对 enabled 的写权限。
GRANT UPDATE (default_locale) ON public.organization TO app_runtime;
