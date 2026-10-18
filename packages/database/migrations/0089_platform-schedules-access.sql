CREATE OR REPLACE FUNCTION public.platform_permission_catalog() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $function$ SELECT ARRAY['platform.authorization:manage','platform.organization:read','platform.organization:update','platform.organization:export','platform.user:read','platform.user:create','platform.user:update','platform.user:suspend','platform.user:resetPassword','platform.user:readSensitive','platform.user:unlock','platform.user:export','platform.audit:read','platform.audit:export','platform.settings:read','platform.settings:update','platform.login:read','platform.login:export','platform.session:read','platform.session:revoke','platform.session:export','platform.employee:read','platform.employee:create','platform.employee:update','platform.employee:delete','platform.employee:export','platform.role:read','platform.role:create','platform.role:update','platform.role:delete','platform.role:export','platform.menu:read','platform.menu:create','platform.menu:update','platform.menu:delete','platform.menu:export','platform.department:read','platform.department:create','platform.department:update','platform.department:delete','platform.department:export','platform.post:read','platform.post:create','platform.post:update','platform.post:delete','platform.post:export','platform.dictionary:read','platform.dictionary:create','platform.dictionary:update','platform.dictionary:delete','platform.dictionary:export','platform.dictionary:refresh','platform.parameter:read','platform.parameter:create','platform.parameter:update','platform.parameter:delete','platform.parameter:export','platform.parameter:refresh','platform.announcement:read','platform.announcement:create','platform.announcement:update','platform.announcement:delete','platform.announcement:publish','platform.announcement:readers','platform.task:read','platform.task:download','platform.monitor:read','platform.schedule:read','platform.schedule:manage','platform.schedule:run']::text[]; $function$;

--> statement-breakpoint
ALTER TABLE public.platform_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_schedule_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_schedule_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_schedules,public.platform_schedule_runs FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.platform_schedules TO platform_executor;
GRANT SELECT,INSERT,UPDATE ON public.platform_schedule_runs TO platform_executor;
CREATE POLICY platform_schedules_executor ON public.platform_schedules TO platform_executor USING(true) WITH CHECK(true);
CREATE POLICY platform_schedule_runs_executor ON public.platform_schedule_runs TO platform_executor USING(true) WITH CHECK(true);
GRANT CREATE ON SCHEMA public TO platform_executor;
--> statement-breakpoint
CREATE FUNCTION public.platform_schedule_audit_codes() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT ARRAY['platform.schedule_created','platform.schedule_updated','platform.schedule_deleted','platform.schedule_run_started','platform.schedule_run_succeeded','platform.schedule_run_failed','platform.schedule_run_rejected']::text[];
$fn$;
CREATE POLICY audit_events_platform_schedule_insert ON public.audit_events FOR INSERT TO platform_executor
 WITH CHECK(scope='platform' AND organization_id IS NULL AND NOT tenant_visible AND fields='{}'::jsonb AND event_code=ANY(public.platform_schedule_audit_codes()));
CREATE POLICY audit_events_platform_schedule_select ON public.audit_events FOR SELECT TO platform_executor
 USING(scope='platform' AND organization_id IS NULL AND event_code=ANY(public.platform_schedule_audit_codes()));
ALTER FUNCTION public.platform_schedule_audit_codes() OWNER TO platform_executor;
SET LOCAL ROLE platform_executor;
CREATE FUNCTION public.append_platform_schedule_audit(p_actor uuid,p_id uuid,p_event text,p_request text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $fn$
BEGIN
 IF NOT p_event=ANY(public.platform_schedule_audit_codes()) OR p_actor IS NULL OR p_request IS NULL OR length(btrim(p_request))=0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 BEGIN
  INSERT INTO public.audit_events(scope,event_code,actor_id,resource_type,resource_id,result,request_id,fields,tenant_visible,occurred_at)
  VALUES('platform',p_event,p_actor,'schedule',p_id,CASE WHEN p_event='platform.schedule_run_rejected' THEN 'denied' WHEN p_event='platform.schedule_run_failed' THEN 'failed' ELSE 'succeeded' END,p_request,'{}'::jsonb,false,clock_timestamp());
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
END; $fn$;
CREATE FUNCTION public.platform_schedule_projection(p_row public.platform_schedules)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $fn$
 SELECT jsonb_build_object('id',p_row.id,'name',p_row.name,'type',p_row.task_type,'cron',p_row.cron,'timeZone',p_row.time_zone,'status',p_row.status,'createdBy',p_row.created_by,'version',p_row.version,'nextRunAt',p_row.next_run_at,'lastRunAt',p_row.last_run_at,'createdAt',p_row.created_at,'updatedAt',p_row.updated_at);
$fn$;
CREATE FUNCTION public.platform_schedule_run_projection(p_row public.platform_schedule_runs)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $fn$
 SELECT jsonb_build_object('id',p_row.id,'scheduleId',p_row.schedule_id,'scheduleName',p_row.schedule_name,'taskType',p_row.task_type,'trigger',p_row.trigger,'status',p_row.status,'scheduledAt',p_row.scheduled_at,'startedAt',p_row.started_at,'finishedAt',p_row.finished_at,'durationMs',CASE WHEN p_row.finished_at IS NULL THEN NULL ELSE greatest(0,floor(extract(epoch FROM p_row.finished_at-p_row.started_at)*1000)) END,'requestedBy',p_row.requested_by,'errorCode',p_row.error_code,'result',p_row.result);
$fn$;
-- 自动任务属于创建者的长期授权，不绑定已经过期的浏览器 Session。
CREATE FUNCTION public.platform_schedule_owner_denial(p_actor uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $fn$
DECLARE v_permissions text[];
BEGIN
 PERFORM public.lock_platform_authorization();
 BEGIN PERFORM public.require_active_account(p_actor);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM IN ('ACCOUNT_SUSPENDED','AUTHORIZATION_UNAVAILABLE') THEN RETURN SQLERRM; END IF;
  RAISE;
 END;
 IF NOT EXISTS(SELECT 1 FROM public.platform_assignment WHERE user_id=p_actor AND status='active') THEN RETURN 'ASSIGNMENT_INACTIVE'; END IF;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.platform_assignment_role ar JOIN public.platform_role r ON r.id=ar.role_id WHERE ar.user_id=p_actor AND r.status='active' AND r.built_in AND r.key='platform_admin') THEN public.platform_permission_catalog()
 ELSE ARRAY(SELECT DISTINCT unnest(r.permissions) FROM public.platform_assignment_role ar JOIN public.platform_role r ON r.id=ar.role_id WHERE ar.user_id=p_actor AND r.status='active') END INTO v_permissions;
 IF NOT ARRAY['platform.schedule:run','platform.monitor:read']::text[] <@ v_permissions THEN RETURN 'FORBIDDEN'; END IF;
 RETURN NULL;
END; $fn$;
--> statement-breakpoint
CREATE FUNCTION public.platform_schedule_command(p_actor uuid,p_session uuid,p_operation text,p_id uuid,p_input jsonb,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $fn$
DECLARE v_row public.platform_schedules; v_result jsonb; v_page integer:=coalesce((p_input->>'page')::integer,1); v_size integer:=coalesce((p_input->>'pageSize')::integer,20);
 v_sort text:=coalesce(p_input->>'sortBy','createdAt'); v_order text:=coalesce(p_input->>'sortOrder','desc');
BEGIN
 PERFORM public.lock_platform_authorization();
 IF p_operation NOT IN ('list','get','create','update','delete','runs','types') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 PERFORM public.require_platform_action(p_actor,p_session,CASE WHEN p_operation IN ('list','get','runs','types') THEN 'platform.schedule:read' ELSE 'platform.schedule:manage' END);
 IF v_page<1 OR v_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF p_operation='types' THEN RETURN 'null'::jsonb; END IF;
 IF p_operation='list' THEN
  IF v_sort NOT IN ('createdAt','name','nextRunAt') OR v_order NOT IN ('asc','desc') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  WITH filtered AS MATERIALIZED(SELECT s.* FROM public.platform_schedules s WHERE (p_input->>'status' IS NULL OR s.status=p_input->>'status') AND (p_input->>'q' IS NULL OR position(lower(p_input->>'q') IN lower(s.name))>0)), paged AS(
   SELECT * FROM filtered ORDER BY
    CASE WHEN v_sort='name' AND v_order='asc' THEN name END ASC,
    CASE WHEN v_sort='name' AND v_order='desc' THEN name END DESC,
    CASE WHEN v_sort='createdAt' AND v_order='asc' THEN created_at END ASC,
    CASE WHEN v_sort='createdAt' AND v_order='desc' THEN created_at END DESC,
    CASE WHEN v_sort='nextRunAt' AND v_order='asc' THEN next_run_at END ASC NULLS LAST,
    CASE WHEN v_sort='nextRunAt' AND v_order='desc' THEN next_run_at END DESC NULLS LAST,id
   LIMIT v_size OFFSET (v_page::bigint-1)*v_size)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(public.platform_schedule_projection(paged::public.platform_schedules)) FROM paged),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'page',v_page,'pageSize',v_size) INTO v_result;
  RETURN v_result;
 END IF;
 IF p_operation='runs' THEN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.monitor:read');
  WITH filtered AS MATERIALIZED(SELECT r.* FROM public.platform_schedule_runs r WHERE r.schedule_id=p_id AND (p_input->>'status' IS NULL OR r.status=p_input->>'status')), paged AS(SELECT * FROM filtered ORDER BY started_at DESC,id DESC LIMIT v_size OFFSET (v_page::bigint-1)*v_size)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(public.platform_schedule_run_projection(paged::public.platform_schedule_runs) ORDER BY started_at DESC,id DESC) FROM paged),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'page',v_page,'pageSize',v_size) INTO v_result;
  RETURN v_result;
 END IF;
 IF p_operation='create' THEN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.monitor:read');
  IF p_input->>'type'<>'platform.health-check' OR length(btrim(p_input->>'name')) NOT BETWEEN 1 AND 100 OR p_input->>'status' NOT IN ('enabled','disabled') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  INSERT INTO public.platform_schedules(name,task_type,cron,time_zone,status,created_by,next_run_at)
  VALUES(p_input->>'name',p_input->>'type',p_input->>'cron',p_input->>'timeZone',p_input->>'status',p_actor,(p_input->>'nextRunAt')::timestamptz) RETURNING * INTO v_row;
  PERFORM public.append_platform_schedule_audit(p_actor,v_row.id,'platform.schedule_created',p_request);
  RETURN public.platform_schedule_projection(v_row);
 END IF;
 SELECT * INTO v_row FROM public.platform_schedules WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF p_operation='get' THEN RETURN public.platform_schedule_projection(v_row); END IF;
 IF p_operation='delete' THEN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('platform.schedule:'||p_id::text,0)) THEN RAISE EXCEPTION 'RESOURCE_IN_USE'; END IF;
  DELETE FROM public.platform_schedules WHERE id=p_id;
  PERFORM public.append_platform_schedule_audit(p_actor,p_id,'platform.schedule_deleted',p_request);
  RETURN jsonb_build_object('deleted',true);
 END IF;
 PERFORM public.require_platform_action(p_actor,p_session,'platform.monitor:read');
 IF v_row.version IS DISTINCT FROM (p_input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 IF p_input->>'type'<>'platform.health-check' OR p_input->>'status' NOT IN ('enabled','disabled') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 UPDATE public.platform_schedules SET name=p_input->>'name',task_type=p_input->>'type',cron=p_input->>'cron',time_zone=p_input->>'timeZone',status=p_input->>'status',next_run_at=(p_input->>'nextRunAt')::timestamptz,version=version+1,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_row;
 PERFORM public.append_platform_schedule_audit(p_actor,p_id,'platform.schedule_updated',p_request);
 RETURN public.platform_schedule_projection(v_row);
END; $fn$;
--> statement-breakpoint
CREATE FUNCTION public.platform_schedule_runtime(p_operation text,p_id uuid,p_input jsonb,p_actor uuid,p_session uuid,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $fn$
DECLARE v_row public.platform_schedules; v_run public.platform_schedule_runs; v_denial text; v_manual boolean:=p_input->>'trigger'='manual'; v_result jsonb; v_old public.platform_schedule_runs;
BEGIN
 IF p_operation='recover' THEN
  FOR v_old IN SELECT * FROM public.platform_schedule_runs WHERE status='running' ORDER BY schedule_id LOOP
   IF pg_try_advisory_xact_lock(hashtextextended('platform.schedule:'||v_old.schedule_id::text,0)) THEN
    UPDATE public.platform_schedule_runs SET status='failed',finished_at=clock_timestamp(),error_code='INTERRUPTED' WHERE id=v_old.id AND status='running';
    IF FOUND THEN PERFORM public.append_platform_schedule_audit(coalesce(v_old.requested_by,v_old.owner_id),v_old.schedule_id,'platform.schedule_run_failed',p_request); END IF;
   END IF;
  END LOOP;
  RETURN 'null'::jsonb;
 END IF;
 IF p_operation='due' THEN
  SELECT coalesce(jsonb_agg(public.platform_schedule_projection(s::public.platform_schedules)),'[]'::jsonb) INTO v_result FROM (SELECT * FROM public.platform_schedules WHERE status='enabled' AND next_run_at<=clock_timestamp() ORDER BY next_run_at,id LIMIT 100) s;
  RETURN v_result;
 END IF;
 IF p_operation='reset' THEN
  -- 只有调度领导者启动时重置过期时间；停机期间不产生补偿运行。
  UPDATE public.platform_schedules SET next_run_at=(p_input->>'nextRunAt')::timestamptz WHERE id=p_id AND status='enabled' AND next_run_at=(p_input->>'expectedNextRunAt')::timestamptz;
  RETURN 'null'::jsonb;
 END IF;
 IF p_operation='finish' THEN
  IF p_input->>'status' NOT IN ('succeeded','failed') OR (p_input->>'status'='failed' AND p_input->>'errorCode'<>'EXECUTION_FAILED') OR (p_input->>'status'='succeeded' AND jsonb_typeof(p_input->'result') IS DISTINCT FROM 'object') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  UPDATE public.platform_schedule_runs SET status=p_input->>'status',finished_at=clock_timestamp(),error_code=p_input->>'errorCode',result=CASE WHEN p_input->>'status'='succeeded' THEN p_input->'result' END
  WHERE id=(p_input->>'runId')::uuid AND schedule_id=p_id AND status='running' RETURNING * INTO v_run;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM public.append_platform_schedule_audit(coalesce(v_run.requested_by,v_run.owner_id),p_id,'platform.schedule_run_'||v_run.status,p_request);
  RETURN public.platform_schedule_run_projection(v_run);
 END IF;
 IF p_operation<>'claim' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 PERFORM public.lock_platform_authorization();
 IF p_input->>'trigger' IS NULL OR p_input->>'trigger' NOT IN ('manual','automatic') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF v_manual THEN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.schedule:run');
  PERFORM public.require_platform_action(p_actor,p_session,'platform.monitor:read');
 END IF;
 -- 同一连接在整个真实检查期间持有会话锁；此处也验证没有另一连接执行此计划。
 IF NOT pg_try_advisory_xact_lock(hashtextextended('platform.schedule:'||p_id::text,0)) THEN
  IF v_manual THEN RAISE EXCEPTION 'RESOURCE_IN_USE'; ELSE RETURN 'null'::jsonb; END IF;
 END IF;
 SELECT * INTO v_row FROM public.platform_schedules WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN IF v_manual THEN RAISE EXCEPTION 'NOT_FOUND'; ELSE RETURN 'null'::jsonb; END IF; END IF;
 IF NOT v_manual AND (v_row.status<>'enabled' OR v_row.next_run_at IS DISTINCT FROM (p_input->>'expectedNextRunAt')::timestamptz) THEN RETURN 'null'::jsonb; END IF;
 -- 会话锁已释放才可能留下running行，说明上个进程未能结算；不能将它伪装为成功。
 FOR v_old IN UPDATE public.platform_schedule_runs SET status='failed',finished_at=clock_timestamp(),error_code='INTERRUPTED' WHERE schedule_id=p_id AND status='running' RETURNING * LOOP
  PERFORM public.append_platform_schedule_audit(coalesce(v_old.requested_by,v_old.owner_id),p_id,'platform.schedule_run_failed',p_request);
 END LOOP;
 v_denial:=public.platform_schedule_owner_denial(v_row.created_by);
 INSERT INTO public.platform_schedule_runs(schedule_id,schedule_name,task_type,owner_id,requested_by,trigger,status,scheduled_at,finished_at,error_code)
 VALUES(p_id,v_row.name,v_row.task_type,v_row.created_by,CASE WHEN v_manual THEN p_actor END,CASE WHEN v_manual THEN 'manual' ELSE 'automatic' END,CASE WHEN v_denial IS NULL THEN 'running' ELSE 'rejected' END,CASE WHEN NOT v_manual THEN v_row.next_run_at END,CASE WHEN v_denial IS NOT NULL THEN clock_timestamp() END,v_denial) RETURNING * INTO v_run;
 UPDATE public.platform_schedules SET last_run_at=v_run.started_at,next_run_at=CASE WHEN NOT v_manual THEN (p_input->>'nextRunAt')::timestamptz ELSE next_run_at END WHERE id=p_id;
 PERFORM public.append_platform_schedule_audit(coalesce(p_actor,v_row.created_by),p_id,CASE WHEN v_denial IS NULL THEN 'platform.schedule_run_started' ELSE 'platform.schedule_run_rejected' END,p_request);
 RETURN public.platform_schedule_run_projection(v_run);
END; $fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.platform_schedule_audit_codes(),public.append_platform_schedule_audit(uuid,uuid,text,text),public.platform_schedule_projection(public.platform_schedules),public.platform_schedule_run_projection(public.platform_schedule_runs),public.platform_schedule_owner_denial(uuid),public.platform_schedule_command(uuid,uuid,text,uuid,jsonb,text),public.platform_schedule_runtime(text,uuid,jsonb,uuid,uuid,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.platform_schedule_command(uuid,uuid,text,uuid,jsonb,text),public.platform_schedule_runtime(text,uuid,jsonb,uuid,uuid,text) TO app_runtime;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM platform_executor;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_audit_event_codes(p_scope text)
RETURNS text[] LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $function$
  SELECT CASE p_scope
    WHEN 'platform' THEN ARRAY['platform.access_denied', 'platform.mfa_verified', 'platform.organizations_queried',
      'platform.organization_viewed', 'platform.users_queried', 'platform.user_viewed',
      'platform.user_sensitive_viewed', 'platform.organization_suspended', 'platform.organization_resumed',
      'platform.audit_queried', 'platform.audit_viewed', 'platform.settings_viewed', 'platform.settings_updated',
      'platform.storage_policy_viewed', 'platform.storage_policy_updated',
      'platform.employee_created','platform.user_password_login_unlocked','platform.user_created', 'platform.user_updated', 'platform.user_suspended', 'platform.user_resumed', 'platform.user_password_reset_requested', 'platform.session_revoked', 'platform.sessions_queried', 'platform.login_logs_queried'] || ARRAY['platform.announcement_list','platform.announcement_get','platform.announcement_create','platform.announcement_update','platform.announcement_publish','platform.announcement_withdraw','platform.announcement_delete','platform.announcement_readers','platform.announcement_export_page','platform.task_submitted','platform.task_completed','platform.task_failed','platform.resource_created','platform.resource_read'] || public.platform_system_audit_event_codes() || public.platform_schedule_audit_codes()
    WHEN 'tenant' THEN ARRAY['member.invited', 'invitation.resent', 'invitation.accepted', 'invitation.rejected',
      'invitation.canceled', 'member.role_changed', 'member.removed', 'member.left',
      'role.created', 'role.updated', 'role.deleted', 'organization.settings_updated',
      'invitation.delivery_smtp_accepted', 'invitation.delivery_failed', 'invitation.delivery_unknown']
    ELSE ARRAY[]::text[]
  END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_menu_registry()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $function$
  SELECT jsonb_build_object('pages',(SELECT jsonb_agg(jsonb_build_object('key',key,'path','/platform/'||key) ORDER BY ordinal)
    FROM unnest(ARRAY['organizations', 'users', 'employees', 'roles', 'menus', 'departments', 'posts', 'dictionaries', 'parameters', 'announcements', 'audit-events', 'login-events', 'sessions', 'settings', 'tasks','monitor','schedules']::text[]) WITH ORDINALITY AS pages(key,ordinal)),
    'actions',(SELECT jsonb_agg(jsonb_build_object('key',key) ORDER BY key) FROM unnest(public.platform_menu_actions()) AS actions(key)));
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_menu_route_permission(p_key text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $function$
  SELECT CASE p_key
    WHEN 'organizations' THEN 'platform.organization:read' WHEN 'users' THEN 'platform.user:read'
    WHEN 'employees' THEN 'platform.employee:read' WHEN 'roles' THEN 'platform.role:read'
    WHEN 'menus' THEN 'platform.menu:read' WHEN 'departments' THEN 'platform.department:read'
    WHEN 'posts' THEN 'platform.post:read' WHEN 'dictionaries' THEN 'platform.dictionary:read'
    WHEN 'parameters' THEN 'platform.parameter:read' WHEN 'announcements' THEN 'platform.announcement:read'
    WHEN 'audit-events' THEN 'platform.audit:read' WHEN 'login-events' THEN 'platform.login:read'
    WHEN 'sessions' THEN 'platform.session:read' WHEN 'settings' THEN 'platform.settings:read'
    WHEN 'tasks' THEN 'platform.task:read' WHEN 'monitor' THEN 'platform.monitor:read' WHEN 'schedules' THEN 'platform.schedule:read' END;
$function$;

--> statement-breakpoint
INSERT INTO public.platform_menu(id,key,name,sort,parent_id,kind,route_key,icon)
VALUES('f477a279-ff18-4f11-b6a0-b50bb2d2a810','sys-schedules','定时任务',40,'297ac970-abb4-50e8-aed1-d432d9e1302c','page','schedules','Clock');
