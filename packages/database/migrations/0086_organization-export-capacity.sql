-- Excel容量拒绝必须能结算为终态，不能因错误码白名单缺失滞留running。
GRANT CREATE ON SCHEMA public TO platform_executor;
SET LOCAL ROLE platform_executor;
CREATE OR REPLACE FUNCTION public.record_business_task_attempt(p_org uuid, p_actor uuid, p_task uuid, p_hash text, p_status text, p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE task record;
BEGIN
  IF p_status NOT IN ('queued', 'running', 'failed', 'rejected')
    OR (p_status IN ('failed', 'rejected') AND (p_code IS NULL OR p_code NOT IN ('IMPORT_VALIDATION_FAILED', 'MEMBERSHIP_REQUIRED', 'PERMISSION_DENIED', 'ORGANIZATION_SUSPENDED', 'RESOURCE_DENIED', 'EXECUTION_FAILED', 'TOO_MANY_ROWS')))
    OR (p_status IN ('queued', 'running') AND p_code IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid task transition';
  END IF;
  SELECT id, organization_id, actor_id, status, request_id INTO task FROM public.business_tasks
    WHERE id = p_task AND organization_id = p_org AND actor_id = p_actor AND intent_fingerprint = p_hash FOR UPDATE;
  IF NOT FOUND OR task.status IN ('completed', 'failed', 'rejected') THEN RETURN false; END IF;
  -- 排队确认可能晚于 Worker 开始；迟到的 queued 不能把 running 状态倒退。
  IF p_status = 'queued' AND task.status <> 'submitted' THEN RETURN false; END IF;
  UPDATE public.business_tasks SET status = p_status, error_code = p_code, updated_at = clock_timestamp() WHERE id = task.id;
  IF p_status IN ('failed', 'rejected') THEN
    INSERT INTO public.audit_events (organization_id, scope, event_code, actor_type, actor_id, resource_type, resource_id, result, reason, request_id, fields)
      VALUES (task.organization_id, 'tenant', 'task.' || p_status, 'user', task.actor_id, 'task', task.id,
        CASE WHEN p_status = 'rejected' THEN 'denied' ELSE 'failed' END, p_code, task.request_id, jsonb_build_object('errorCode', p_code));
    PERFORM public.record_task_result_delivery(p_org, p_actor, p_task, p_hash);
  END IF;
  RETURN true;
END
$function$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.record_business_task_attempt(uuid, uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_business_task_attempt(uuid, uuid, uuid, text, text, text) TO app_runtime;
