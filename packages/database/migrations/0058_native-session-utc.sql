-- 原生 Session 以 UTC 写入 timestamp without time zone；仅对齐比较时钟，不改变生命周期、MFA 或角色规则。
CREATE OR REPLACE FUNCTION public.read_platform_access(p_user_id uuid, p_session_id uuid)
RETURNS TABLE (role text, two_factor_enabled boolean, mfa_verified_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = on
AS $function$
  SELECT assignment.role, account.two_factor_enabled, assurance.verified_at
  FROM public.platform_assignment AS assignment
  JOIN public."user" AS account ON account.id = assignment.user_id
  JOIN public.session AS active_session
    ON active_session.id = p_session_id
   AND active_session.user_id = p_user_id
   AND active_session.expires_at > (clock_timestamp() AT TIME ZONE 'UTC')
  LEFT JOIN public.platform_session_assurance AS assurance
    ON assurance.session_id = active_session.id
   AND assurance.user_id = active_session.user_id
  WHERE assignment.user_id = p_user_id
    AND assignment.status = 'active';
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_platform_session_assurance(p_session_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.session s JOIN public."user" u ON u.id = s.user_id
    JOIN public.two_factor f ON f.user_id = u.id
    WHERE s.id = p_session_id AND s.user_id = p_user_id AND s.expires_at > (clock_timestamp() AT TIME ZONE 'UTC')
      AND u.two_factor_enabled IS TRUE AND f.verified IS TRUE
  ) THEN RAISE EXCEPTION 'No verified TOTP session for platform assurance' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.platform_session_assurance(session_id, user_id, verified_at, method)
  VALUES (p_session_id, p_user_id, clock_timestamp(), 'totp') ON CONFLICT (session_id) DO UPDATE
    SET user_id = EXCLUDED.user_id, verified_at = EXCLUDED.verified_at, method = EXCLUDED.method;
  -- 成功验证当前 Session 才记事实；普通用户的二次验证不伪装成平台登录。
  IF EXISTS (SELECT 1 FROM public.platform_assignment WHERE user_id = p_user_id AND status = 'active') THEN
    INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, resource_id, result, request_id, fields)
    VALUES ('platform', 'platform.mfa_verified', p_user_id, 'user', p_user_id, 'succeeded', gen_random_uuid()::text, '{}'::jsonb);
  END IF;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.require_personal_media_session(p_actor uuid, p_session uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.session WHERE id = p_session AND user_id = p_actor AND expires_at > (clock_timestamp() AT TIME ZONE 'UTC'))
    THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
END;
$function$;
