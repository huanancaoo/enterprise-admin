ALTER TABLE public.platform_file_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_file_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_file_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_file_references FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_file_batches_executor ON public.platform_file_batches TO platform_executor USING(true) WITH CHECK(true);
CREATE POLICY platform_file_references_executor ON public.platform_file_references TO platform_executor USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON public.platform_file_batches TO platform_executor;
GRANT SELECT,INSERT,DELETE ON public.platform_file_references TO platform_executor;
GRANT CREATE ON SCHEMA public TO platform_executor;
--> statement-breakpoint
CREATE FUNCTION public.platform_file_policy_projection() RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('quotaBytes',quota_bytes,'usedBytes',used_bytes,'reservedBytes',reserved_bytes,'transientBytes',transient_bytes,'trashDays',trash_days,'historyDays',history_days,'policyRevision',revision,'maxUploadBytes',104857600) FROM public.platform_file_policy WHERE id=1;
$f$;
CREATE FUNCTION public.platform_file_policy_command(p_actor uuid,p_session uuid,p_input jsonb,p_request text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_policy public.platform_file_policy;
BEGIN
 PERFORM public.require_platform_action(p_actor,p_session,CASE WHEN p_input IS NULL THEN 'platform.settings:read' ELSE 'platform.settings:update' END);
 SELECT * INTO STRICT v_policy FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 IF p_input IS NOT NULL THEN
  IF (p_input->>'expectedRevision')::int IS DISTINCT FROM v_policy.revision THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF (p_input->>'quotaBytes')::bigint NOT BETWEEN 0 AND 9007199254740991 OR (p_input->>'trashDays')::int<1 OR (p_input->>'historyDays')::int<1 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  UPDATE public.platform_file_policy SET quota_bytes=(p_input->>'quotaBytes')::bigint,trash_days=(p_input->>'trashDays')::int,history_days=(p_input->>'historyDays')::int,revision=revision+1 WHERE id=1;
 END IF;
 BEGIN
 INSERT INTO public.audit_events(scope,event_code,actor_id,resource_type,result,request_id,fields)
 VALUES('platform','platform.file_policy',p_actor,'platform_file_policy','succeeded',p_request,jsonb_build_object('updated',p_input IS NOT NULL,'previousRevision',v_policy.revision));
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
 RETURN public.platform_file_policy_projection();
END;
$f$;
CREATE FUNCTION public.platform_file_impact(p_actor uuid,p_session uuid,p_id uuid,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_entry public.platform_file_entries;v_ids uuid[];v_files integer;v_folders integer;v_bytes bigint;
BEGIN
 SELECT * INTO v_entry FROM public.platform_file_entries WHERE id=p_id AND state<>'purged';
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF p_action NOT IN ('trash','purge') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 PERFORM public.require_platform_action(p_actor,p_session,public.platform_file_permission(p_action,v_entry.kind));
 SELECT array_agg(id),count(*) FILTER(WHERE kind='file'),count(*) FILTER(WHERE kind='folder') INTO v_ids,v_files,v_folders FROM public.platform_file_subtree(p_id);
 SELECT coalesce(sum(bytes),0) INTO v_bytes FROM public.platform_file_versions WHERE file_id=ANY(v_ids) AND state='available';
 RETURN jsonb_build_object('entryId',p_id,'revision',v_entry.revision,'fileCount',v_files,'folderCount',v_folders,'bytes',v_bytes,'referenceCount',public.platform_file_reference_count(v_ids));
END;
$f$;
CREATE FUNCTION public.platform_file_references_read(p_actor uuid,p_session uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_entry public.platform_file_entries;v_ids uuid[];v_items jsonb:='[]';v_total integer;
BEGIN
 SELECT * INTO v_entry FROM public.platform_file_entries WHERE id=p_id AND state<>'purged';
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM public.require_platform_action(p_actor,p_session,'platform.'||v_entry.kind||':read');
 SELECT array_agg(id) INTO v_ids FROM public.platform_file_subtree(p_id);
 SELECT count(*) INTO v_total FROM public.platform_file_references r JOIN public.platform_announcements a ON a.id=r.announcement_id WHERE r.file_id=ANY(v_ids) AND a.deleted_at IS NULL;
 -- 删除保护的数量不暴露公告标题；只有公告读取权才能取得可导航的业务详情。
 IF EXISTS(SELECT 1 FROM public.read_platform_access(p_actor,p_session) a WHERE 'platform.announcement:read'=ANY(a.permissions)) THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('fileId',r.file_id,'versionId',r.version_id,'announcementId',a.id,'title',a.title) ORDER BY a.id,r.version_id),'[]') INTO v_items
  FROM public.platform_file_references r JOIN public.platform_announcements a ON a.id=r.announcement_id WHERE r.file_id=ANY(v_ids) AND a.deleted_at IS NULL;
 END IF;
 RETURN jsonb_build_object('total',v_total,'items',v_items);
END;
$f$;
CREATE FUNCTION public.platform_file_batch(p_actor uuid,p_session uuid,p_id uuid,p_mode text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_batch public.platform_file_batches;v_item jsonb;v_index integer;v_root integer;v_items jsonb:='[]';v_action text;v_permission text;v_op public.platform_file_operations;v_root_item jsonb;v_result jsonb:='[]';
BEGIN
 PERFORM 1 FROM public.platform_file_policy WHERE id=1 FOR UPDATE;
 SELECT * INTO v_batch FROM public.platform_file_batches WHERE id=p_id FOR UPDATE;
 v_action:=coalesce(v_batch.action,p_input->>'action');
 IF v_action NOT IN ('move','trash','restore','purge') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 SELECT permission INTO v_permission FROM public.read_platform_access(p_actor,p_session) a,unnest(a.permissions) permission
 WHERE permission IN(public.platform_file_permission(v_action,'file'),public.platform_file_permission(v_action,'folder')) LIMIT 1;
 IF v_permission IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM public.require_platform_action(p_actor,p_session,v_permission);
 IF v_batch.id IS NULL THEN
  IF p_mode<>'create' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF jsonb_array_length(p_input->'items') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  FOR v_item,v_index IN SELECT value,ordinality::integer-1 FROM jsonb_array_elements(p_input->'items') WITH ORDINALITY LOOP
   SELECT ord::integer-1 INTO v_root FROM jsonb_array_elements(p_input->'items') WITH ORDINALITY candidate(value,ord)
   JOIN public.platform_file_entries parent ON parent.id=(value->>'entryId')::uuid
   JOIN public.platform_file_entries child ON child.id=(v_item->>'entryId')::uuid
   WHERE parent.state=child.state AND parent.path=child.path[1:cardinality(parent.path)] ORDER BY cardinality(parent.path),ord LIMIT 1;
   v_items:=v_items||jsonb_build_array(jsonb_build_object('index',v_index,'entryId',v_item->>'entryId','requestedOperationId',v_item->>'operationId','rootIndex',coalesce(v_root,v_index),'error',NULL));
  END LOOP;
  INSERT INTO public.platform_file_batches(id,actor_id,action,input,items) VALUES(p_id,p_actor,v_action,p_input,v_items) RETURNING * INTO v_batch;
 ELSIF v_batch.actor_id<>p_actor OR (p_mode='create' AND v_batch.input<>p_input) THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
 IF p_mode='record' THEN
  v_index:=(p_input->>'index')::integer;
  IF v_index<0 OR v_index>=jsonb_array_length(v_batch.items) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  UPDATE public.platform_file_batches SET items=jsonb_set(items,ARRAY[v_index::text,'error'],p_input->'error') WHERE id=p_id RETURNING * INTO v_batch;
 END IF;
 FOR v_item IN SELECT * FROM jsonb_array_elements(v_batch.items) LOOP
  v_root_item:=v_batch.items->(v_item->>'rootIndex')::integer;
  SELECT * INTO v_op FROM public.platform_file_operations WHERE id=(v_root_item->>'requestedOperationId')::uuid AND actor_id=p_actor;
  v_result:=v_result||jsonb_build_array(v_item||jsonb_build_object('operationId',v_root_item->>'requestedOperationId',
   'state',CASE WHEN v_item->>'index'<>v_item->>'rootIndex' THEN 'covered' WHEN v_op.id IS NOT NULL THEN v_op.phase WHEN v_root_item->'error'<>'null'::jsonb THEN 'failed' ELSE 'pending' END,
   'operation',CASE WHEN v_op.id IS NULL THEN NULL ELSE public.platform_file_receipt(v_op) END,
   'error',CASE WHEN v_op.error_code IS NOT NULL THEN jsonb_build_object('code',v_op.error_code) ELSE v_root_item->'error' END));
 END LOOP;
 RETURN jsonb_build_object('batchId',p_id,'action',v_batch.action,'createdAt',public.platform_file_time(v_batch.created_at),'items',v_result);
END;
$f$;
--> statement-breakpoint
ALTER FUNCTION public.platform_file_policy_projection() OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_policy_projection() FROM PUBLIC;
ALTER FUNCTION public.platform_file_policy_command(uuid,uuid,jsonb,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_policy_command(uuid,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_policy_command(uuid,uuid,jsonb,text) TO app_runtime;
ALTER FUNCTION public.platform_file_impact(uuid,uuid,uuid,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_impact(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_impact(uuid,uuid,uuid,text) TO app_runtime;
ALTER FUNCTION public.platform_file_references_read(uuid,uuid,uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_references_read(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_references_read(uuid,uuid,uuid) TO app_runtime;
ALTER FUNCTION public.platform_file_batch(uuid,uuid,uuid,text,jsonb) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_file_batch(uuid,uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_file_batch(uuid,uuid,uuid,text,jsonb) TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
