-- 读取目的仅作为可选备注；缺省和空白不编造理由，访问事实仍必须写入成功。
CREATE OR REPLACE FUNCTION public.list_platform_audit_events(
  p_actor uuid, p_session uuid, p_purpose text, p_from timestamptz, p_to timestamptz,
  p_organization uuid, p_filter_actor uuid, p_event text, p_result text,
  p_page integer, p_page_size integer, p_request text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_items jsonb; v_total bigint; v_offset bigint; v_now timestamptz;
BEGIN
  PERFORM public.require_platform_user_access(p_actor, p_session, false);
  v_now := clock_timestamp();
  IF p_to IS NULL THEN p_to := v_now; END IF;
  IF p_from IS NULL THEN p_from := p_to - interval '30 days'; END IF;
  IF (p_purpose IS NOT NULL AND length(btrim(p_purpose)) > 500) OR
    p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to > v_now OR
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
    VALUES ('platform', 'platform.audit_queried', p_actor, 'succeeded', nullif(btrim(p_purpose), ''), p_request, clock_timestamp(),
      jsonb_build_object('from', p_from, 'to', p_to, 'organizationId', p_organization,
        'actorId', p_filter_actor, 'eventCode', p_event, 'result', p_result,
        'page', p_page, 'pageSize', p_page_size));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN jsonb_build_object('items', v_items, 'page', p_page, 'pageSize', p_page_size, 'total', v_total,
    'window', jsonb_build_object('from', p_from, 'to', p_to));
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_platform_audit_event(p_actor uuid, p_session uuid, p_id text, p_purpose text, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_event jsonb;
BEGIN
  PERFORM public.require_platform_user_access(p_actor, p_session, false);
  IF (p_purpose IS NOT NULL AND length(btrim(p_purpose)) > 500) OR
    p_id IS NULL OR p_id !~ '^(event|assignment):[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  SELECT event INTO v_event FROM public.platform_audit_projection WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, result, reason, request_id, fields)
    VALUES ('platform', 'platform.audit_viewed', p_actor, 'audit_event', 'succeeded', nullif(btrim(p_purpose), ''), p_request, jsonb_build_object('eventId', p_id));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_event;
END;
$function$;
