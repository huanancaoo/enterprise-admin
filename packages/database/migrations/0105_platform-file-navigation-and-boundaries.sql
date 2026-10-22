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
    WHEN 'files' THEN 'platform.file:read' WHEN 'tasks' THEN 'platform.task:read' WHEN 'monitor' THEN 'platform.monitor:read' WHEN 'schedules' THEN 'platform.schedule:read' END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_menu_registry()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $function$
  SELECT jsonb_build_object('pages',(SELECT jsonb_agg(jsonb_build_object('key',key,'path','/platform/'||key) ORDER BY ordinal)
    FROM unnest(ARRAY['organizations', 'users', 'employees', 'roles', 'menus', 'departments', 'posts', 'dictionaries', 'parameters', 'announcements', 'audit-events', 'login-events', 'sessions', 'settings', 'tasks','monitor','schedules','files']::text[]) WITH ORDINALITY AS pages(key,ordinal)),
    'actions',(SELECT jsonb_agg(jsonb_build_object('key',key) ORDER BY key) FROM unnest(public.platform_menu_actions()) AS actions(key)));
$function$;

--> statement-breakpoint
INSERT INTO public.platform_menu(id,key,name,sort,parent_id,kind,route_key,icon) VALUES('adca2fde-64eb-41cb-987c-6c6c692fcf03','sys-files','文件资源管理器',45,NULL,'page','files','Folder');

--> statement-breakpoint
CREATE POLICY audit_events_platform_files_select ON public.audit_events FOR SELECT TO platform_executor USING(scope='platform' AND organization_id IS NULL AND event_code IN('platform.file_workspace','platform.file_create_folder','platform.file_failed','platform.file_upload','platform.file_overwrite','platform.file_rename','platform.file_move','platform.file_trash','platform.file_restore','platform.file_purge','platform.file_policy'));

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
  IF v_row.state<>'active' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
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
  IF coalesce(p_input->>'name','')='' AND NOT (p_input->>'state'='trashed' AND p_input->>'parentId' IS NULL) THEN
   SELECT * INTO v_row FROM public.platform_file_entries WHERE id=v_parent AND kind='folder' AND state=coalesce(p_input->>'state','active');
   IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  WITH filtered AS MATERIALIZED (
   SELECT e.* FROM public.platform_file_entries e WHERE e.parent_id IS NOT NULL AND e.state=coalesce(p_input->>'state','active')
    AND CASE WHEN coalesce(p_input->>'name','')<>'' THEN strpos(lower(e.name),lower(p_input->>'name'))>0 WHEN p_input->>'state'='trashed' THEN CASE WHEN p_input->>'parentId' IS NULL THEN e.trash_root_id=e.id ELSE e.parent_id=v_parent AND e.trash_root_id=v_row.trash_root_id END ELSE e.parent_id=v_parent END
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
CREATE OR REPLACE FUNCTION public.platform_file_version_projection(p_row public.platform_file_versions,p_current uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',p_row.id,'fileId',p_row.file_id,'bytes',p_row.bytes,'contentType',p_row.content_type,'sha256',p_row.sha256,
 'previewKind',CASE WHEN p_row.content_type IN ('image/png','image/jpeg','image/gif','image/webp') THEN 'image'
 WHEN p_row.content_type='application/pdf' THEN 'pdf' WHEN p_row.content_type IN ('text/plain','application/json') THEN 'text'
 WHEN p_row.content_type LIKE 'audio/%' THEN 'audio'
 WHEN p_row.content_type LIKE 'video/%' THEN 'video' ELSE 'none' END,
 'isCurrent',p_row.id=p_current,'createdAt',public.platform_file_time(p_row.created_at),'retiredAt',public.platform_file_time(p_row.retired_at),'expiresAt',public.platform_file_time(p_row.expires_at));
$f$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_file_prepare_path(p_actor uuid,p_session uuid,p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations;v_entry public.platform_file_entries;v_parent public.platform_file_entries;v_item public.platform_file_entries;v_version public.platform_file_versions;
 v_ids uuid[];v_name text;v_path text[];v_source text[];v_target text[];v_area text;v_objects jsonb:='[]';v_plans jsonb:='[]';v_new_path text[];v_bytes bigint;
BEGIN
 PERFORM 1 FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND actor_id=p_actor AND lease_id=p_lease AND lease_expires_at>clock_timestamp() AND phase='pending' FOR UPDATE;
 IF NOT FOUND OR v_op.action NOT IN ('rename','move','trash','restore','purge') THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 SELECT * INTO v_entry FROM public.platform_file_entries WHERE id=(v_op.input->>'entryId')::uuid AND state<>'purged' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF v_entry.parent_id IS NULL THEN RAISE EXCEPTION 'FILE_ROOT_PROTECTED'; END IF;
 PERFORM public.require_platform_action(p_actor,p_session,public.platform_file_permission(v_op.action,v_entry.kind));
 IF v_entry.revision<>(v_op.input->>'expectedRevision')::int THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 IF (v_op.action IN ('rename','move','trash') AND v_entry.state<>'active') OR (v_op.action IN ('restore','purge') AND (v_entry.state<>'trashed' OR v_entry.trash_root_id<>v_entry.id)) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF v_op.action='restore' AND v_entry.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'FILE_RESTORE_EXPIRED'; END IF;
 SELECT array_agg(id) INTO v_ids FROM public.platform_file_subtree(v_entry.id);
 IF EXISTS(SELECT 1 FROM public.platform_file_entries WHERE id=ANY(v_ids) AND busy_operation_id IS NOT NULL) THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 IF v_op.action IN ('trash','purge') AND public.platform_file_reference_count(v_ids)>0 THEN RAISE EXCEPTION 'FILE_REFERENCED'; END IF;
 v_name:=coalesce(v_op.input->>'name',v_entry.name);
 IF octet_length(v_name)>(CASE WHEN v_entry.kind='folder' THEN 246 ELSE 255 END) THEN RAISE EXCEPTION 'FILE_NAME_TOO_LONG'; END IF;
 IF v_op.action IN ('rename','move','restore') THEN
  SELECT * INTO v_parent FROM public.platform_file_entries WHERE id=coalesce((v_op.input->>'parentId')::uuid,v_entry.parent_id) AND kind='folder' AND state='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_parent.id=ANY(v_ids) THEN RAISE EXCEPTION 'FILE_FOLDER_CYCLE'; END IF;
  IF v_parent.busy_operation_id IS NOT NULL THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
  IF EXISTS(SELECT 1 FROM public.platform_file_entries WHERE parent_id=v_parent.id AND name=v_name AND state='active' AND id<>v_entry.id) THEN RAISE EXCEPTION 'FILE_NAME_CONFLICT'; END IF;
  v_path:=v_parent.path||ARRAY[v_name];
 ELSE v_path:=v_entry.path;
 END IF;
 FOR v_item IN SELECT * FROM public.platform_file_entries WHERE id=ANY(v_ids) ORDER BY cardinality(path),id FOR UPDATE LOOP
  PERFORM public.require_platform_action(p_actor,p_session,public.platform_file_permission(v_op.action,v_item.kind));
  v_new_path:=v_path||v_item.path[cardinality(v_entry.path)+1:cardinality(v_item.path)];
  IF octet_length(array_to_string(v_new_path,'/'))>512 THEN RAISE EXCEPTION 'FILE_PATH_TOO_LONG'; END IF;
  v_source:=CASE WHEN v_entry.state='trashed' THEN ARRAY[v_entry.id::text]||v_item.path[cardinality(v_entry.path)+1:cardinality(v_item.path)] ELSE v_item.path END;
  v_area:=CASE WHEN v_op.action='trash' THEN 'trash' WHEN v_op.action='purge' THEN NULL ELSE 'files' END;
  v_target:=CASE WHEN v_op.action='trash' THEN ARRAY[v_entry.id::text]||v_item.path[cardinality(v_entry.path)+1:cardinality(v_item.path)] WHEN v_op.action='purge' THEN NULL ELSE v_new_path END;
  v_bytes:=0;
  IF v_item.kind='folder' THEN
   IF v_source IS DISTINCT FROM v_target OR v_entry.state='trashed' OR v_op.action='trash' THEN
    v_objects:=v_objects||jsonb_build_array(public.platform_file_object(true,CASE WHEN v_entry.state='trashed' THEN 'trash' ELSE 'files' END,v_source,v_area,v_target,0,NULL));
   END IF;
  ELSE
   FOR v_version IN SELECT * FROM public.platform_file_versions WHERE file_id=v_item.id AND state='available' AND (v_op.action='purge' OR id=v_item.current_version_id) FOR UPDATE LOOP
    IF v_version.storage_path IS DISTINCT FROM v_target OR v_version.storage_area IS DISTINCT FROM v_area THEN
     v_objects:=v_objects||jsonb_build_array(public.platform_file_object(false,v_version.storage_area,v_version.storage_path,v_area,v_target,v_version.bytes,v_version.sha256));
    END IF;
    IF v_op.action='purge' THEN v_bytes:=v_bytes+v_version.bytes; END IF;
   END LOOP;
  END IF;
  v_plans:=v_plans||jsonb_build_array(jsonb_build_object('id',v_item.id,'path',v_new_path,'parentId',CASE WHEN v_item.id=v_entry.id AND v_op.action IN ('rename','move','restore') THEN v_parent.id ELSE v_item.parent_id END,
   'name',CASE WHEN v_item.id=v_entry.id THEN v_name ELSE v_item.name END,'area',v_area,'storagePath',v_target,'purgedBytes',v_bytes));
 END LOOP;
 UPDATE public.platform_file_entries SET busy_operation_id=p_id WHERE id=ANY(v_ids);
 UPDATE public.platform_file_operations SET phase='preparing',entry_id=v_entry.id,objects=v_objects,plans=v_plans,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_op;
 RETURN to_jsonb(v_op);
END;
$f$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_file_begin(p_actor uuid,p_session uuid,p_id uuid,p_action text,p_input jsonb,p_request text,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations; v_kind text:='file'; v_permission text;
BEGIN
 IF p_action IN ('rename','move','trash','restore','purge') THEN
  SELECT kind INTO v_kind FROM public.platform_file_entries WHERE id=(p_input->>'entryId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 END IF;
 v_permission:=public.platform_file_permission(p_action,v_kind);
 IF p_action='overwrite' THEN PERFORM public.require_platform_action(p_actor,p_session,'platform.file:create'); END IF;
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

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_file_prepare_upload(p_actor uuid,p_session uuid,p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations; v_policy public.platform_file_policy; v_entry public.platform_file_entries;
 v_parent public.platform_file_entries; v_old public.platform_file_versions; v_entry_id uuid; v_version uuid:=gen_random_uuid();v_objects jsonb;v_path text[];v_bytes bigint;
BEGIN
 SELECT * INTO v_policy FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND actor_id=p_actor AND lease_id=p_lease AND lease_expires_at>clock_timestamp() AND phase='pending' FOR UPDATE;
 IF NOT FOUND OR v_op.action NOT IN ('upload','overwrite') THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 PERFORM public.require_platform_action(p_actor,p_session,public.platform_file_permission(v_op.action,'file'));
 IF v_op.action='overwrite' THEN PERFORM public.require_platform_action(p_actor,p_session,'platform.file:create'); END IF;
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

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_file_commit_upload(p_actor uuid,p_session uuid,p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations;v_entry public.platform_file_entries;v_history integer;v_version uuid;
BEGIN
 SELECT history_days INTO v_history FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND actor_id=p_actor AND lease_id=p_lease AND phase='preparing' AND lease_expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR v_op.action NOT IN ('upload','overwrite') THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 PERFORM public.require_platform_action(p_actor,p_session,public.platform_file_permission(v_op.action,'file'));
 IF v_op.action='overwrite' THEN PERFORM public.require_platform_action(p_actor,p_session,'platform.file:create'); END IF;
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

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_audit_event_codes(p_scope text)
RETURNS text[] LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $function$
  SELECT CASE p_scope
    WHEN 'platform' THEN ARRAY['platform.access_denied', 'platform.mfa_verified', 'platform.organizations_queried',
      'platform.organization_viewed', 'platform.users_queried', 'platform.user_viewed',
      'platform.user_sensitive_viewed', 'platform.organization_suspended', 'platform.organization_resumed',
      'platform.audit_queried', 'platform.audit_viewed', 'platform.settings_viewed', 'platform.settings_updated',
      'platform.storage_policy_viewed', 'platform.storage_policy_updated',
      'platform.employee_created','platform.user_password_login_unlocked','platform.user_created', 'platform.user_updated', 'platform.user_suspended', 'platform.user_resumed', 'platform.user_password_reset_requested', 'platform.session_revoked', 'platform.sessions_queried', 'platform.login_logs_queried'] || ARRAY['platform.announcement_list','platform.announcement_get','platform.announcement_create','platform.announcement_update','platform.announcement_publish','platform.announcement_withdraw','platform.announcement_delete','platform.announcement_readers','platform.announcement_export_page','platform.task_submitted','platform.task_completed','platform.task_failed','platform.resource_created','platform.resource_read'] || public.platform_system_audit_event_codes() || public.platform_schedule_audit_codes() || ARRAY['platform.file_workspace','platform.file_create_folder','platform.file_failed','platform.file_upload','platform.file_overwrite','platform.file_rename','platform.file_move','platform.file_trash','platform.file_restore','platform.file_purge','platform.file_policy']::text[]
    WHEN 'tenant' THEN ARRAY['member.invited', 'invitation.resent', 'invitation.accepted', 'invitation.rejected',
      'invitation.canceled', 'member.role_changed', 'member.removed', 'member.left',
      'role.created', 'role.updated', 'role.deleted', 'organization.settings_updated',
      'invitation.delivery_smtp_accepted', 'invitation.delivery_failed', 'invitation.delivery_unknown']
    ELSE ARRAY[]::text[]
  END;
$function$;

--> statement-breakpoint
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
 -- 上传正文计入预留容量；临时占用只统计覆盖暂存与路径复制形成的额外副本。
 UPDATE public.platform_file_policy SET transient_bytes=(
  SELECT coalesce(sum((o->>'expectedBytes')::bigint),0)
  FROM public.platform_file_operations op CROSS JOIN LATERAL jsonb_array_elements(op.objects) WITH ORDINALITY AS objects(o,ordinal)
  WHERE op.phase NOT IN ('completed','failed') AND op.action<>'upload' AND NOT(op.action='overwrite' AND ordinal=3)
   AND (o->>'targetPrepared')::boolean AND NOT (o->>'targetDeleted')::boolean AND NOT (o->>'directory')::boolean
   AND (NOT (o->>'sourceDeleted')::boolean OR (o->>'sourceRestored')::boolean)
 ) WHERE id=1;
END;
$f$;
