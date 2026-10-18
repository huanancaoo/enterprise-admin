-- 匹配既有 UTC 时间与账号 ID 的稳定排序，避免无筛选分页先排序整个账号目录。
CREATE INDEX user_created_utc_id_idx ON public."user" ((created_at AT TIME ZONE 'UTC') DESC, id ASC);
--> statement-breakpoint

-- 页与总数各自优化，但仍在同一语句快照内；全量状态检查、授权与审计顺序保持不变。
CREATE OR REPLACE FUNCTION public.read_platform_users_for_action(p_actor uuid, p_session uuid, p_q text, p_page integer, p_size integer, p_request text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,p_action);
  IF p_page IS NULL OR p_page < 1 OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 100 OR length(p_q) > 200
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF EXISTS (SELECT 1 FROM public."user" u LEFT JOIN public.user_account_status s ON s.user_id = u.id WHERE s.user_id IS NULL)
    THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  WITH directory AS (
    SELECT u.id, u.name, left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2) AS masked_email,
      u.email_verified, u.created_at AT TIME ZONE 'UTC' AS created_at, s.status, s.version
    FROM public."user" u JOIN public.user_account_status s ON s.user_id = u.id
  ), filtered AS NOT MATERIALIZED (
    SELECT * FROM directory WHERE p_q IS NULL OR strpos(lower(name), lower(p_q)) > 0
      OR strpos(lower(masked_email), lower(p_q)) > 0 OR id::text = p_q
  ), page AS (
    SELECT * FROM filtered ORDER BY created_at DESC, id ASC LIMIT p_size OFFSET ((p_page::bigint - 1) * p_size)
  ) SELECT jsonb_build_object('items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'userId', id, 'name', name, 'maskedEmail', masked_email, 'lockedUntil',(SELECT l.locked_until FROM public.password_login_lock l WHERE l.user_id=id AND l.locked_until>clock_timestamp()), 'emailVerified', email_verified,
    'createdAt', created_at, 'organizationCount', (SELECT count(*) FROM public.member m WHERE m.user_id = page.id)::integer, 'status', status, 'version', version)
    ORDER BY created_at DESC, id ASC) FROM page), '[]'::jsonb),
    'page', p_page, 'pageSize', p_size, 'total', (SELECT count(*) FROM filtered)) INTO v_result;
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, result, request_id, fields)
    VALUES ('platform', 'platform.users_queried', p_actor, 'user', 'succeeded', p_request,
      jsonb_build_object('page', p_page, 'pageSize', p_size));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
