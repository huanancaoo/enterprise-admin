GRANT SELECT (id, name, email, email_verified, created_at, two_factor_enabled) ON public."user" TO platform_executor;
--> statement-breakpoint
CREATE POLICY audit_events_platform_users_insert ON public.audit_events
FOR INSERT TO platform_executor WITH CHECK (
  scope = 'platform' AND NOT tenant_visible AND event_code IN (
    'platform.users_queried', 'platform.user_viewed', 'platform.user_sensitive_read'
  )
);
--> statement-breakpoint
CREATE FUNCTION public.require_platform_user_access(p_actor uuid, p_session uuid, p_sensitive boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_access record;
BEGIN
  SELECT * INTO v_access FROM public.read_platform_access(p_actor, p_session);
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT v_access.two_factor_enabled OR v_access.mfa_verified_at IS NULL THEN
    RAISE EXCEPTION 'PLATFORM_MFA_REQUIRED';
  END IF;
  IF p_sensitive AND v_access.role <> 'platform_admin' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.list_platform_users(p_actor uuid, p_session uuid, p_q text, p_page integer, p_size integer, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_user_access(p_actor, p_session, false);
  IF p_page IS NULL OR p_page < 1 OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 100 OR length(p_q) > 200 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  -- 所有普通目录投影一律脱敏，管理员也必须显式调用敏感读取入口。
  WITH directory AS (
    SELECT u.id, u.name, left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2) AS masked_email,
      u.email_verified, u.created_at AT TIME ZONE 'UTC' AS created_at,
      (SELECT count(*) FROM public.member AS m WHERE m.user_id = u.id)::integer AS organization_count
    FROM public."user" AS u
  ), filtered AS (
    SELECT * FROM directory WHERE p_q IS NULL OR strpos(lower(name), lower(p_q)) > 0
      OR strpos(lower(masked_email), lower(p_q)) > 0 OR id::text = p_q
  ), page AS (
    SELECT * FROM filtered ORDER BY created_at DESC, id ASC LIMIT p_size OFFSET ((p_page::bigint - 1) * p_size)
  ) SELECT jsonb_build_object('items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'userId', id, 'name', name, 'maskedEmail', masked_email, 'emailVerified', email_verified,
    'createdAt', created_at, 'organizationCount', organization_count) ORDER BY created_at DESC, id ASC) FROM page), '[]'::jsonb),
    'page', p_page, 'pageSize', p_size, 'total', (SELECT count(*) FROM filtered)) INTO v_result;
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, result, request_id, fields)
    VALUES ('platform', 'platform.users_queried', p_actor, 'user', 'succeeded', p_request,
      jsonb_build_object('page', p_page, 'pageSize', p_size));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.get_platform_user(p_actor uuid, p_session uuid, p_user uuid, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_user_access(p_actor, p_session, false);
  IF EXISTS (SELECT 1 FROM public.member AS m LEFT JOIN public.organization_status AS s ON s.organization_id = m.organization_id
    WHERE m.user_id = p_user AND s.organization_id IS NULL) THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  SELECT jsonb_build_object('userId', u.id, 'name', u.name,
    'maskedEmail', left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2),
    'emailVerified', u.email_verified, 'createdAt', u.created_at AT TIME ZONE 'UTC',
    'twoFactorEnabled', COALESCE(u.two_factor_enabled, false),
    'organizationCount', (SELECT count(*) FROM public.member AS m WHERE m.user_id = u.id),
    'organizations', COALESCE((SELECT jsonb_agg(jsonb_build_object('organizationId', o.id, 'name', o.name, 'slug', o.slug,
      'status', s.status, 'role', m.role, 'joinedAt', m.created_at AT TIME ZONE 'UTC') ORDER BY o.name, o.id)
      FROM public.member AS m JOIN public.organization AS o ON o.id = m.organization_id
      JOIN public.organization_status AS s ON s.organization_id = o.id WHERE m.user_id = u.id), '[]'::jsonb))
    INTO v_result FROM public."user" AS u WHERE u.id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, resource_id, result, request_id, fields)
    VALUES ('platform', 'platform.user_viewed', p_actor, 'user', p_user, 'succeeded', p_request, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.get_platform_sensitive_profile(p_actor uuid, p_session uuid, p_user uuid, p_purpose text, p_request text)
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
    VALUES ('platform', 'platform.user_sensitive_read', p_actor, 'user', p_user, 'succeeded', p_request, btrim(p_purpose), '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.require_platform_user_access(uuid, uuid, boolean) OWNER TO platform_executor;
ALTER FUNCTION public.list_platform_users(uuid, uuid, text, integer, integer, text) OWNER TO platform_executor;
ALTER FUNCTION public.get_platform_user(uuid, uuid, uuid, text) OWNER TO platform_executor;
ALTER FUNCTION public.get_platform_sensitive_profile(uuid, uuid, uuid, text, text) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.require_platform_user_access(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_platform_users(uuid, uuid, text, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_platform_user(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_platform_sensitive_profile(uuid, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_platform_users(uuid, uuid, text, integer, integer, text),
  public.get_platform_user(uuid, uuid, uuid, text), public.get_platform_sensitive_profile(uuid, uuid, uuid, text, text) TO app_runtime;
