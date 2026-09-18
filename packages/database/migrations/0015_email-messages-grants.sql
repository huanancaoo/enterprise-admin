-- 邮件发件箱属于身份/运营域：跨组织认领，包含 organization_id IS NULL 的认证信，因此不能挂租户 RLS。
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_messages TO app_runtime;
--> statement-breakpoint
-- 存量用户在强制验证开启前已经登录过；只要求此后新注册完成验证。
UPDATE public."user" SET email_verified = true WHERE email_verified = false;
