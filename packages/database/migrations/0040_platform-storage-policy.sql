GRANT SELECT ON public.file_storage_usage TO platform_executor;
GRANT INSERT (organization_id) ON public.file_storage_usage TO platform_executor;
GRANT UPDATE (quota_bytes, trash_days, history_days, policy_revision) ON public.file_storage_usage TO platform_executor;
CREATE POLICY file_storage_usage_platform_read ON public.file_storage_usage FOR SELECT TO platform_executor
USING (organization_id = NULLIF(current_setting('app.platform_storage_organization_id', true), '')::uuid);
CREATE POLICY file_storage_usage_platform_insert ON public.file_storage_usage FOR INSERT TO platform_executor
WITH CHECK (organization_id = NULLIF(current_setting('app.platform_storage_organization_id', true), '')::uuid);
CREATE POLICY file_storage_usage_platform_update ON public.file_storage_usage FOR UPDATE TO platform_executor
USING (organization_id = NULLIF(current_setting('app.platform_storage_organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.platform_storage_organization_id', true), '')::uuid);
CREATE POLICY audit_events_platform_storage_insert ON public.audit_events FOR INSERT TO platform_executor
WITH CHECK (scope = 'platform' AND NOT tenant_visible AND event_code IN ('platform.storage_policy_viewed', 'platform.storage_policy_updated'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.is_platform_audit_event(p_scope text, p_code text)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $function$
  SELECT (p_scope = 'platform' AND p_code IN (
    'platform.access_denied', 'platform.mfa_verified', 'platform.organizations_queried',
    'platform.organization_viewed', 'platform.users_queried', 'platform.user_viewed',
    'platform.user_sensitive_viewed', 'platform.organization_suspended',
    'platform.organization_resumed', 'platform.audit_queried', 'platform.audit_viewed',
    'platform.settings_viewed', 'platform.settings_updated',
    'platform.storage_policy_viewed', 'platform.storage_policy_updated'
  )) OR (p_scope = 'tenant' AND p_code IN (
    'member.invited', 'invitation.resent', 'invitation.accepted', 'invitation.rejected',
    'invitation.canceled', 'member.role_changed', 'member.removed', 'member.left',
    'role.created', 'role.updated', 'role.deleted', 'organization.settings_updated',
    'invitation.delivery_smtp_accepted', 'invitation.delivery_failed', 'invitation.delivery_unknown'
  ));
$function$;
--> statement-breakpoint
CREATE FUNCTION public.get_platform_storage_policy(p_actor uuid, p_session uuid, p_organization uuid, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_organization_access(p_actor, p_session, false);
  IF NOT EXISTS (SELECT 1 FROM public.organization WHERE id = p_organization) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM set_config('app.platform_storage_organization_id', p_organization::text, true);
  INSERT INTO public.file_storage_usage (organization_id) VALUES (p_organization) ON CONFLICT DO NOTHING;
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
--> statement-breakpoint
CREATE FUNCTION public.update_platform_storage_policy(p_actor uuid, p_session uuid, p_organization uuid,
  p_quota bigint, p_trash_days integer, p_history_days integer, p_reason text, p_expected integer,
  p_key text, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_usage public.file_storage_usage%ROWTYPE; v_previous jsonb; v_changed boolean; v_result jsonb;
  v_hash text; v_receipt record; v_operation uuid;
  v_scope text := 'platform:storage:' || p_organization::text;
BEGIN
  PERFORM public.require_platform_organization_access(p_actor, p_session, true);
  IF p_quota IS NULL OR p_quota NOT BETWEEN 0 AND 9007199254740991 OR p_trash_days IS NULL OR p_trash_days < 1
    OR p_history_days IS NULL OR p_history_days < 1 OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 500
    OR p_expected IS NULL OR p_expected < 1 OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 128
    OR p_key !~ '^[A-Za-z0-9:_-]+$' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization WHERE id = p_organization) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM set_config('app.platform_storage_organization_id', p_organization::text, true);
  INSERT INTO public.file_storage_usage (organization_id) VALUES (p_organization) ON CONFLICT DO NOTHING;
  -- 与租户上传预留共用同一行锁；降低配额不删已有对象，只阻止后续新增容量。
  SELECT * INTO v_usage FROM public.file_storage_usage WHERE organization_id = p_organization FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  PERFORM public.require_platform_organization_access(p_actor, p_session, true);
  v_hash := encode(sha256(convert_to(jsonb_build_object('quotaBytes', p_quota, 'trashDays', p_trash_days,
    'historyDays', p_history_days, 'reason', p_reason, 'expectedVersion', p_expected)::text, 'UTF8')), 'hex');
  DELETE FROM public.operation_receipts WHERE actor_id = p_actor AND scope_key = v_scope AND expires_at <= clock_timestamp();
  SELECT request_hash, safe_result INTO v_receipt FROM public.operation_receipts
    WHERE actor_id = p_actor AND scope_key = v_scope AND action = 'updateStoragePolicy' AND idempotency_key = p_key;
  IF FOUND THEN
    IF v_receipt.request_hash <> v_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    RETURN v_receipt.safe_result;
  END IF;
  IF v_usage.policy_revision <> p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  v_previous := jsonb_build_object('quotaBytes', v_usage.quota_bytes, 'trashDays', v_usage.trash_days, 'historyDays', v_usage.history_days);
  v_changed := (v_usage.quota_bytes, v_usage.trash_days, v_usage.history_days) IS DISTINCT FROM (p_quota, p_trash_days, p_history_days);
  v_operation := gen_random_uuid();
  IF v_changed THEN
    UPDATE public.file_storage_usage SET quota_bytes = p_quota, trash_days = p_trash_days,
      history_days = p_history_days, policy_revision = policy_revision + 1 WHERE organization_id = p_organization RETURNING * INTO v_usage;
  END IF;
  v_result := jsonb_build_object('organizationId', p_organization, 'quotaBytes', v_usage.quota_bytes,
    'usedBytes', v_usage.used_bytes, 'reservedBytes', v_usage.reserved_bytes, 'transientBytes', v_usage.transient_bytes,
    'trashDays', v_usage.trash_days, 'historyDays', v_usage.history_days, 'version', v_usage.policy_revision,
    'overQuota', v_usage.used_bytes + v_usage.reserved_bytes > v_usage.quota_bytes,
    'changed', v_changed, 'result', CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END, 'operationId', v_operation);
  BEGIN
    INSERT INTO public.audit_events (organization_id, scope, event_code, actor_id, resource_type, resource_id,
      result, reason, request_id, operation_id, tenant_visible, fields)
    VALUES (p_organization, 'platform', 'platform.storage_policy_updated', p_actor, 'file_storage_policy', p_organization,
      CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END, p_reason, p_request, v_operation::text, false,
      jsonb_build_object('previous', v_previous, 'quotaBytes', p_quota, 'trashDays', p_trash_days,
        'historyDays', p_history_days, 'version', v_usage.policy_revision));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  -- 已记录的版本/回收期限不被追溯改写；策略、收据与成功审计同时提交。
  INSERT INTO public.operation_receipts (actor_id, scope_key, action, idempotency_key, request_hash, operation_id, safe_result, expires_at)
  VALUES (p_actor, v_scope, 'updateStoragePolicy', p_key, v_hash, v_operation, v_result, clock_timestamp() + interval '24 hours');
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.record_platform_storage_policy_failure(p_actor uuid, p_organization uuid, p_action text, p_code text, p_request text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('get', 'update') OR p_code IS NULL
    OR p_code NOT IN ('FORBIDDEN', 'PLATFORM_MFA_REQUIRED', 'NOT_FOUND', 'VERSION_CONFLICT',
      'IDEMPOTENCY_KEY_REUSED', 'AUDIT_UNAVAILABLE', 'AUTHORIZATION_UNAVAILABLE', 'INTERNAL_ERROR') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  INSERT INTO public.audit_events (organization_id, scope, event_code, actor_id, resource_type, resource_id,
    result, reason, request_id, tenant_visible, fields)
  VALUES (p_organization, 'platform', CASE p_action WHEN 'get' THEN 'platform.storage_policy_viewed'
    ELSE 'platform.storage_policy_updated' END, p_actor, 'file_storage_policy', p_organization,
    CASE WHEN p_code IN ('FORBIDDEN', 'PLATFORM_MFA_REQUIRED') THEN 'denied' ELSE 'failed' END,
    p_code, p_request, false, jsonb_build_object('action', p_action));
END;
$function$;
--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.get_platform_storage_policy(uuid, uuid, uuid, text) OWNER TO platform_executor;
ALTER FUNCTION public.update_platform_storage_policy(uuid, uuid, uuid, bigint, integer, integer, text, integer, text, text) OWNER TO platform_executor;
ALTER FUNCTION public.record_platform_storage_policy_failure(uuid, uuid, text, text, text) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.get_platform_storage_policy(uuid, uuid, uuid, text) FROM PUBLIC, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.update_platform_storage_policy(uuid, uuid, uuid, bigint, integer, integer, text, integer, text, text) FROM PUBLIC, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.record_platform_storage_policy_failure(uuid, uuid, text, text, text) FROM PUBLIC, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.get_platform_storage_policy(uuid, uuid, uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.update_platform_storage_policy(uuid, uuid, uuid, bigint, integer, integer, text, integer, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.record_platform_storage_policy_failure(uuid, uuid, text, text, text) TO app_runtime;
