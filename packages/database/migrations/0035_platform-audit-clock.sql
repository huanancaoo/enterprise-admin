CREATE OR REPLACE FUNCTION public.list_platform_audit_events(
  p_actor uuid, p_session uuid, p_purpose text, p_from timestamptz, p_to timestamptz,
  p_organization uuid, p_filter_actor uuid, p_event text, p_result text,
  p_before_at timestamptz, p_before_id text, p_limit integer, p_request text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_items jsonb; v_next jsonb; v_rows jsonb; v_now timestamptz;
BEGIN
  PERFORM public.require_platform_user_access(p_actor, p_session, false);
  -- 默认窗口和未来时间校验采用同一数据库时钟，API 主机时差不改变查询范围。
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
  SELECT coalesce(jsonb_agg(jsonb_build_object('at', occurred_at, 'id', id, 'event', event) ORDER BY occurred_at DESC, id DESC), '[]'::jsonb)
  INTO v_rows FROM (
    SELECT * FROM public.platform_audit_projection
    WHERE occurred_at BETWEEN p_from AND p_to
      AND (p_organization IS NULL OR organization_id = p_organization)
      AND (p_filter_actor IS NULL OR actor_id = p_filter_actor)
      AND (p_event IS NULL OR event_code = p_event)
      AND (p_result IS NULL OR result = p_result)
      AND (p_before_at IS NULL OR (occurred_at, id) < (p_before_at, p_before_id))
    ORDER BY occurred_at DESC, id DESC LIMIT p_limit + 1
  ) page;
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
