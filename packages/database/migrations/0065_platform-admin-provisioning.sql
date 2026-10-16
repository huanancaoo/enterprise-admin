-- 部署身份仅调用固定创建函数，不能给既有用户追加密码凭据。
GRANT INSERT (id, name, email, email_verified, created_at, updated_at)
ON public."user" TO platform_executor;
--> statement-breakpoint
GRANT INSERT (id, account_id, provider_id, user_id, password, created_at, updated_at)
ON public.account TO platform_executor;
--> statement-breakpoint
GRANT INSERT (user_id, role, status, version, granted_at, granted_by, grant_reason)
ON public.platform_assignment TO platform_executor;
--> statement-breakpoint
GRANT INSERT (user_id, action, previous_role, next_role, result, reason, actor, created_at)
ON public.platform_assignment_audit TO platform_executor;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.create_platform_admin(p_email text, p_name text, p_password_hash text, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
BEGIN
  -- UUID 由函数生成，四项事实原子提交；不能借此修改已有身份。
  INSERT INTO public."user" (id, name, email, email_verified, created_at, updated_at)
  VALUES (v_user_id, p_name, lower(p_email), true, v_now AT TIME ZONE 'UTC', v_now AT TIME ZONE 'UTC');

  INSERT INTO public.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
  VALUES (gen_random_uuid(), v_user_id::text, 'credential', v_user_id, p_password_hash,
    v_now AT TIME ZONE 'UTC', v_now AT TIME ZONE 'UTC');

  INSERT INTO public.platform_assignment (user_id, role, status, version, granted_at, granted_by, grant_reason)
  VALUES (v_user_id, 'platform_admin', 'active', 1, v_now, session_user, p_reason);

  INSERT INTO public.platform_assignment_audit (user_id, action, previous_role, next_role, result, reason, actor, created_at)
  VALUES (v_user_id, 'grant', NULL, 'platform_admin', 'changed', p_reason, session_user, v_now);
  RETURN v_user_id;
END;
$function$;
--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
--> statement-breakpoint
ALTER FUNCTION public.create_platform_admin(text, text, text, text) OWNER TO platform_executor;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM platform_executor;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_platform_admin(text, text, text, text) FROM PUBLIC, app_runtime, platform_runtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_platform_admin(text, text, text, text) TO platform_deployer;
