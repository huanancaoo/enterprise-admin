GRANT CREATE ON SCHEMA public TO platform_executor;
CREATE POLICY audit_events_platform_file_expiry_insert ON public.audit_events FOR INSERT TO platform_executor WITH CHECK(scope='platform' AND organization_id IS NULL AND NOT tenant_visible AND event_code='platform.file_expired');
--> statement-breakpoint
CREATE FUNCTION public.platform_file_expire(p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_root public.platform_file_entries;v_entry public.platform_file_entries;v_version public.platform_file_versions;v_history uuid;v_ids uuid[];v_id uuid:=gen_random_uuid();v_op public.platform_file_operations;v_objects jsonb:='[]';v_plans jsonb:='[]';v_bytes bigint;
BEGIN
 PERFORM 1 FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.platform_file_operations WHERE phase NOT IN ('completed','failed')) THEN RETURN NULL; END IF;
 SELECT * INTO v_root FROM public.platform_file_entries e WHERE e.state='trashed' AND e.trash_root_id=e.id AND e.expires_at<=clock_timestamp() AND e.busy_operation_id IS NULL
 AND public.platform_file_reference_count(ARRAY(SELECT id FROM public.platform_file_subtree(e.id)))=0 ORDER BY e.expires_at,e.id LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  SELECT array_agg(id) INTO v_ids FROM public.platform_file_subtree(v_root.id);
 ELSE
  SELECT v.id INTO v_history FROM public.platform_file_versions v JOIN public.platform_file_entries e ON e.id=v.file_id
  WHERE v.state='available' AND v.retired_at IS NOT NULL AND v.expires_at<=clock_timestamp() AND e.state='active' AND e.busy_operation_id IS NULL AND e.current_version_id<>v.id
  AND NOT EXISTS(SELECT 1 FROM public.platform_file_references r JOIN public.platform_announcements a ON a.id=r.announcement_id WHERE r.version_id=v.id AND a.deleted_at IS NULL)
  ORDER BY v.expires_at,v.id LIMIT 1 FOR UPDATE OF v,e;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT e.* INTO STRICT v_root FROM public.platform_file_entries e JOIN public.platform_file_versions v ON v.file_id=e.id WHERE v.id=v_history;
  v_ids:=ARRAY[v_root.id];
 END IF;
 FOR v_entry IN SELECT * FROM public.platform_file_entries WHERE id=ANY(v_ids) FOR UPDATE LOOP
  v_bytes:=0;
  IF v_entry.kind='folder' THEN
   v_objects:=v_objects||jsonb_build_array(public.platform_file_object(true,'trash',ARRAY[v_root.id::text]||v_entry.path[cardinality(v_root.path)+1:cardinality(v_entry.path)],NULL,NULL,0,NULL));
  ELSE
   FOR v_version IN SELECT * FROM public.platform_file_versions WHERE file_id=v_entry.id AND state='available' AND (v_history IS NULL OR id=v_history) FOR UPDATE LOOP
    v_objects:=v_objects||jsonb_build_array(public.platform_file_object(false,v_version.storage_area,v_version.storage_path,NULL,NULL,v_version.bytes,v_version.sha256));
    v_bytes:=v_bytes+v_version.bytes;
    UPDATE public.platform_file_versions SET state='purged' WHERE id=v_version.id;
   END LOOP;
  END IF;
  v_plans:=v_plans||jsonb_build_array(jsonb_build_object('id',v_entry.id,'purgedBytes',v_bytes));
  UPDATE public.platform_file_entries SET busy_operation_id=v_id,state=CASE WHEN v_history IS NULL THEN 'purged' ELSE state END WHERE id=v_entry.id;
 END LOOP;
 INSERT INTO public.platform_file_operations(id,actor_id,action,request_id,input,phase,entry_id,objects,plans,committed_at,result,lease_id,lease_expires_at)
 VALUES(v_id,coalesce(v_root.created_by,'00000000-0000-4000-8000-000000000000'),'purge','platform-file-retention',jsonb_build_object('maintenance',true),'committed',v_root.id,v_objects,v_plans,clock_timestamp(),jsonb_build_object('entryId',v_root.id,'revision',v_root.revision,'affectedEntries',cardinality(v_ids)),p_lease,clock_timestamp()+interval '90 seconds') RETURNING * INTO v_op;
 INSERT INTO public.audit_events(scope,event_code,resource_type,resource_id,result,request_id,operation_id,fields)
 VALUES('platform','platform.file_expired','platform_file',v_root.id,'succeeded','platform-file-retention',v_id::text,jsonb_build_object('versionId',v_history,'affectedEntries',cardinality(v_ids)));
 RETURN to_jsonb(v_op);
END;
$f$;
ALTER FUNCTION public.platform_file_expire(uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_expire(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_expire(uuid) TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
