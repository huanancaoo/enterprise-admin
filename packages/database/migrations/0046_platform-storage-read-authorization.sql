CREATE OR REPLACE FUNCTION public.get_platform_storage_policy(p_actor uuid, p_session uuid, p_organization uuid, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_organization_access(p_actor, p_session, false);
  IF NOT EXISTS (SELECT 1 FROM public.organization WHERE id = p_organization) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM set_config('app.platform_storage_organization_id', p_organization::text, true);
  INSERT INTO public.file_storage_usage (organization_id) VALUES (p_organization) ON CONFLICT DO NOTHING;
  -- 初始化或冲突等待后，实际读取摘要前重新验证当前 Session 和平台任职。
  PERFORM public.require_platform_organization_access(p_actor, p_session, false);
  SELECT jsonb_build_object('organizationId', organization_id, 'quotaBytes', quota_bytes,
    'usedBytes', used_bytes, 'reservedBytes', reserved_bytes, 'transientBytes', transient_bytes,
    'trashDays', trash_days, 'historyDays', history_days, 'version', policy_revision,
    'overQuota', used_bytes + reserved_bytes > quota_bytes)
  INTO v_result FROM public.file_storage_usage WHERE organization_id = p_organization;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  -- 平台只读取容量与策略，访问审计失败不能返回刚查询的摘要。
  BEGIN
    INSERT INTO public.audit_events (organization_id, scope, event_code, actor_id, resource_type,
      resource_id, result, request_id, tenant_visible, fields)
    VALUES (p_organization, 'platform', 'platform.storage_policy_viewed', p_actor, 'file_storage_policy',
      p_organization, 'succeeded', p_request, false, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
