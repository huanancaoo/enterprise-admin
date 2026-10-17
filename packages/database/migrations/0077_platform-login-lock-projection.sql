CREATE OR REPLACE FUNCTION public.read_platform_login_logs_for_action(p_actor uuid, p_session uuid, p_q text, p_user uuid, p_result text, p_method text, p_from timestamptz, p_to timestamptz, p_page integer, p_size integer, p_request text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb; v_now timestamptz;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,p_action);
  v_result := public.read_login_events_page(p_q, p_user, p_result, p_method, p_from, p_to, p_page, p_size);
  -- 锁状态属于当前账号，按本页历史身份实时关联，不回写 append-only 登录事实。
  v_now := clock_timestamp();
  SELECT jsonb_set(v_result, '{items}', COALESCE(jsonb_agg(
    item.value || jsonb_build_object('lockedUntil',
      CASE WHEN state.locked_until > v_now THEN state.locked_until END)
    ORDER BY item.ordinality), '[]'::jsonb))
  INTO v_result
  FROM jsonb_array_elements(v_result->'items') WITH ORDINALITY AS item(value,ordinality)
  LEFT JOIN public.password_login_lock state ON state.user_id=(item.value->>'userId')::uuid;
  PERFORM public.append_platform_identity_audit(p_actor, 'platform.login_logs_queried', p_user, 'succeeded', p_request, NULL);
  RETURN v_result;
END;
$function$;
