ALTER POLICY audit_events_platform_users_insert ON public.audit_events WITH CHECK (
  scope = 'platform' AND NOT tenant_visible AND event_code IN (
    'platform.users_queried', 'platform.user_viewed', 'platform.user_sensitive_viewed'
  )
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_platform_sensitive_profile(p_actor uuid, p_session uuid, p_user uuid, p_purpose text, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  -- 对不存在的目标也先验证敏感权限，审计员不能借响应探测全站身份。
  PERFORM public.require_platform_user_access(p_actor, p_session, true);
  IF p_purpose IS NULL OR length(btrim(p_purpose)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  SELECT jsonb_build_object('userId', id, 'email', email) INTO v_result FROM public."user" WHERE id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, resource_id, result, request_id, reason, fields)
    VALUES ('platform', 'platform.user_sensitive_viewed', p_actor, 'user', p_user, 'succeeded', p_request, btrim(p_purpose), '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
