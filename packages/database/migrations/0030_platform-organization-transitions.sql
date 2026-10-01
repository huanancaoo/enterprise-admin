GRANT SELECT, INSERT, DELETE ON public.operation_receipts TO platform_executor;
GRANT SELECT (authorization_version) ON public.organization_status TO platform_executor;
GRANT UPDATE (status, status_version, authorization_version, status_changed_at, status_changed_by, internal_reason)
  ON public.organization_status TO platform_executor;
--> statement-breakpoint
CREATE FUNCTION public.transition_platform_organization(
  p_actor uuid, p_session uuid, p_organization uuid, p_action text,
  p_reason text, p_expected integer, p_key text, p_request text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE
  v_status text; v_version integer; v_target text;
  v_scope text := 'platform:organization:' || p_organization::text;
  v_hash text; v_receipt record; v_operation uuid; v_result jsonb; v_changed boolean;
BEGIN
  PERFORM public.require_platform_organization_access(p_actor, p_session, true);
  IF p_action IS NULL OR p_action NOT IN ('suspend', 'resume') OR p_reason IS NULL
    OR length(btrim(p_reason)) NOT BETWEEN 10 AND 500 OR p_expected IS NULL OR p_expected < 1
    OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 128 OR p_key !~ '^[A-Za-z0-9:_-]+$' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  -- 与 TenantTx、原生组织写入使用同一状态行锁；锁决定写入和停用的提交边界。
  SELECT status, status_version INTO v_status, v_version FROM public.organization_status
  WHERE organization_id = p_organization FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  -- 等待组织锁期间任职或 MFA 可能变化；必须在读取旧收据前重新授权。
  PERFORM public.require_platform_organization_access(p_actor, p_session, true);
  v_hash := encode(sha256(convert_to(jsonb_build_object('reason', p_reason, 'expectedVersion', p_expected)::text, 'UTF8')), 'hex');
  DELETE FROM public.operation_receipts WHERE actor_id = p_actor AND scope_key = v_scope AND expires_at <= clock_timestamp();
  SELECT request_hash, safe_result INTO v_receipt FROM public.operation_receipts
  WHERE actor_id = p_actor AND scope_key = v_scope AND action = p_action AND idempotency_key = p_key;
  IF FOUND THEN
    IF v_receipt.request_hash <> v_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    RETURN v_receipt.safe_result;
  END IF;
  IF v_version <> p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  v_target := CASE p_action WHEN 'suspend' THEN 'SUSPENDED' ELSE 'ACTIVE' END;
  v_changed := v_status <> v_target;
  v_operation := gen_random_uuid();
  IF v_changed THEN
    UPDATE public.organization_status SET status = v_target, status_version = status_version + 1,
      authorization_version = authorization_version + 1, status_changed_at = clock_timestamp(),
      status_changed_by = p_actor, internal_reason = p_reason WHERE organization_id = p_organization
    RETURNING status_version INTO v_version;
  END IF;
  v_result := jsonb_build_object('organizationId', p_organization, 'status', v_target, 'version', v_version,
    'changed', v_changed, 'result', CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END, 'operationId', v_operation);
  BEGIN
    INSERT INTO public.audit_events (organization_id, scope, event_code, actor_id, resource_type, resource_id,
      result, reason, request_id, operation_id, tenant_visible, public_summary, fields)
    VALUES (p_organization, 'platform', CASE WHEN NOT v_changed THEN 'platform.organization_transition_attempted'
      WHEN p_action = 'suspend' THEN 'platform.organization_suspended' ELSE 'platform.organization_resumed' END,
      p_actor, 'organization', p_organization, CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END,
      p_reason, p_request, v_operation::text, v_changed,
      CASE WHEN v_changed THEN CASE p_action WHEN 'suspend' THEN 'Organization suspended' ELSE 'Organization resumed' END END,
      jsonb_build_object('action', p_action, 'previousStatus', v_status, 'status', v_target, 'version', v_version));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  -- 收据、状态和成功审计属于同一事务；只有完整提交的结果才能被重放。
  INSERT INTO public.operation_receipts (actor_id, scope_key, action, idempotency_key, request_hash, operation_id, safe_result, expires_at)
  VALUES (p_actor, v_scope, p_action, p_key, v_hash, v_operation, v_result, clock_timestamp() + interval '24 hours');
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.record_platform_organization_failure(
  p_actor uuid, p_organization uuid, p_action text, p_code text, p_request text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('list', 'get', 'suspend', 'resume') OR p_code IS NULL
    OR p_code NOT IN ('FORBIDDEN', 'PLATFORM_MFA_REQUIRED', 'NOT_FOUND', 'VERSION_CONFLICT', 'IDEMPOTENCY_KEY_REUSED',
      'AUDIT_UNAVAILABLE', 'AUTHORIZATION_UNAVAILABLE', 'INTERNAL_ERROR') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  -- 失败尝试独立提交，不因原状态转换事务回滚而丢失；只保存稳定错误码。
  INSERT INTO public.audit_events (organization_id, scope, event_code, actor_id, resource_type, resource_id,
    result, reason, request_id, fields)
  VALUES (p_organization, 'platform', CASE p_action
    WHEN 'list' THEN 'platform.organizations_queried' WHEN 'get' THEN 'platform.organization_viewed'
    ELSE 'platform.organization_transition_attempted' END, p_actor, 'organization', p_organization,
    CASE WHEN p_code IN ('FORBIDDEN', 'PLATFORM_MFA_REQUIRED') THEN 'denied' ELSE 'failed' END,
    p_code, p_request, jsonb_build_object('action', p_action));
END;
$function$;
--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.transition_platform_organization(uuid, uuid, uuid, text, text, integer, text, text) OWNER TO platform_executor;
ALTER FUNCTION public.record_platform_organization_failure(uuid, uuid, text, text, text) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.transition_platform_organization(uuid, uuid, uuid, text, text, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_platform_organization_failure(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_platform_organization(uuid, uuid, uuid, text, text, integer, text, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.record_platform_organization_failure(uuid, uuid, text, text, text) TO app_runtime;
