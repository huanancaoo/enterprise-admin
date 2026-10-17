-- 列表与导出共享同一投影；入口各自传入固定动作，私有实现不向runtime开放。
--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
--> statement-breakpoint
CREATE FUNCTION public.read_platform_users_for_action(p_actor uuid, p_session uuid, p_q text, p_page integer, p_size integer, p_request text,p_action text)
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
      u.email_verified, u.created_at AT TIME ZONE 'UTC' AS created_at, s.status, s.version,
      (SELECT count(*) FROM public.member m WHERE m.user_id = u.id)::integer AS organization_count
    FROM public."user" u JOIN public.user_account_status s ON s.user_id = u.id
  ), filtered AS (
    SELECT * FROM directory WHERE p_q IS NULL OR strpos(lower(name), lower(p_q)) > 0
      OR strpos(lower(masked_email), lower(p_q)) > 0 OR id::text = p_q
  ), page AS (
    SELECT * FROM filtered ORDER BY created_at DESC, id ASC LIMIT p_size OFFSET ((p_page::bigint - 1) * p_size)
  ) SELECT jsonb_build_object('items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'userId', id, 'name', name, 'maskedEmail', masked_email, 'lockedUntil',(SELECT l.locked_until FROM public.password_login_lock l WHERE l.user_id=id AND l.locked_until>clock_timestamp()), 'emailVerified', email_verified,
    'createdAt', created_at, 'organizationCount', organization_count, 'status', status, 'version', version)
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
--> statement-breakpoint
ALTER FUNCTION public.read_platform_users_for_action(uuid,uuid,text,integer,integer,text,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.read_platform_users_for_action(uuid,uuid,text,integer,integer,text,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_platform_users(p_actor uuid, p_session uuid, p_q text, p_page integer, p_size integer, p_request text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $function$ SELECT public.read_platform_users_for_action(p_actor,p_session,p_q,p_page,p_size,p_request,'platform.user:read'); $function$;
--> statement-breakpoint
CREATE FUNCTION public.export_platform_users_page(p_actor uuid, p_session uuid, p_q text, p_page integer, p_size integer, p_request text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $function$ SELECT public.read_platform_users_for_action(p_actor,p_session,p_q,p_page,p_size,p_request,'platform.user:export'); $function$;
--> statement-breakpoint
ALTER FUNCTION public.export_platform_users_page(uuid,uuid,text,integer,integer,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.export_platform_users_page(uuid,uuid,text,integer,integer,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.export_platform_users_page(uuid,uuid,text,integer,integer,text) TO app_runtime;
--> statement-breakpoint
CREATE FUNCTION public.read_platform_organizations_for_action(
  p_actor uuid, p_session uuid, p_q text, p_status text,
  p_page integer, p_size integer, p_sort text, p_order text, p_request text
,p_action text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,p_action);
  IF p_page < 1 OR p_size NOT BETWEEN 1 AND 100 OR length(p_q) > 200
    OR (p_status IS NOT NULL AND p_status NOT IN ('ACTIVE', 'SUSPENDED'))
    OR p_sort NOT IN ('name', 'slug', 'createdAt', 'memberCount') OR p_order NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization AS o LEFT JOIN public.organization_status AS s
    ON s.organization_id = o.id WHERE s.organization_id IS NULL) THEN
    RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE';
  END IF;
  WITH filtered AS (
    SELECT o.id, o.name, o.slug, o.created_at AT TIME ZONE 'UTC' AS created_at, s.status, s.status_version,
      (SELECT count(*) FROM public.member AS m WHERE m.organization_id = o.id)::integer AS member_count
    FROM public.organization AS o JOIN public.organization_status AS s ON s.organization_id = o.id
    WHERE (p_status IS NULL OR s.status = p_status)
      AND (p_q IS NULL OR strpos(lower(o.name), lower(p_q)) > 0 OR strpos(lower(o.slug), lower(p_q)) > 0)
  ), page AS (
    SELECT * FROM filtered ORDER BY
      CASE WHEN p_order = 'asc' AND p_sort = 'name' THEN name END ASC,
      CASE WHEN p_order = 'desc' AND p_sort = 'name' THEN name END DESC,
      CASE WHEN p_order = 'asc' AND p_sort = 'slug' THEN slug END ASC,
      CASE WHEN p_order = 'desc' AND p_sort = 'slug' THEN slug END DESC,
      CASE WHEN p_order = 'asc' AND p_sort = 'createdAt' THEN created_at END ASC,
      CASE WHEN p_order = 'desc' AND p_sort = 'createdAt' THEN created_at END DESC,
      CASE WHEN p_order = 'asc' AND p_sort = 'memberCount' THEN member_count END ASC,
      CASE WHEN p_order = 'desc' AND p_sort = 'memberCount' THEN member_count END DESC, id ASC
    LIMIT p_size OFFSET ((p_page::bigint - 1) * p_size)
  ) SELECT jsonb_build_object('items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'slug', slug, 'createdAt', created_at,
      'status', status, 'version', status_version, 'memberCount', member_count)) FROM page), '[]'::jsonb),
    'page', p_page, 'pageSize', p_size, 'total', (SELECT count(*) FROM filtered)) INTO v_result;
  -- 运营读取必须先记录访问事实，审计失败时不把已查询的投影返回调用者。
  BEGIN
    INSERT INTO public.audit_events (scope, event_code, actor_id, resource_type, result, request_id, fields)
    VALUES ('platform', 'platform.organizations_queried', p_actor, 'organization', 'succeeded', p_request,
      jsonb_build_object('status', p_status, 'page', p_page, 'pageSize', p_size, 'sortBy', p_sort, 'sortOrder', p_order));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
ALTER FUNCTION public.read_platform_organizations_for_action(uuid,uuid,text,text,integer,integer,text,text,text,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.read_platform_organizations_for_action(uuid,uuid,text,text,integer,integer,text,text,text,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_platform_organizations(
  p_actor uuid, p_session uuid, p_q text, p_status text,
  p_page integer, p_size integer, p_sort text, p_order text, p_request text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $function$ SELECT public.read_platform_organizations_for_action(p_actor,p_session,p_q,p_status,p_page,p_size,p_sort,p_order,p_request,'platform.organization:read'); $function$;
--> statement-breakpoint
CREATE FUNCTION public.export_platform_organizations_page(
  p_actor uuid, p_session uuid, p_q text, p_status text,
  p_page integer, p_size integer, p_sort text, p_order text, p_request text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $function$ SELECT public.read_platform_organizations_for_action(p_actor,p_session,p_q,p_status,p_page,p_size,p_sort,p_order,p_request,'platform.organization:export'); $function$;
--> statement-breakpoint
ALTER FUNCTION public.export_platform_organizations_page(uuid,uuid,text,text,integer,integer,text,text,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.export_platform_organizations_page(uuid,uuid,text,text,integer,integer,text,text,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.export_platform_organizations_page(uuid,uuid,text,text,integer,integer,text,text,text) TO app_runtime;
--> statement-breakpoint
CREATE FUNCTION public.read_platform_login_logs_for_action(p_actor uuid, p_session uuid, p_q text, p_user uuid, p_result text, p_method text, p_from timestamptz, p_to timestamptz, p_page integer, p_size integer, p_request text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,p_action);
  v_result := public.read_login_events_page(p_q, p_user, p_result, p_method, p_from, p_to, p_page, p_size);
  PERFORM public.append_platform_identity_audit(p_actor, 'platform.login_logs_queried', p_user, 'succeeded', p_request, NULL);
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
ALTER FUNCTION public.read_platform_login_logs_for_action(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz,integer,integer,text,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.read_platform_login_logs_for_action(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz,integer,integer,text,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_platform_login_logs(p_actor uuid, p_session uuid, p_q text, p_user uuid, p_result text, p_method text, p_from timestamptz, p_to timestamptz, p_page integer, p_size integer, p_request text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $function$ SELECT public.read_platform_login_logs_for_action(p_actor,p_session,p_q,p_user,p_result,p_method,p_from,p_to,p_page,p_size,p_request,'platform.login:read'); $function$;
--> statement-breakpoint
CREATE FUNCTION public.export_platform_login_logs_page(p_actor uuid, p_session uuid, p_q text, p_user uuid, p_result text, p_method text, p_from timestamptz, p_to timestamptz, p_page integer, p_size integer, p_request text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $function$ SELECT public.read_platform_login_logs_for_action(p_actor,p_session,p_q,p_user,p_result,p_method,p_from,p_to,p_page,p_size,p_request,'platform.login:export'); $function$;
--> statement-breakpoint
ALTER FUNCTION public.export_platform_login_logs_page(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz,integer,integer,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.export_platform_login_logs_page(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz,integer,integer,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.export_platform_login_logs_page(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz,integer,integer,text) TO app_runtime;
--> statement-breakpoint
CREATE FUNCTION public.read_platform_sessions_for_action(p_actor uuid, p_session uuid, p_q text, p_user uuid, p_page integer, p_size integer, p_request text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,p_action);
  IF p_page IS NULL OR p_page < 1 OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 100 OR length(p_q) > 200
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  WITH directory AS (
    SELECT s.id AS session_id, s.user_id, u.name,
      left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2) AS masked_email,
      s.created_at AT TIME ZONE 'UTC' AS created_at, s.updated_at AT TIME ZONE 'UTC' AS updated_at,
      s.expires_at AT TIME ZONE 'UTC' AS expires_at, s.ip_address, s.user_agent
    FROM public.session s JOIN public."user" u ON u.id = s.user_id
    WHERE s.expires_at > clock_timestamp() AND (p_user IS NULL OR s.user_id = p_user)
  ), filtered AS (
    SELECT * FROM directory WHERE p_q IS NULL OR strpos(lower(name), lower(p_q)) > 0
      OR strpos(lower(masked_email), lower(p_q)) > 0 OR user_id::text = p_q
      OR strpos(COALESCE(ip_address, ''), p_q) > 0
  ), page AS (
    SELECT * FROM filtered ORDER BY created_at DESC, session_id DESC LIMIT p_size OFFSET ((p_page::bigint - 1) * p_size)
  ) SELECT jsonb_build_object('items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'sessionId', session_id, 'userId', user_id, 'name', name, 'maskedEmail', masked_email,
    'createdAt', created_at, 'updatedAt', updated_at, 'expiresAt', expires_at,
    'ipAddress', ip_address, 'userAgent', user_agent) ORDER BY created_at DESC, session_id DESC) FROM page), '[]'::jsonb),
    'page', p_page, 'pageSize', p_size, 'total', (SELECT count(*) FROM filtered)) INTO v_result;
  PERFORM public.append_platform_identity_audit(p_actor, 'platform.sessions_queried', p_user, 'succeeded', p_request, NULL);
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
ALTER FUNCTION public.read_platform_sessions_for_action(uuid,uuid,text,uuid,integer,integer,text,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.read_platform_sessions_for_action(uuid,uuid,text,uuid,integer,integer,text,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_platform_sessions(p_actor uuid, p_session uuid, p_q text, p_user uuid, p_page integer, p_size integer, p_request text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $function$ SELECT public.read_platform_sessions_for_action(p_actor,p_session,p_q,p_user,p_page,p_size,p_request,'platform.session:read'); $function$;
--> statement-breakpoint
CREATE FUNCTION public.export_platform_sessions_page(p_actor uuid, p_session uuid, p_q text, p_user uuid, p_page integer, p_size integer, p_request text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $function$ SELECT public.read_platform_sessions_for_action(p_actor,p_session,p_q,p_user,p_page,p_size,p_request,'platform.session:export'); $function$;
--> statement-breakpoint
ALTER FUNCTION public.export_platform_sessions_page(uuid,uuid,text,uuid,integer,integer,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.export_platform_sessions_page(uuid,uuid,text,uuid,integer,integer,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.export_platform_sessions_page(uuid,uuid,text,uuid,integer,integer,text) TO app_runtime;
--> statement-breakpoint
CREATE FUNCTION public.read_platform_audit_events_for_action(
  p_actor uuid, p_session uuid, p_from timestamptz, p_to timestamptz,
  p_organization uuid, p_filter_actor uuid, p_event text, p_result text,
  p_page integer, p_page_size integer, p_request text
,p_action text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_items jsonb; v_total bigint; v_offset bigint; v_now timestamptz;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,p_action);
  v_now := clock_timestamp();
  IF p_to IS NULL THEN p_to := v_now; END IF;
  IF p_from IS NULL THEN p_from := p_to - interval '30 days'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to > v_now OR
    p_to - p_from > interval '90 days' OR p_page IS NULL OR p_page < 1 OR
    p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR
    (p_result IS NOT NULL AND p_result NOT IN ('succeeded', 'denied', 'failed', 'no_change')) OR
    (p_event IS NOT NULL AND length(btrim(p_event)) NOT BETWEEN 1 AND 120)
  THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  v_offset := (p_page::bigint - 1) * p_page_size;

  -- 计数与当前页共享同一语句快照；先分页再关联身份和生成脱敏 JSON。
  -- 每个来源最多取 offset + pageSize 条候选，合并后按完整公开 ID 稳定排序。
  WITH events AS NOT MATERIALIZED (
    SELECT 'event:' || a.id::text AS id, a.occurred_at, a.organization_id, a.scope,
      a.event_code, a.actor_type, a.actor_id, a.resource_type, a.resource_id, a.result,
      '{}'::jsonb AS metadata
    FROM public.audit_events a
    WHERE ((a.scope = 'platform' AND a.event_code = ANY(public.platform_audit_event_codes('platform'))) OR
        (a.scope = 'tenant' AND a.event_code = ANY(public.platform_audit_event_codes('tenant'))))
      AND a.occurred_at BETWEEN p_from AND p_to
      AND (p_organization IS NULL OR a.organization_id = p_organization)
      AND (p_filter_actor IS NULL OR a.actor_id = p_filter_actor)
      AND (p_event IS NULL OR a.event_code = p_event)
      AND (p_result IS NULL OR a.result = p_result)
  ), assignments AS NOT MATERIALIZED (
    SELECT 'assignment:' || a.id::text AS id, a.created_at AS occurred_at,
      NULL::uuid AS organization_id, 'platform'::text AS scope,
      CASE a.action WHEN 'grant' THEN 'platform.role_granted' ELSE 'platform.role_revoked' END AS event_code,
      'deployment_operator'::text AS actor_type, NULL::uuid AS actor_id,
      'user'::text AS resource_type, a.user_id AS resource_id,
      CASE a.result WHEN 'changed' THEN 'succeeded' ELSE 'no_change' END AS result,
      jsonb_build_object('previousRole', a.previous_role, 'nextRole', a.next_role) AS metadata
    FROM public.platform_assignment_audit a
    WHERE p_organization IS NULL AND p_filter_actor IS NULL
      AND a.created_at BETWEEN p_from AND p_to
      AND (p_event IS NULL OR CASE a.action WHEN 'grant' THEN 'platform.role_granted' ELSE 'platform.role_revoked' END = p_event)
      AND (p_result IS NULL OR CASE a.result WHEN 'changed' THEN 'succeeded' ELSE 'no_change' END = p_result)
  ), candidates AS MATERIALIZED (
    (SELECT * FROM events ORDER BY occurred_at DESC, id DESC LIMIT v_offset + p_page_size)
    UNION ALL
    (SELECT * FROM assignments ORDER BY occurred_at DESC, id DESC LIMIT v_offset + p_page_size)
  ), page AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY occurred_at DESC, id DESC LIMIT p_page_size OFFSET v_offset
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', page.id, 'occurredAt', page.occurred_at, 'scope', page.scope,
    'targetOrganization', CASE WHEN page.organization_id IS NULL THEN NULL ELSE
      jsonb_build_object('organizationId', page.organization_id, 'name', o.name) END,
    'eventCode', page.event_code, 'actorType', page.actor_type, 'actorId', page.actor_id,
    'actorMaskedEmail', CASE WHEN u.email IS NULL THEN NULL ELSE left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2) END,
    'resourceType', page.resource_type, 'resourceId', page.resource_id, 'result', page.result,
    'metadata', page.metadata
  ) ORDER BY page.occurred_at DESC, page.id DESC), '[]'::jsonb),
    (SELECT count(*) FROM events) + (SELECT count(*) FROM assignments)
  INTO v_items, v_total FROM page
  LEFT JOIN public.organization o ON o.id = page.organization_id
  LEFT JOIN public."user" u ON u.id = page.actor_id;

  BEGIN
    -- 读取事实发生在查询完成之后，不能使用事务开始时间落入本次冻结窗口。
    INSERT INTO public.audit_events(scope, event_code, actor_id, result, reason, request_id, occurred_at, fields)
    VALUES ('platform', 'platform.audit_queried', p_actor, 'succeeded', NULL, p_request, clock_timestamp(),
      jsonb_build_object('from', p_from, 'to', p_to, 'organizationId', p_organization,
        'actorId', p_filter_actor, 'eventCode', p_event, 'result', p_result,
        'page', p_page, 'pageSize', p_page_size));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN jsonb_build_object('items', v_items, 'page', p_page, 'pageSize', p_page_size, 'total', v_total,
    'window', jsonb_build_object('from', p_from, 'to', p_to));
END;
$function$;
--> statement-breakpoint
ALTER FUNCTION public.read_platform_audit_events_for_action(uuid,uuid,timestamptz,timestamptz,uuid,uuid,text,text,integer,integer,text,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.read_platform_audit_events_for_action(uuid,uuid,timestamptz,timestamptz,uuid,uuid,text,text,integer,integer,text,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_platform_audit_events(
  p_actor uuid, p_session uuid, p_from timestamptz, p_to timestamptz,
  p_organization uuid, p_filter_actor uuid, p_event text, p_result text,
  p_page integer, p_page_size integer, p_request text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $function$ SELECT public.read_platform_audit_events_for_action(p_actor,p_session,p_from,p_to,p_organization,p_filter_actor,p_event,p_result,p_page,p_page_size,p_request,'platform.audit:read'); $function$;
--> statement-breakpoint
CREATE FUNCTION public.export_platform_audit_events_page(
  p_actor uuid, p_session uuid, p_from timestamptz, p_to timestamptz,
  p_organization uuid, p_filter_actor uuid, p_event text, p_result text,
  p_page integer, p_page_size integer, p_request text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $function$ SELECT public.read_platform_audit_events_for_action(p_actor,p_session,p_from,p_to,p_organization,p_filter_actor,p_event,p_result,p_page,p_page_size,p_request,'platform.audit:export'); $function$;
--> statement-breakpoint
ALTER FUNCTION public.export_platform_audit_events_page(uuid,uuid,timestamptz,timestamptz,uuid,uuid,text,text,integer,integer,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.export_platform_audit_events_page(uuid,uuid,timestamptz,timestamptz,uuid,uuid,text,text,integer,integer,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.export_platform_audit_events_page(uuid,uuid,timestamptz,timestamptz,uuid,uuid,text,text,integer,integer,text) TO app_runtime;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM platform_executor;
