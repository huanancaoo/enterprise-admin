GRANT CREATE ON SCHEMA public TO platform_executor;
DROP POLICY audit_events_platform_files_insert ON public.audit_events;
CREATE POLICY audit_events_platform_files_insert ON public.audit_events FOR INSERT TO platform_executor WITH CHECK(
 scope='platform' AND organization_id IS NULL AND NOT tenant_visible AND event_code IN('platform.file_workspace','platform.file_create_folder','platform.file_failed','platform.file_upload','platform.file_overwrite','platform.file_rename','platform.file_move','platform.file_trash','platform.file_restore','platform.file_purge','platform.file_policy'));
--> statement-breakpoint
CREATE FUNCTION public.platform_file_reference_count(p_entries uuid[]) RETURNS integer
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT count(*)::integer FROM public.platform_announcement_resources WHERE resource_id=ANY(p_entries);
$f$;
CREATE FUNCTION public.platform_file_subtree(p_id uuid) RETURNS SETOF public.platform_file_entries
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 WITH RECURSIVE tree AS (
 SELECT e.* FROM public.platform_file_entries e WHERE e.id=p_id AND state<>'purged'
 UNION ALL SELECT c.* FROM public.platform_file_entries c JOIN tree p ON c.parent_id=p.id WHERE c.state=p.state AND (c.state='active' OR c.trash_root_id=p.trash_root_id)
 ) SELECT * FROM tree;
$f$;
CREATE FUNCTION public.platform_file_prepare_path(p_actor uuid,p_session uuid,p_id uuid,p_lease uuid) RETURNS jsonb
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
CREATE FUNCTION public.platform_file_commit_path(p_actor uuid,p_session uuid,p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations;v_entry public.platform_file_entries;v_plan jsonb;v_days integer;v_ids uuid[];
BEGIN
 SELECT trash_days INTO v_days FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 SELECT * INTO v_op FROM public.platform_file_operations WHERE id=p_id AND actor_id=p_actor AND lease_id=p_lease AND phase='preparing' AND lease_expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR v_op.action NOT IN ('rename','move','trash','restore','purge') THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_op.objects) o WHERE o->>'targetArea' IS NOT NULL AND (NOT (o->>'targetPrepared')::boolean OR (o->>'targetDeleted')::boolean)) THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 SELECT array_agg((p->>'id')::uuid) INTO v_ids FROM jsonb_array_elements(v_op.plans) p;
 IF v_op.action IN ('trash','purge') AND public.platform_file_reference_count(v_ids)>0 THEN RAISE EXCEPTION 'FILE_REFERENCED'; END IF;
 FOR v_plan IN SELECT * FROM jsonb_array_elements(v_op.plans) LOOP
  SELECT * INTO STRICT v_entry FROM public.platform_file_entries WHERE id=(v_plan->>'id')::uuid AND busy_operation_id=p_id FOR UPDATE;
  PERFORM public.require_platform_action(p_actor,p_session,public.platform_file_permission(v_op.action,v_entry.kind));
  UPDATE public.platform_file_entries SET parent_id=(v_plan->>'parentId')::uuid,name=v_plan->>'name',path=ARRAY(SELECT jsonb_array_elements_text(v_plan->'path')),
   revision=revision+1,state=CASE WHEN v_op.action='trash' THEN 'trashed' WHEN v_op.action='purge' THEN 'purged' ELSE 'active' END,
   trash_root_id=CASE WHEN v_op.action IN ('trash','purge') THEN v_op.entry_id ELSE NULL END,
   deleted_at=CASE WHEN v_op.action='trash' THEN clock_timestamp() WHEN v_op.action='purge' THEN deleted_at ELSE NULL END,
   expires_at=CASE WHEN v_op.action='trash' THEN clock_timestamp()+make_interval(days=>v_days) WHEN v_op.action='purge' THEN expires_at ELSE NULL END,updated_at=clock_timestamp() WHERE id=v_entry.id;
  IF v_op.action='purge' THEN
   UPDATE public.platform_file_versions SET state='purged' WHERE file_id=v_entry.id AND state='available';
  ELSE
   UPDATE public.platform_file_versions SET storage_area=v_plan->>'area',storage_path=ARRAY(SELECT jsonb_array_elements_text(v_plan->'storagePath')) WHERE id=v_entry.current_version_id;
  END IF;
 END LOOP;
 SELECT * INTO STRICT v_entry FROM public.platform_file_entries WHERE id=v_op.entry_id;
 UPDATE public.platform_file_operations SET phase='committed',committed_at=clock_timestamp(),updated_at=clock_timestamp(),result=jsonb_build_object('entryId',v_entry.id,'revision',v_entry.revision,'affectedEntries',cardinality(v_ids)) WHERE id=p_id RETURNING * INTO v_op;
 BEGIN
 INSERT INTO public.audit_events(scope,event_code,actor_id,resource_type,resource_id,result,request_id,operation_id,fields)
 VALUES('platform','platform.file_'||v_op.action,p_actor,'platform_file',v_entry.id,'succeeded',v_op.request_id,p_id::text,jsonb_build_object('affectedEntries',cardinality(v_ids)));
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
 RETURN public.platform_file_receipt(v_op);
END;
$f$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_file_settle(p_id uuid,p_lease uuid,p_code text) RETURNS void
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
 UPDATE public.platform_file_policy SET reserved_bytes=reserved_bytes-v_op.reserved_bytes,transient_bytes=0,used_bytes=used_bytes-CASE WHEN v_op.action='purge' AND v_op.committed_at IS NOT NULL THEN (SELECT coalesce(sum((p->>'purgedBytes')::bigint),0) FROM jsonb_array_elements(v_op.plans) p) ELSE 0 END WHERE id=1;
 UPDATE public.platform_file_entries SET busy_operation_id=NULL WHERE busy_operation_id=p_id;
END;
$f$;
ALTER FUNCTION public.platform_file_reference_count(uuid[]) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_reference_count(uuid[]) FROM PUBLIC;
ALTER FUNCTION public.platform_file_subtree(uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_subtree(uuid) FROM PUBLIC;
ALTER FUNCTION public.platform_file_prepare_path(uuid,uuid,uuid,uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_prepare_path(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_prepare_path(uuid,uuid,uuid,uuid) TO app_runtime;
ALTER FUNCTION public.platform_file_commit_path(uuid,uuid,uuid,uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_commit_path(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_commit_path(uuid,uuid,uuid,uuid) TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
