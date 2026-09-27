ALTER TABLE "audit_events" ALTER COLUMN "organization_id" DROP NOT NULL;
--> statement-breakpoint
GRANT INSERT (organization_id, scope, event_code, actor_type, actor_id, result, reason, request_id, tenant_visible, fields)
  ON public.audit_events TO platform_executor;
--> statement-breakpoint
CREATE POLICY audit_events_platform_denial ON public.audit_events
FOR INSERT TO platform_executor
WITH CHECK (
  organization_id IS NULL AND scope = 'platform'
  AND event_code = 'platform.access_denied' AND result = 'denied'
  AND NOT tenant_visible
);
--> statement-breakpoint
-- 固定事件只接受服务端拒绝分类；不能借平台函数写入任意组织事件或公开内部原因。
CREATE FUNCTION public.record_platform_access_denial(p_actor_id uuid, p_reason text, p_request_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET row_security = on
AS $function$
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('UNAUTHENTICATED', 'FORBIDDEN', 'PLATFORM_MFA_REQUIRED')
     OR p_request_id IS NULL OR length(btrim(p_request_id)) = 0 THEN
    RAISE EXCEPTION 'Invalid platform denial audit context' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_events (
    organization_id, scope, event_code, actor_type, actor_id,
    result, reason, request_id, tenant_visible, fields
  ) VALUES (
    NULL, 'platform', 'platform.access_denied',
    CASE WHEN p_actor_id IS NULL THEN 'system' ELSE 'user' END, p_actor_id,
    'denied', p_reason, p_request_id, false, '{}'::jsonb
  );
END;
$function$;
--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.record_platform_access_denial(uuid, text, text) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.record_platform_access_denial(uuid, text, text)
  FROM PUBLIC, app_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.record_platform_access_denial(uuid, text, text) TO platform_runtime;
