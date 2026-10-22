ALTER TABLE public.platform_file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_file_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_file_versions_executor ON public.platform_file_versions TO platform_executor USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON public.platform_file_versions TO platform_executor;
DROP POLICY audit_events_platform_files_insert ON public.audit_events;
CREATE POLICY audit_events_platform_files_insert ON public.audit_events FOR INSERT TO platform_executor WITH CHECK(
 scope='platform' AND organization_id IS NULL AND NOT tenant_visible AND event_code IN('platform.file_workspace','platform.file_create_folder','platform.file_failed','platform.file_upload','platform.file_overwrite'));
GRANT CREATE ON SCHEMA public TO platform_executor;
--> statement-breakpoint
CREATE FUNCTION public.platform_file_permission(p_action text,p_kind text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
BEGIN
 RETURN CASE p_action WHEN 'create-folder' THEN 'platform.folder:create' WHEN 'upload' THEN 'platform.file:create'
 WHEN 'overwrite' THEN 'platform.file:update' WHEN 'rename' THEN 'platform.'||p_kind||':update' WHEN 'move' THEN 'platform.'||p_kind||':update'
 WHEN 'trash' THEN 'platform.'||p_kind||':delete' WHEN 'restore' THEN 'platform.file:restore' WHEN 'purge' THEN 'platform.file:purge' END;
END;
$f$;
CREATE FUNCTION public.platform_file_object(p_directory boolean,p_source_area text,p_source_path text[],p_target_area text,p_target_path text[],p_bytes bigint,p_sha text) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',gen_random_uuid(),'directory',p_directory,'sourceArea',p_source_area,'sourcePath',p_source_path,
 'targetArea',p_target_area,'targetPath',p_target_path,'expectedBytes',p_bytes,'expectedSha256',p_sha,
 'targetPrepared',false,'sourceDeleted',false,'sourceDeletionStarted',false,'sourceRestored',false,'targetDeleted',false);
$f$;
CREATE FUNCTION public.platform_file_version_projection(p_row public.platform_file_versions,p_current uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',p_row.id,'fileId',p_row.file_id,'bytes',p_row.bytes,'contentType',p_row.content_type,'sha256',p_row.sha256,
 'previewKind',CASE WHEN p_row.content_type IN ('image/png','image/jpeg','image/gif','image/webp','image/avif') THEN 'image'
 WHEN p_row.content_type='application/pdf' THEN 'pdf' WHEN p_row.content_type IN ('text/plain','text/csv') THEN 'text'
 WHEN p_row.content_type IN ('audio/mpeg','audio/wav','audio/ogg','audio/mp4') THEN 'audio'
 WHEN p_row.content_type IN ('video/mp4','video/webm','video/ogg') THEN 'video' ELSE 'none' END,
 'isCurrent',p_row.id=p_current,'createdAt',public.platform_file_time(p_row.created_at),'retiredAt',public.platform_file_time(p_row.retired_at),'expiresAt',public.platform_file_time(p_row.expires_at));
$f$;
CREATE OR REPLACE FUNCTION public.platform_file_entry_projection(p_row public.platform_file_entries) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',p_row.id,'kind',p_row.kind,'parentId',p_row.parent_id,'name',p_row.name,'path',p_row.path,
 'revision',p_row.revision,'state',p_row.state,'operationId',p_row.busy_operation_id,'deletedAt',public.platform_file_time(p_row.deleted_at),'expiresAt',public.platform_file_time(p_row.expires_at),
 'createdAt',public.platform_file_time(p_row.created_at),'updatedAt',public.platform_file_time(p_row.updated_at)) ||
 CASE WHEN p_row.kind='file' THEN jsonb_build_object('currentVersion',(SELECT public.platform_file_version_projection(v,p_row.current_version_id) FROM public.platform_file_versions v WHERE v.id=p_row.current_version_id)) ELSE '{}'::jsonb END;
$f$;
CREATE OR REPLACE FUNCTION public.platform_file_begin(p_actor uuid,p_session uuid,p_id uuid,p_action text,p_input jsonb,p_request text,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations; v_kind text:='file'; v_permission text;
BEGIN
 IF p_action IN ('rename','move','trash','restore','purge') THEN
  SELECT kind INTO v_kind FROM public.platform_file_entries WHERE id=(p_input->>'entryId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 END IF;
 v_permission:=public.platform_file_permission(p_action,v_kind);
 IF v_permission IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 PERFORM public.require_platform_action(p_actor,p_session,v_permission);
 PERFORM 1 FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id;
 IF FOUND THEN
  IF v_op.actor_id<>p_actor OR v_op.action<>p_action OR v_op.input<>p_input THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
  RETURN to_jsonb(v_op);
 END IF;
 -- 未完成的物理计划先由恢复器结算，不能让新操作占据待清理的命名空间。
 IF EXISTS(SELECT 1 FROM public.platform_file_operations WHERE phase NOT IN ('completed','failed')) THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 INSERT INTO public.platform_file_operations(id,actor_id,action,request_id,input,lease_id,lease_expires_at)
 VALUES(p_id,p_actor,p_action,p_request,p_input,p_lease,clock_timestamp()+interval '90 seconds') RETURNING * INTO v_op;
 RETURN to_jsonb(v_op);
END;
$f$;
CREATE FUNCTION public.platform_file_prepare_upload(p_actor uuid,p_session uuid,p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations; v_policy public.platform_file_policy; v_entry public.platform_file_entries;
 v_parent public.platform_file_entries; v_old public.platform_file_versions; v_entry_id uuid; v_version uuid:=gen_random_uuid();v_objects jsonb;v_path text[];v_bytes bigint;
BEGIN
 SELECT * INTO v_policy FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND actor_id=p_actor AND lease_id=p_lease AND lease_expires_at>clock_timestamp() AND phase='pending' FOR UPDATE;
 IF NOT FOUND OR v_op.action NOT IN ('upload','overwrite') THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 PERFORM public.require_platform_action(p_actor,p_session,public.platform_file_permission(v_op.action,'file'));
 v_bytes:=(v_op.input->>'declaredBytes')::bigint;
 IF v_bytes NOT BETWEEN 0 AND 104857600 OR v_op.input->>'contentSha256' !~ '^[0-9a-f]{64}$' OR coalesce(v_op.input->>'contentType','')='' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF v_policy.used_bytes+v_policy.reserved_bytes+v_bytes>v_policy.quota_bytes THEN RAISE EXCEPTION 'FILE_QUOTA_EXCEEDED'; END IF;
 IF v_op.action='upload' THEN
  SELECT * INTO v_parent FROM public.platform_file_entries WHERE id=(v_op.input->>'parentId')::uuid AND kind='folder' AND state='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_parent.busy_operation_id IS NOT NULL THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
  IF EXISTS(SELECT 1 FROM public.platform_file_entries WHERE parent_id=v_parent.id AND name=v_op.input->>'name' AND state='active') THEN RAISE EXCEPTION 'FILE_NAME_CONFLICT'; END IF;
  v_entry_id:=gen_random_uuid(); v_path:=v_parent.path||ARRAY[v_op.input->>'name'];
  v_objects:=jsonb_build_array(public.platform_file_object(false,NULL,NULL,'files',v_path,v_bytes,v_op.input->>'contentSha256'));
 ELSE
  SELECT * INTO v_entry FROM public.platform_file_entries WHERE id=(v_op.input->>'entryId')::uuid AND kind='file' AND state='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_entry.revision<>(v_op.input->>'expectedRevision')::int THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF v_entry.busy_operation_id IS NOT NULL THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
  SELECT * INTO STRICT v_old FROM public.platform_file_versions WHERE id=v_entry.current_version_id FOR UPDATE;
  v_entry_id:=v_entry.id;v_path:=v_entry.path;
  v_objects:=jsonb_build_array(public.platform_file_object(false,NULL,NULL,'staging',ARRAY[p_id::text],v_bytes,v_op.input->>'contentSha256'),
   public.platform_file_object(false,v_old.storage_area,v_old.storage_path,'history',ARRAY[v_old.id::text],v_old.bytes,v_old.sha256));
  UPDATE public.platform_file_entries SET busy_operation_id=p_id WHERE id=v_entry.id;
 END IF;
 IF octet_length(array_to_string(v_path,'/'))>512 THEN RAISE EXCEPTION 'FILE_PATH_TOO_LONG'; END IF;
 UPDATE public.platform_file_policy SET reserved_bytes=reserved_bytes+v_bytes WHERE id=1;
 UPDATE public.platform_file_operations SET phase='preparing',entry_id=v_entry_id,objects=v_objects,reserved_bytes=v_bytes,
  plans=jsonb_build_array(jsonb_build_object('versionId',v_version,'path',v_path,'oldVersionId',v_entry.current_version_id)),updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_op;
 RETURN to_jsonb(v_op);
END;
$f$;
CREATE FUNCTION public.platform_file_replace(p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations;v_archive jsonb;v_stage jsonb;
BEGIN
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND lease_id=p_lease AND lease_expires_at>clock_timestamp() AND phase='preparing' AND action='overwrite' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 v_stage:=v_op.objects->0;v_archive:=v_op.objects->1;
 IF NOT (v_stage->>'targetPrepared')::boolean OR NOT (v_archive->>'targetPrepared')::boolean THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 IF jsonb_array_length(v_op.objects)=2 THEN
  UPDATE public.platform_file_operations SET objects=jsonb_set(objects,'{1,sourceDeletionStarted}','true')||jsonb_build_array(
   public.platform_file_object(false,'staging',ARRAY[p_id::text],'files',ARRAY(SELECT jsonb_array_elements_text(v_op.plans->0->'path')),(v_stage->>'expectedBytes')::bigint,v_stage->>'expectedSha256')) WHERE id=p_id RETURNING * INTO v_op;
 END IF;
 RETURN to_jsonb(v_op);
END;
$f$;
CREATE OR REPLACE FUNCTION public.platform_file_object_fact(p_id uuid,p_lease uuid,p_object uuid,p_fact text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations;
BEGIN
 IF p_fact NOT IN ('targetPrepared','targetDeleted','sourceDeleted','sourceRestored') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 PERFORM 1 FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND lease_id=p_lease AND phase NOT IN ('completed','failed') FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_op.objects) o WHERE (o->>'id')::uuid=p_object) THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 UPDATE public.platform_file_operations SET objects=(SELECT jsonb_agg(CASE WHEN (o->>'id')::uuid=p_object THEN jsonb_set(o,ARRAY[p_fact],'true'::jsonb) ELSE o END ORDER BY ord)
 FROM jsonb_array_elements(v_op.objects) WITH ORDINALITY a(o,ord)),updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_op;
 UPDATE public.platform_file_policy SET transient_bytes=(SELECT coalesce(sum((o->>'expectedBytes')::bigint),0) FROM jsonb_array_elements(v_op.objects) o WHERE (o->>'targetPrepared')::boolean AND NOT (o->>'targetDeleted')::boolean AND NOT (o->>'directory')::boolean) WHERE id=1;
END;
$f$;
CREATE FUNCTION public.platform_file_commit_upload(p_actor uuid,p_session uuid,p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations;v_entry public.platform_file_entries;v_history integer;v_version uuid;
BEGIN
 SELECT history_days INTO v_history FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND actor_id=p_actor AND lease_id=p_lease AND phase='preparing' AND lease_expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR v_op.action NOT IN ('upload','overwrite') THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 PERFORM public.require_platform_action(p_actor,p_session,public.platform_file_permission(v_op.action,'file'));
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_op.objects) o WHERE NOT (o->>'targetPrepared')::boolean OR (o->>'targetDeleted')::boolean) THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 v_version:=(v_op.plans->0->>'versionId')::uuid;
 IF v_op.action='upload' THEN
  INSERT INTO public.platform_file_entries(id,parent_id,kind,name,path,current_version_id,busy_operation_id,created_by)
  VALUES(v_op.entry_id,(v_op.input->>'parentId')::uuid,'file',v_op.input->>'name',ARRAY(SELECT jsonb_array_elements_text(v_op.plans->0->'path')),v_version,p_id,p_actor) RETURNING * INTO v_entry;
 ELSE
  IF jsonb_array_length(v_op.objects)<>3 OR NOT (v_op.objects->1->>'sourceDeleted')::boolean THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
  UPDATE public.platform_file_versions SET storage_area='history',storage_path=ARRAY[id::text],retired_at=clock_timestamp(),expires_at=clock_timestamp()+make_interval(days=>v_history) WHERE id=(v_op.plans->0->>'oldVersionId')::uuid;
  UPDATE public.platform_file_entries SET current_version_id=v_version,revision=revision+1,updated_at=clock_timestamp() WHERE id=v_op.entry_id AND busy_operation_id=p_id RETURNING * INTO v_entry;
 END IF;
 INSERT INTO public.platform_file_versions(id,file_id,bytes,content_type,sha256,storage_area,storage_path)
 VALUES(v_version,v_entry.id,(v_op.input->>'declaredBytes')::bigint,v_op.input->>'contentType',v_op.input->>'contentSha256','files',v_entry.path);
 UPDATE public.platform_file_policy SET used_bytes=used_bytes+v_op.reserved_bytes,reserved_bytes=reserved_bytes-v_op.reserved_bytes WHERE id=1;
 UPDATE public.platform_file_operations SET phase='committed',reserved_bytes=0,committed_at=clock_timestamp(),updated_at=clock_timestamp(),result=jsonb_build_object('entryId',v_entry.id,'revision',v_entry.revision,'versionId',v_version) WHERE id=p_id RETURNING * INTO v_op;
 BEGIN
 INSERT INTO public.audit_events(scope,event_code,actor_id,resource_type,resource_id,result,request_id,operation_id,fields)
 VALUES('platform','platform.file_'||v_op.action,p_actor,'platform_file',v_entry.id,'succeeded',v_op.request_id,p_id::text,'{}');
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
 RETURN public.platform_file_receipt(v_op);
END;
$f$;
CREATE FUNCTION public.platform_file_settle(p_id uuid,p_lease uuid,p_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations;
BEGIN
 PERFORM 1 FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND lease_id=p_lease FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 IF v_op.phase IN ('completed','failed') THEN RETURN; END IF;
 IF v_op.committed_at IS NULL THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_op.objects) o WHERE (o->>'targetArea' IS NOT NULL AND NOT (o->>'targetDeleted')::boolean) OR ((o->>'sourceDeletionStarted')::boolean AND NOT (o->>'sourceRestored')::boolean)) THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
  UPDATE public.platform_file_operations SET phase='failed',error_code=p_code,reserved_bytes=0,updated_at=clock_timestamp() WHERE id=p_id;
  INSERT INTO public.audit_events(scope,event_code,actor_id,resource_type,resource_id,result,request_id,operation_id,fields)
  VALUES('platform','platform.file_failed',v_op.actor_id,'platform_file',v_op.entry_id,'failed',v_op.request_id,p_id::text,jsonb_build_object('code',p_code));
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_op.objects) o WHERE o->>'sourceArea' IS NOT NULL AND NOT (o->>'sourceDeleted')::boolean) THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
  UPDATE public.platform_file_operations SET phase='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_id;
 END IF;
 UPDATE public.platform_file_policy SET reserved_bytes=reserved_bytes-v_op.reserved_bytes,transient_bytes=0 WHERE id=1;
 UPDATE public.platform_file_entries SET busy_operation_id=NULL WHERE busy_operation_id=p_id;
END;
$f$;
CREATE FUNCTION public.platform_file_renew(p_id uuid,p_lease uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
BEGIN
 UPDATE public.platform_file_operations SET lease_expires_at=clock_timestamp()+interval '90 seconds' WHERE id=p_id AND lease_id=p_lease AND lease_expires_at>clock_timestamp() AND phase NOT IN ('completed','failed');
 IF NOT FOUND THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 RETURN 90000;
END;
$f$;
CREATE FUNCTION public.platform_file_claim(p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations;
BEGIN
 PERFORM 1 FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 SELECT * INTO v_op FROM public.platform_file_operations WHERE phase NOT IN ('completed','failed') AND lease_expires_at<=clock_timestamp() ORDER BY created_at LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.platform_file_operations SET lease_id=p_lease,lease_expires_at=clock_timestamp()+interval '90 seconds' WHERE id=v_op.id RETURNING * INTO v_op;
 RETURN to_jsonb(v_op);
END;
$f$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_file_read(p_actor uuid,p_session uuid,p_kind text,p_id uuid,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_row public.platform_file_entries; v_op public.platform_file_operations; v_items jsonb; v_total integer;
 v_version public.platform_file_versions;
 v_page integer:=coalesce((p_input->>'page')::int,1); v_size integer:=coalesce((p_input->>'pageSize')::int,20);
 v_parent uuid:=coalesce((p_input->>'parentId')::uuid,'00000000-0000-4000-8000-000000000002');
BEGIN
 IF p_kind='operation' THEN
  SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND actor_id=p_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM public.require_platform_action(p_actor,p_session,public.platform_file_permission(v_op.action,coalesce((SELECT kind FROM public.platform_file_entries WHERE id=v_op.entry_id),'file')));
  RETURN public.platform_file_receipt(v_op);
 END IF;
 PERFORM public.require_platform_action(p_actor,p_session,'platform.file:read');
 PERFORM public.require_platform_action(p_actor,p_session,'platform.folder:read');
 IF p_kind IN ('versions','content') THEN
  SELECT * INTO v_row FROM public.platform_file_entries WHERE id=p_id AND kind='file' AND state<>'purged' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_row.busy_operation_id IS NOT NULL THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
  IF p_kind='versions' THEN
   RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(public.platform_file_version_projection(v,v_row.current_version_id) ORDER BY v.created_at DESC),'[]') FROM public.platform_file_versions v WHERE file_id=p_id AND state='available'));
  END IF;
  SELECT * INTO v_version FROM public.platform_file_versions WHERE id=(p_input->>'versionId')::uuid AND file_id=p_id AND state='available' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN jsonb_build_object('entry',public.platform_file_entry_projection(v_row),'version',public.platform_file_version_projection(v_version,v_row.current_version_id),'area',v_version.storage_area,'path',v_version.storage_path);
 ELSIF p_kind IN ('get','breadcrumbs') THEN
  SELECT * INTO v_row FROM public.platform_file_entries WHERE id=p_id AND state<>'purged';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_kind='get' THEN RETURN public.platform_file_entry_projection(v_row); END IF;
  IF v_row.kind<>'folder' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  WITH RECURSIVE parents AS (
   SELECT e.* FROM public.platform_file_entries e WHERE e.id=p_id
   UNION ALL SELECT p.* FROM public.platform_file_entries p JOIN parents c ON c.parent_id=p.id
  ) SELECT jsonb_agg(public.platform_file_entry_projection(parents) ORDER BY cardinality(path)) INTO v_items FROM parents;
  RETURN jsonb_build_object('items',v_items);
 ELSIF p_kind='list' THEN
  IF v_page<1 OR v_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF coalesce(p_input->>'name','')='' AND NOT EXISTS(SELECT 1 FROM public.platform_file_entries WHERE id=v_parent AND kind='folder' AND state='active') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  WITH filtered AS MATERIALIZED (
   SELECT e.* FROM public.platform_file_entries e WHERE e.parent_id IS NOT NULL AND e.state=coalesce(p_input->>'state','active')
    AND CASE WHEN coalesce(p_input->>'name','')<>'' THEN strpos(lower(e.name),lower(p_input->>'name'))>0 WHEN p_input->>'state'='trashed' THEN e.trash_root_id=e.id ELSE e.parent_id=v_parent END
  ), page AS (
   SELECT f.* FROM filtered f ORDER BY
    CASE WHEN p_input->>'sortBy'='size' AND p_input->>'sortOrder'='desc' THEN (SELECT bytes FROM public.platform_file_versions WHERE id=f.current_version_id) END DESC,
    CASE WHEN p_input->>'sortBy'='size' AND p_input->>'sortOrder'='asc' THEN (SELECT bytes FROM public.platform_file_versions WHERE id=f.current_version_id) END ASC,
    CASE WHEN p_input->>'sortBy'='updatedAt' AND p_input->>'sortOrder'='desc' THEN f.updated_at END DESC,
    CASE WHEN p_input->>'sortBy'='updatedAt' AND p_input->>'sortOrder'<>'desc' THEN f.updated_at END ASC,
    CASE WHEN coalesce(p_input->>'sortBy','name')='name' AND p_input->>'sortOrder'='desc' THEN f.name END DESC,
    CASE WHEN coalesce(p_input->>'sortBy','name')='name' AND coalesce(p_input->>'sortOrder','asc')='asc' THEN f.name END ASC,f.id
    LIMIT v_size OFFSET (v_page-1)*v_size
  ) SELECT (SELECT count(*) FROM filtered),coalesce((SELECT jsonb_agg(public.platform_file_entry_projection(page)) FROM page),'[]'::jsonb) INTO v_total,v_items;
  RETURN jsonb_build_object('items',v_items,'total',v_total,'page',v_page,'pageSize',v_size);
 END IF;
 RAISE EXCEPTION 'VALIDATION_ERROR';
END;
$f$;

--> statement-breakpoint
ALTER FUNCTION public.platform_file_permission(text,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_permission(text,text) FROM PUBLIC;
ALTER FUNCTION public.platform_file_object(boolean,text,text[],text,text[],bigint,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_object(boolean,text,text[],text,text[],bigint,text) FROM PUBLIC;
ALTER FUNCTION public.platform_file_version_projection(public.platform_file_versions,uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_version_projection(public.platform_file_versions,uuid) FROM PUBLIC;
ALTER FUNCTION public.platform_file_prepare_upload(uuid,uuid,uuid,uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_prepare_upload(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_prepare_upload(uuid,uuid,uuid,uuid) TO app_runtime;
ALTER FUNCTION public.platform_file_replace(uuid,uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_replace(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_replace(uuid,uuid) TO app_runtime;
ALTER FUNCTION public.platform_file_commit_upload(uuid,uuid,uuid,uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_commit_upload(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_commit_upload(uuid,uuid,uuid,uuid) TO app_runtime;
ALTER FUNCTION public.platform_file_settle(uuid,uuid,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_settle(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_settle(uuid,uuid,text) TO app_runtime;
ALTER FUNCTION public.platform_file_renew(uuid,uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_renew(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_renew(uuid,uuid) TO app_runtime;
ALTER FUNCTION public.platform_file_claim(uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_claim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_claim(uuid) TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
