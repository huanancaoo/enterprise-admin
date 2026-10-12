-- 系统入口只改变绑定真实意图的任务元数据，业务输入与结果内容仍只能通过 TenantTx 读取。
GRANT SELECT (request_id, created_at, updated_at) ON public.business_tasks TO platform_executor;
GRANT UPDATE (status, error_code, updated_at) ON public.business_tasks TO platform_executor;
CREATE POLICY business_tasks_attempt_update ON public.business_tasks FOR UPDATE TO platform_executor
  USING (status IN ('submitted', 'queued', 'running'))
  WITH CHECK (status IN ('queued', 'running', 'failed', 'rejected'));
CREATE POLICY audit_events_business_task_insert ON public.audit_events FOR INSERT TO platform_executor
  WITH CHECK (scope = 'tenant' AND actor_type = 'user' AND resource_type = 'task'
    AND event_code IN ('task.failed', 'task.rejected') AND result IN ('failed', 'denied')
    AND organization_id IS NOT NULL AND actor_id IS NOT NULL AND resource_id IS NOT NULL);

CREATE FUNCTION public.pending_business_task_scopes(p_after uuid)
RETURNS TABLE(id uuid, organization_id uuid, actor_id uuid, type text, locale text, request_id text, intent_fingerprint text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
  SELECT id, organization_id, actor_id, type, locale, request_id, intent_fingerprint
    FROM public.business_tasks WHERE status IN ('submitted', 'queued', 'running') AND (p_after IS NULL OR id > p_after)
    ORDER BY id LIMIT 100;
$function$;
CREATE FUNCTION public.record_business_task_attempt(p_org uuid, p_actor uuid, p_task uuid, p_hash text, p_status text, p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE task record;
BEGIN
  IF p_status NOT IN ('queued', 'running', 'failed', 'rejected')
    OR (p_status IN ('failed', 'rejected') AND (p_code IS NULL OR p_code NOT IN ('IMPORT_VALIDATION_FAILED', 'MEMBERSHIP_REQUIRED', 'PERMISSION_DENIED', 'ORGANIZATION_SUSPENDED', 'RESOURCE_DENIED', 'EXECUTION_FAILED')))
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
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.pending_business_task_scopes(uuid) OWNER TO platform_executor;
ALTER FUNCTION public.record_business_task_attempt(uuid, uuid, uuid, text, text, text) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.pending_business_task_scopes(uuid), public.record_business_task_attempt(uuid, uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pending_business_task_scopes(uuid), public.record_business_task_attempt(uuid, uuid, uuid, text, text, text) TO app_runtime;
