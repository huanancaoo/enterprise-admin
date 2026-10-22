ALTER TABLE public.platform_file_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_file_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_file_operations_executor ON public.platform_file_operations TO platform_executor USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON public.platform_file_operations TO platform_executor;
DROP POLICY audit_events_platform_files_insert ON public.audit_events;
CREATE POLICY audit_events_platform_files_insert ON public.audit_events FOR INSERT TO platform_executor WITH CHECK(
 scope='platform' AND organization_id IS NULL AND NOT tenant_visible AND event_code IN('platform.file_workspace','platform.file_create_folder','platform.file_failed'));
GRANT CREATE ON SCHEMA public TO platform_executor;
--> statement-breakpoint
CREATE FUNCTION public.platform_file_time(p_time timestamptz) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT to_char(p_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$f$;
CREATE FUNCTION public.platform_file_entry_projection(p_row public.platform_file_entries) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',p_row.id,'kind',p_row.kind,'parentId',p_row.parent_id,'name',p_row.name,'path',p_row.path,
  'revision',p_row.revision,'state',p_row.state,'operationId',p_row.busy_operation_id,
  'deletedAt',public.platform_file_time(p_row.deleted_at),'expiresAt',public.platform_file_time(p_row.expires_at),
  'createdAt',public.platform_file_time(p_row.created_at),'updatedAt',public.platform_file_time(p_row.updated_at));
$f$;
CREATE FUNCTION public.platform_file_receipt(p_row public.platform_file_operations) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',p_row.id,'action',p_row.action,'phase',p_row.phase,'result',p_row.result,'errorCode',p_row.error_code,
  'committedAt',public.platform_file_time(p_row.committed_at),'completedAt',public.platform_file_time(p_row.completed_at),
  'createdAt',public.platform_file_time(p_row.created_at),'updatedAt',public.platform_file_time(p_row.updated_at));
$f$;
CREATE FUNCTION public.platform_file_read(p_actor uuid,p_session uuid,p_kind text,p_id uuid,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_row public.platform_file_entries; v_op public.platform_file_operations; v_items jsonb; v_total integer;
 v_page integer:=coalesce((p_input->>'page')::int,1); v_size integer:=coalesce((p_input->>'pageSize')::int,20);
 v_parent uuid:=coalesce((p_input->>'parentId')::uuid,'00000000-0000-4000-8000-000000000002');
BEGIN
 IF p_kind='operation' THEN
  SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND actor_id=p_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM public.require_platform_action(p_actor,p_session,'platform.folder:create');
  RETURN public.platform_file_receipt(v_op);
 END IF;
 PERFORM public.require_platform_action(p_actor,p_session,'platform.file:read');
 PERFORM public.require_platform_action(p_actor,p_session,'platform.folder:read');
 IF p_kind IN ('get','breadcrumbs') THEN
  SELECT * INTO v_row FROM public.platform_file_entries WHERE id=p_id AND state='active';
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
    AND CASE WHEN coalesce(p_input->>'name','')<>'' THEN strpos(lower(e.name),lower(p_input->>'name'))>0 ELSE e.parent_id=v_parent END
  ), page AS (
   SELECT f.* FROM filtered f ORDER BY
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
CREATE FUNCTION public.platform_file_begin(p_actor uuid,p_session uuid,p_id uuid,p_action text,p_input jsonb,p_request text,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations;
BEGIN
 IF p_action<>'create-folder' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 PERFORM public.require_platform_action(p_actor,p_session,'platform.folder:create');
 PERFORM 1 FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id;
 IF FOUND THEN
  IF v_op.actor_id<>p_actor OR v_op.action<>p_action OR v_op.input<>p_input THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
  RETURN to_jsonb(v_op);
 END IF;
 INSERT INTO public.platform_file_operations(id,actor_id,action,request_id,input,lease_id,lease_expires_at)
  VALUES(p_id,p_actor,p_action,p_request,p_input,p_lease,clock_timestamp()+interval '90 seconds') RETURNING * INTO v_op;
 RETURN to_jsonb(v_op);
END;
$f$;
CREATE FUNCTION public.platform_file_prepare_folder(p_actor uuid,p_session uuid,p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations; v_parent public.platform_file_entries; v_path text[]; v_entry uuid:=gen_random_uuid();
BEGIN
 PERFORM 1 FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 PERFORM public.require_platform_action(p_actor,p_session,'platform.folder:create');
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND actor_id=p_actor AND lease_id=p_lease AND lease_expires_at>clock_timestamp() AND phase='pending' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 SELECT * INTO v_parent FROM public.platform_file_entries WHERE id=(v_op.input->>'parentId')::uuid AND state='active' AND kind='folder' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF v_parent.busy_operation_id IS NOT NULL THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 IF EXISTS(SELECT 1 FROM public.platform_file_entries WHERE parent_id=v_parent.id AND name=v_op.input->>'name' AND state='active') THEN RAISE EXCEPTION 'FILE_NAME_CONFLICT'; END IF;
 v_path:=v_parent.path||ARRAY[v_op.input->>'name'];
 IF octet_length(array_to_string(v_path,'/'))>512 THEN RAISE EXCEPTION 'FILE_PATH_TOO_LONG'; END IF;
 UPDATE public.platform_file_operations SET phase='preparing',entry_id=v_entry,updated_at=clock_timestamp(),
  objects=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'directory',true,'sourceArea',NULL,'sourcePath',NULL,
   'targetArea','files','targetPath',v_path,'expectedBytes',0,'expectedSha256',NULL,'targetPrepared',false,
   'sourceDeleted',false,'sourceDeletionStarted',false,'sourceRestored',false,'targetDeleted',false)) WHERE id=p_id RETURNING * INTO v_op;
 RETURN to_jsonb(v_op);
END;
$f$;
CREATE FUNCTION public.platform_file_object_fact(p_id uuid,p_lease uuid,p_object uuid,p_fact text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations;
BEGIN
 IF p_fact NOT IN ('targetPrepared','targetDeleted','sourceDeleted','sourceRestored') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND lease_id=p_lease AND phase NOT IN ('completed','failed') FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_op.objects) o WHERE (o->>'id')::uuid=p_object) THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 UPDATE public.platform_file_operations SET objects=(SELECT jsonb_agg(CASE WHEN (o->>'id')::uuid=p_object THEN jsonb_set(o,ARRAY[p_fact],'true'::jsonb) ELSE o END ORDER BY ord)
  FROM jsonb_array_elements(v_op.objects) WITH ORDINALITY a(o,ord)),updated_at=clock_timestamp() WHERE id=p_id;
END;
$f$;
CREATE FUNCTION public.platform_file_commit_folder(p_actor uuid,p_session uuid,p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations; v_entry public.platform_file_entries;
BEGIN
 PERFORM 1 FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 PERFORM public.require_platform_action(p_actor,p_session,'platform.folder:create');
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND actor_id=p_actor AND lease_id=p_lease AND phase='preparing' AND lease_expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_op.objects) o WHERE NOT (o->>'targetPrepared')::boolean OR (o->>'targetDeleted')::boolean) THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 INSERT INTO public.platform_file_entries(id,parent_id,kind,name,path,created_by)
  VALUES(v_op.entry_id,(v_op.input->>'parentId')::uuid,'folder',v_op.input->>'name',ARRAY(SELECT jsonb_array_elements_text(v_op.objects->0->'targetPath')),p_actor) RETURNING * INTO v_entry;
 UPDATE public.platform_file_operations SET phase='completed',committed_at=clock_timestamp(),completed_at=clock_timestamp(),updated_at=clock_timestamp(),result=jsonb_build_object('entryId',v_entry.id,'revision',v_entry.revision) WHERE id=p_id RETURNING * INTO v_op;
 BEGIN
  INSERT INTO public.audit_events(scope,event_code,actor_id,resource_type,resource_id,result,request_id,operation_id,fields)
   VALUES('platform','platform.file_create_folder',p_actor,'platform_file',v_entry.id,'succeeded',v_op.request_id,p_id::text,'{}');
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
 RETURN public.platform_file_receipt(v_op);
END;
$f$;
CREATE FUNCTION public.platform_file_fail(p_id uuid,p_lease uuid,p_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations;
BEGIN
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND lease_id=p_lease AND phase IN ('pending','preparing') FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_op.objects) o WHERE o->>'targetArea' IS NOT NULL AND NOT (o->>'targetDeleted')::boolean) THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 UPDATE public.platform_file_operations SET phase='failed',error_code=p_code,updated_at=clock_timestamp() WHERE id=p_id;
 INSERT INTO public.audit_events(scope,event_code,actor_id,resource_type,resource_id,result,request_id,operation_id,fields)
  VALUES('platform','platform.file_failed',v_op.actor_id,'platform_file',v_op.entry_id,'failed',v_op.request_id,p_id::text,jsonb_build_object('code',p_code));
END;
$f$;
--> statement-breakpoint
ALTER FUNCTION public.platform_file_time(timestamptz) OWNER TO platform_executor;
ALTER FUNCTION public.platform_file_entry_projection(public.platform_file_entries) OWNER TO platform_executor;
ALTER FUNCTION public.platform_file_receipt(public.platform_file_operations) OWNER TO platform_executor;
ALTER FUNCTION public.platform_file_read(uuid,uuid,text,uuid,jsonb) OWNER TO platform_executor;
ALTER FUNCTION public.platform_file_begin(uuid,uuid,uuid,text,jsonb,text,uuid) OWNER TO platform_executor;
ALTER FUNCTION public.platform_file_prepare_folder(uuid,uuid,uuid,uuid) OWNER TO platform_executor;
ALTER FUNCTION public.platform_file_object_fact(uuid,uuid,uuid,text) OWNER TO platform_executor;
ALTER FUNCTION public.platform_file_commit_folder(uuid,uuid,uuid,uuid) OWNER TO platform_executor;
ALTER FUNCTION public.platform_file_fail(uuid,uuid,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_time(timestamptz),public.platform_file_entry_projection(public.platform_file_entries),public.platform_file_receipt(public.platform_file_operations),public.platform_file_read(uuid,uuid,text,uuid,jsonb),public.platform_file_begin(uuid,uuid,uuid,text,jsonb,text,uuid),public.platform_file_prepare_folder(uuid,uuid,uuid,uuid),public.platform_file_object_fact(uuid,uuid,uuid,text),public.platform_file_commit_folder(uuid,uuid,uuid,uuid),public.platform_file_fail(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_read(uuid,uuid,text,uuid,jsonb),public.platform_file_begin(uuid,uuid,uuid,text,jsonb,text,uuid),public.platform_file_prepare_folder(uuid,uuid,uuid,uuid),public.platform_file_object_fact(uuid,uuid,uuid,text),public.platform_file_commit_folder(uuid,uuid,uuid,uuid),public.platform_file_fail(uuid,uuid,text) TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
CREATE FUNCTION public.platform_file_journal(p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations;
BEGIN
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND lease_id=p_lease;
 IF NOT FOUND THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 RETURN to_jsonb(v_op);
END;
$f$;
ALTER FUNCTION public.platform_file_journal(uuid,uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_journal(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_journal(uuid,uuid) TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
