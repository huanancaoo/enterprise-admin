CREATE OR REPLACE FUNCTION public.list_platform_audit_events(
  p_actor uuid, p_session uuid, p_purpose text, p_from timestamptz, p_to timestamptz,
  p_organization uuid, p_filter_actor uuid, p_event text, p_result text,
  p_before_at timestamptz, p_before_id text, p_limit integer, p_request text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_items jsonb; v_next jsonb; v_rows jsonb; v_now timestamptz;
BEGIN
  PERFORM public.require_platform_user_access(p_actor, p_session, false);
  v_now := clock_timestamp();
  IF p_to IS NULL THEN p_to := v_now; END IF;
  IF p_from IS NULL THEN p_from := p_to - interval '30 days'; END IF;
  IF p_purpose IS NULL OR length(btrim(p_purpose)) NOT BETWEEN 1 AND 500 OR
    p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to > v_now OR
    p_to - p_from > interval '90 days' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR
    (p_result IS NOT NULL AND p_result NOT IN ('succeeded', 'denied', 'failed', 'no_change')) OR
    (p_event IS NOT NULL AND length(btrim(p_event)) NOT BETWEEN 1 AND 120) OR
    ((p_before_at IS NULL) <> (p_before_id IS NULL)) OR
    (p_before_id IS NOT NULL AND p_before_id !~ '^(event|assignment):[0-9a-f-]{36}$')
  THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;

  -- 每个来源先按已有时间/UUID 索引选取至多一页，再合并排序和生成脱敏 JSON。
  -- UUID 的固定格式在同一来源保持原文本 ID 的次序；来源间仍用完整公开 ID 排序。
  WITH candidates AS MATERIALIZED (
    (SELECT 'event:' || a.id::text AS id, a.occurred_at, a.organization_id, a.scope,
        a.event_code, a.actor_type, a.actor_id, a.resource_type, a.resource_id, a.result,
        '{}'::jsonb AS metadata
      FROM public.audit_events a
      WHERE public.is_platform_audit_event(a.scope, a.event_code)
        AND a.occurred_at BETWEEN p_from AND p_to
        AND (p_organization IS NULL OR a.organization_id = p_organization)
        AND (p_filter_actor IS NULL OR a.actor_id = p_filter_actor)
        AND (p_event IS NULL OR a.event_code = p_event)
        AND (p_result IS NULL OR a.result = p_result)
        AND (p_before_at IS NULL OR (a.occurred_at, 'event:' || a.id::text) < (p_before_at, p_before_id))
      ORDER BY a.occurred_at DESC, a.id DESC LIMIT p_limit + 1)
    UNION ALL
    (SELECT 'assignment:' || a.id::text AS id, a.created_at AS occurred_at,
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
        AND (p_before_at IS NULL OR (a.created_at, 'assignment:' || a.id::text) < (p_before_at, p_before_id))
      ORDER BY a.created_at DESC, a.id DESC LIMIT p_limit + 1)
  ), page AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY occurred_at DESC, id DESC LIMIT p_limit + 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('at', page.occurred_at, 'id', page.id,
    'event', jsonb_build_object(
      'id', page.id, 'occurredAt', page.occurred_at, 'scope', page.scope,
      'targetOrganization', CASE WHEN page.organization_id IS NULL THEN NULL ELSE
        jsonb_build_object('organizationId', page.organization_id, 'name', o.name) END,
      'eventCode', page.event_code, 'actorType', page.actor_type, 'actorId', page.actor_id,
      'actorMaskedEmail', CASE WHEN u.email IS NULL THEN NULL ELSE left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2) END,
      'resourceType', page.resource_type, 'resourceId', page.resource_id, 'result', page.result,
      'metadata', page.metadata
    ))
    ORDER BY page.occurred_at DESC, page.id DESC), '[]'::jsonb)
  INTO v_rows FROM page
  LEFT JOIN public.organization o ON o.id = page.organization_id
  LEFT JOIN public."user" u ON u.id = page.actor_id;

  SELECT coalesce(jsonb_agg(row.value->'event' ORDER BY row.ordinality), '[]'::jsonb)
    INTO v_items FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS row(value, ordinality)
    WHERE row.ordinality <= p_limit;
  IF jsonb_array_length(v_rows) > p_limit THEN
    v_next := jsonb_build_object('occurredAt', v_rows->(p_limit - 1)->'at', 'id', v_rows->(p_limit - 1)->'id');
  ELSE v_next := NULL; END IF;
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, result, reason, request_id, fields)
    VALUES ('platform', 'platform.audit_queried', p_actor, 'succeeded', btrim(p_purpose), p_request,
      jsonb_build_object('from', p_from, 'to', p_to, 'organizationId', p_organization,
        'actorId', p_filter_actor, 'eventCode', p_event, 'result', p_result, 'limit', p_limit));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN jsonb_build_object('items', v_items, 'next', v_next, 'window', jsonb_build_object('from', p_from, 'to', p_to));
END;
$function$;
