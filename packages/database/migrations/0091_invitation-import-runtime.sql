-- 接在 Drizzle 的 business_tasks type check 与 delivery actor/request 两列结构迁移之后。
-- 旧代码未持久化 attempt 对应的真实操作者与请求；不推断历史，也不自动恢复旧 pending 邮件。
UPDATE public.invitation_delivery_attempts SET status='unknown',error_code='DELIVERY_CONTEXT_MISSING'
WHERE status='pending' AND (actor_id IS NULL OR request_id IS NULL);

GRANT SELECT (id, invitation_id, organization_id, actor_id, request_id, status, created_at) ON public.invitation_delivery_attempts TO platform_executor;
GRANT UPDATE (status, error_code, started_at, completed_at) ON public.invitation_delivery_attempts TO platform_executor;
GRANT SELECT (id,email,role,status,expires_at,organization_id,inviter_id) ON public.invitation TO platform_executor;
GRANT SELECT (id,name,default_locale) ON public.organization TO platform_executor;
GRANT SELECT (id,name) ON public."user" TO platform_executor;
GRANT SELECT (organization_id), UPDATE (authorization_version) ON public.organization_status TO platform_executor;
-- 领取时仅允许追加“当前邀请已失效”的精确投递事实，不授予审计查询或其他租户写入。
CREATE POLICY invitation_delivery_inactive_audit ON public.audit_events
FOR INSERT TO platform_executor WITH CHECK (
  scope = 'tenant' AND tenant_visible
  AND organization_id = nullif(pg_catalog.current_setting('app.organization_id',true),'')::uuid
  AND actor_type = 'user' AND event_code = 'invitation.delivery_failed' AND result = 'failed'
  AND resource_type = 'invitation'
  AND fields = '{"status":"failed","errorCode":"INVITATION_NOT_ACTIVE"}'::jsonb
  AND EXISTS (SELECT 1 FROM public.invitation_delivery_attempts attempt
    WHERE attempt.organization_id = audit_events.organization_id
      AND attempt.invitation_id = audit_events.resource_id
      AND attempt.actor_id = audit_events.actor_id
      AND attempt.request_id = audit_events.request_id AND attempt.status = 'failed')
);
GRANT CREATE ON SCHEMA public TO platform_executor;
SET LOCAL ROLE platform_executor;
CREATE FUNCTION public.claim_invitation_delivery(p_attempt uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE candidate record; attempt record; invitation record; organization record; inviter_name text;
BEGIN
  SELECT id,organization_id INTO candidate FROM public.invitation_delivery_attempts
    WHERE status='pending' AND actor_id IS NOT NULL AND request_id IS NOT NULL
      AND (p_attempt IS NULL OR id=p_attempt)
    ORDER BY created_at,id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- 与取消/接受/重发共用组织锁，等待后重新检查原生邀请状态，再领取唯一投递意图。
  PERFORM organization_id FROM public.organization_status WHERE organization_id=candidate.organization_id FOR UPDATE;
  SELECT id,invitation_id,organization_id,actor_id,request_id,status INTO attempt FROM public.invitation_delivery_attempts
    WHERE id=candidate.id AND status='pending' FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT id,email,role,status,expires_at,organization_id,inviter_id INTO invitation
    FROM public.invitation WHERE id=attempt.invitation_id AND organization_id=attempt.organization_id;
  IF NOT FOUND OR invitation.status<>'pending' OR invitation.expires_at<=clock_timestamp() THEN
    UPDATE public.invitation_delivery_attempts SET status='failed',error_code='INVITATION_NOT_ACTIVE',completed_at=clock_timestamp()
      WHERE id=attempt.id;
    PERFORM set_config('app.organization_id',attempt.organization_id::text,true);
    INSERT INTO public.audit_events(organization_id,actor_id,event_code,resource_type,resource_id,request_id,tenant_visible,result,fields)
      VALUES(attempt.organization_id,attempt.actor_id,'invitation.delivery_failed','invitation',attempt.invitation_id,attempt.request_id,true,'failed',
        jsonb_build_object('status','failed','errorCode','INVITATION_NOT_ACTIVE'));
    RETURN NULL;
  END IF;
  SELECT id,name,default_locale INTO organization FROM public.organization WHERE id=attempt.organization_id;
  SELECT name INTO inviter_name FROM public."user" WHERE id=attempt.actor_id;
  IF organization.id IS NULL OR inviter_name IS NULL THEN RETURN NULL; END IF;
  -- SMTP 没有共同事务；发送前只领取一次，崩溃或结果未知都不允许后台自动重发。
  UPDATE public.invitation_delivery_attempts SET status='unknown',started_at=clock_timestamp() WHERE id=attempt.id;
  RETURN jsonb_build_object('id',invitation.id,'attemptId',attempt.id,'actorId',attempt.actor_id,'requestId',attempt.request_id,
    'email',invitation.email,'role',invitation.role,
    'organization',jsonb_build_object('id',organization.id,'name',organization.name,'defaultLocale',organization.default_locale),
    'invitation',jsonb_build_object('id',invitation.id),'inviter',jsonb_build_object('user',jsonb_build_object('name',inviter_name)));
END
$function$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.claim_invitation_delivery(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_invitation_delivery(uuid) TO app_runtime;
-- record_business_task_attempt 的既有结算状态/错误码不变；invitations.import 复用既有 IMPORT_VALIDATION_FAILED。
