-- 投递器通过受限固定入口领取意图；载荷、签名密钥与收件地址仍在当前授权的 TenantTx 中读取。
GRANT SELECT (id, organization_id, actor_id, type, status, locale, result, error_code, intent_fingerprint) ON public.business_tasks TO platform_executor;
-- UPDATE 单列仅用于 FOR UPDATE 行锁；WITH CHECK false 不允许本投递入口修改任务事实。
GRANT UPDATE (id) ON public.business_tasks TO platform_executor;
GRANT SELECT, INSERT, UPDATE ON public.business_notifications TO platform_executor;
GRANT SELECT (id, organization_id, actor_id, enabled, events) ON public.webhook_endpoints TO platform_executor;
GRANT SELECT, INSERT ON public.domain_events TO platform_executor;
GRANT SELECT, INSERT, UPDATE ON public.webhook_deliveries TO platform_executor;
CREATE POLICY business_tasks_delivery_read ON public.business_tasks FOR SELECT TO platform_executor USING (true);
CREATE POLICY business_tasks_delivery_lock ON public.business_tasks FOR UPDATE TO platform_executor USING (true) WITH CHECK (false);
CREATE POLICY business_notifications_delivery ON public.business_notifications TO platform_executor USING (true) WITH CHECK (true);
CREATE POLICY webhook_endpoints_delivery_read ON public.webhook_endpoints FOR SELECT TO platform_executor USING (true);
CREATE POLICY domain_events_delivery_read ON public.domain_events FOR SELECT TO platform_executor USING (true);
CREATE POLICY domain_events_delivery_insert ON public.domain_events FOR INSERT TO platform_executor WITH CHECK (true);
CREATE POLICY webhook_deliveries_delivery ON public.webhook_deliveries TO platform_executor USING (true) WITH CHECK (true);

-- 已丧失成员或动作资格的任务仍须记录真实终态。调用者先在同一事务按意图绑定更新任务；本入口只派生已持久化的结果。
CREATE FUNCTION public.record_task_result_delivery(p_organization uuid, p_actor uuid, p_task uuid, p_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE task record; event_type text; delivery_event_id uuid;
BEGIN
  SELECT id, organization_id, actor_id, type, status, result, error_code
    INTO task FROM public.business_tasks
    WHERE id = p_task AND organization_id = p_organization AND actor_id = p_actor
      AND intent_fingerprint = p_hash AND status IN ('completed', 'failed', 'rejected') FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  event_type := CASE WHEN task.status = 'completed' THEN 'task.completed' ELSE 'task.failed' END;
  INSERT INTO public.business_notifications (organization_id, recipient_id, task_id, task_type, type)
    VALUES (task.organization_id, task.actor_id, task.id, task.type, event_type)
    ON CONFLICT (task_id, recipient_id) DO NOTHING;
  -- 正常生产者与系统结算共用 task 行锁；重复调用复用原事件身份，不产生新的外部事件。
  SELECT id INTO delivery_event_id FROM public.domain_events
    WHERE organization_id = task.organization_id AND resource_id = task.id
      AND type IN ('task.completed', 'task.failed') LIMIT 1;
  IF delivery_event_id IS NULL THEN
    INSERT INTO public.domain_events (organization_id, actor_id, type, resource_id, payload)
      VALUES (task.organization_id, task.actor_id, event_type, task.id,
        jsonb_build_object('taskType', task.type, 'status', task.status,
          'count', COALESCE(task.result -> 'count', '0'::jsonb), 'errorCode', task.error_code)) RETURNING id INTO delivery_event_id;
  END IF;
  INSERT INTO public.webhook_deliveries (organization_id, webhook_id, event_id)
    SELECT task.organization_id, endpoint.id, delivery_event_id FROM public.webhook_endpoints endpoint
    WHERE endpoint.organization_id = task.organization_id AND endpoint.enabled AND endpoint.events @> jsonb_build_array(event_type)
    ON CONFLICT (webhook_id, event_id) DO NOTHING;
  RETURN delivery_event_id;
END
$function$;

CREATE FUNCTION public.claim_notification_email(p_lease_ms integer, p_attempts integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE candidate uuid; claimed public.business_notifications; task_locale text;
BEGIN
  IF p_lease_ms < 1 OR p_lease_ms > 300000 OR p_attempts < 1 OR p_attempts > 20 THEN RAISE EXCEPTION 'Invalid delivery configuration'; END IF;
  UPDATE public.business_notifications SET email_status = 'failed', email_lease_token = NULL, email_lease_until = NULL
    WHERE email_status = 'pending' AND email_attempts >= p_attempts AND (email_lease_until IS NULL OR email_lease_until <= clock_timestamp());
  SELECT id INTO candidate FROM public.business_notifications
    WHERE email_status = 'pending' AND email_attempts < p_attempts AND email_next_attempt_at <= clock_timestamp()
      AND (email_lease_until IS NULL OR email_lease_until <= clock_timestamp()) ORDER BY email_next_attempt_at, id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF candidate IS NULL THEN RETURN NULL; END IF;
  -- 领取先登记 attempt，使进程崩溃后的重新领取仍受有界尝试次数约束。
  UPDATE public.business_notifications SET email_lease_token = gen_random_uuid(), email_lease_until = clock_timestamp() + p_lease_ms * interval '1 millisecond',
    email_attempts = email_attempts + 1 WHERE id = candidate RETURNING * INTO claimed;
  SELECT locale INTO task_locale FROM public.business_tasks WHERE id = claimed.task_id AND organization_id = claimed.organization_id AND actor_id = claimed.recipient_id;
  RETURN jsonb_build_object('id', claimed.id, 'organizationId', claimed.organization_id, 'actorId', claimed.recipient_id,
    'taskId', claimed.task_id, 'locale', task_locale, 'leaseToken', claimed.email_lease_token, 'attempts', claimed.email_attempts);
END
$function$;
CREATE FUNCTION public.settle_notification_email(p_id uuid, p_lease uuid, p_status text, p_next timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE changed integer;
BEGIN
  IF p_status NOT IN ('pending', 'sent', 'disabled', 'failed') OR p_next IS NULL THEN RAISE EXCEPTION 'Invalid email settlement'; END IF;
  UPDATE public.business_notifications SET email_status = p_status, email_next_attempt_at = p_next,
    email_lease_token = NULL, email_lease_until = NULL WHERE id = p_id AND email_status = 'pending' AND email_lease_token = p_lease;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END
$function$;
CREATE FUNCTION public.claim_webhook_delivery(p_lease_ms integer, p_attempts integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE candidate uuid; claimed public.webhook_deliveries; creator uuid;
BEGIN
  IF p_lease_ms < 1 OR p_lease_ms > 300000 OR p_attempts < 1 OR p_attempts > 20 THEN RAISE EXCEPTION 'Invalid delivery configuration'; END IF;
  UPDATE public.webhook_deliveries SET status = 'failed', next_attempt_at = NULL, lease_token = NULL, lease_until = NULL
    WHERE status = 'pending' AND attempts >= p_attempts AND (lease_until IS NULL OR lease_until <= clock_timestamp());
  SELECT id INTO candidate FROM public.webhook_deliveries
    WHERE status = 'pending' AND attempts < p_attempts AND next_attempt_at <= clock_timestamp()
      AND (lease_until IS NULL OR lease_until <= clock_timestamp()) ORDER BY next_attempt_at, id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF candidate IS NULL THEN RETURN NULL; END IF;
  UPDATE public.webhook_deliveries SET lease_token = gen_random_uuid(), lease_until = clock_timestamp() + p_lease_ms * interval '1 millisecond',
    attempts = attempts + 1 WHERE id = candidate RETURNING * INTO claimed;
  SELECT actor_id INTO creator FROM public.webhook_endpoints WHERE id = claimed.webhook_id AND organization_id = claimed.organization_id;
  RETURN jsonb_build_object('id', claimed.id, 'organizationId', claimed.organization_id, 'actorId', creator,
    'webhookId', claimed.webhook_id, 'eventId', claimed.event_id, 'leaseToken', claimed.lease_token, 'attempts', claimed.attempts);
END
$function$;
CREATE FUNCTION public.settle_webhook_delivery(p_id uuid, p_lease uuid, p_status text, p_http_status integer, p_next timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE changed integer;
BEGIN
  IF p_status NOT IN ('pending', 'delivered', 'failed') OR (p_status = 'pending') <> (p_next IS NOT NULL) THEN RAISE EXCEPTION 'Invalid webhook settlement'; END IF;
  UPDATE public.webhook_deliveries SET status = p_status, last_status_code = p_http_status, next_attempt_at = p_next,
    delivered_at = CASE WHEN p_status = 'delivered' THEN clock_timestamp() ELSE NULL END,
    lease_token = NULL, lease_until = NULL WHERE id = p_id AND status = 'pending' AND lease_token = p_lease;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END
$function$;

GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.record_task_result_delivery(uuid, uuid, uuid, text) OWNER TO platform_executor;
ALTER FUNCTION public.claim_notification_email(integer, integer) OWNER TO platform_executor;
ALTER FUNCTION public.settle_notification_email(uuid, uuid, text, timestamptz) OWNER TO platform_executor;
ALTER FUNCTION public.claim_webhook_delivery(integer, integer) OWNER TO platform_executor;
ALTER FUNCTION public.settle_webhook_delivery(uuid, uuid, text, integer, timestamptz) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.record_task_result_delivery(uuid, uuid, uuid, text), public.claim_notification_email(integer, integer), public.settle_notification_email(uuid, uuid, text, timestamptz), public.claim_webhook_delivery(integer, integer), public.settle_webhook_delivery(uuid, uuid, text, integer, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_task_result_delivery(uuid, uuid, uuid, text), public.claim_notification_email(integer, integer), public.settle_notification_email(uuid, uuid, text, timestamptz), public.claim_webhook_delivery(integer, integer), public.settle_webhook_delivery(uuid, uuid, text, integer, timestamptz) TO app_runtime;
