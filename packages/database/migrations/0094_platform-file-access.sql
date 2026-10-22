CREATE OR REPLACE FUNCTION public.platform_permission_catalog() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $function$ SELECT ARRAY['platform.authorization:manage','platform.organization:read','platform.organization:update','platform.organization:export','platform.user:read','platform.user:create','platform.user:update','platform.user:suspend','platform.user:resetPassword','platform.user:readSensitive','platform.user:unlock','platform.user:export','platform.audit:read','platform.audit:export','platform.settings:read','platform.settings:update','platform.login:read','platform.login:export','platform.session:read','platform.session:revoke','platform.session:export','platform.employee:read','platform.employee:create','platform.employee:update','platform.employee:delete','platform.employee:export','platform.role:read','platform.role:create','platform.role:update','platform.role:delete','platform.role:export','platform.menu:read','platform.menu:create','platform.menu:update','platform.menu:delete','platform.menu:export','platform.department:read','platform.department:create','platform.department:update','platform.department:delete','platform.department:export','platform.post:read','platform.post:create','platform.post:update','platform.post:delete','platform.post:export','platform.dictionary:read','platform.dictionary:create','platform.dictionary:update','platform.dictionary:delete','platform.dictionary:export','platform.dictionary:refresh','platform.parameter:read','platform.parameter:create','platform.parameter:update','platform.parameter:delete','platform.parameter:export','platform.parameter:refresh','platform.announcement:read','platform.announcement:create','platform.announcement:update','platform.announcement:delete','platform.announcement:publish','platform.announcement:readers','platform.task:read','platform.task:download','platform.monitor:read','platform.schedule:read','platform.schedule:manage','platform.schedule:run','platform.file:read','platform.file:create','platform.file:update','platform.file:delete','platform.file:restore','platform.file:purge','platform.folder:read','platform.folder:create','platform.folder:update','platform.folder:delete']::text[]; $function$;
--> statement-breakpoint
INSERT INTO public.platform_file_policy(id) VALUES(1);
INSERT INTO public.platform_file_entries(id,kind,name,path)
 VALUES('00000000-0000-4000-8000-000000000002','folder','',ARRAY[]::text[]);
ALTER TABLE public.platform_file_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_file_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_file_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_file_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_file_policy_executor ON public.platform_file_policy TO platform_executor USING(true) WITH CHECK(true);
CREATE POLICY platform_file_entries_executor ON public.platform_file_entries TO platform_executor USING(true) WITH CHECK(true);
GRANT SELECT,UPDATE ON public.platform_file_policy TO platform_executor;
GRANT SELECT,INSERT,UPDATE ON public.platform_file_entries TO platform_executor;
CREATE POLICY audit_events_platform_files_insert ON public.audit_events FOR INSERT TO platform_executor WITH CHECK(
 scope='platform' AND organization_id IS NULL AND NOT tenant_visible AND event_code IN('platform.file_workspace'));
GRANT CREATE ON SCHEMA public TO platform_executor;
--> statement-breakpoint
CREATE FUNCTION public.platform_file_workspace(p_actor uuid,p_session uuid,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_root public.platform_file_entries; v_policy public.platform_file_policy;
BEGIN
 PERFORM public.require_platform_action(p_actor,p_session,'platform.file:read');
 PERFORM public.require_platform_action(p_actor,p_session,'platform.folder:read');
 SELECT * INTO STRICT v_root FROM public.platform_file_entries WHERE parent_id IS NULL;
 SELECT * INTO STRICT v_policy FROM public.platform_file_policy WHERE id=1;
 BEGIN
  INSERT INTO public.audit_events(scope,event_code,actor_id,resource_type,resource_id,result,request_id,fields)
   VALUES('platform','platform.file_workspace',p_actor,'platform_file',v_root.id,'succeeded',p_request,'{}'::jsonb);
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
 RETURN jsonb_build_object(
  'root',jsonb_build_object('id',v_root.id,'kind','folder','parentId',NULL,'name','','path',v_root.path,
   'revision',v_root.revision,'state','active','operationId',NULL,'deletedAt',NULL,'expiresAt',NULL,
   'createdAt',to_char(v_root.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'updatedAt',to_char(v_root.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  'usage',jsonb_build_object('quotaBytes',v_policy.quota_bytes,'usedBytes',v_policy.used_bytes,
   'reservedBytes',v_policy.reserved_bytes,'transientBytes',v_policy.transient_bytes,
   'trashDays',v_policy.trash_days,'historyDays',v_policy.history_days,
   'policyRevision',v_policy.revision,'maxUploadBytes',104857600));
END;
$f$;
ALTER FUNCTION public.platform_file_workspace(uuid,uuid,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_workspace(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_workspace(uuid,uuid,text) TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
