-- 媒体的定位信息只由已验证公告受众或平台动作的固定入口返回。
REVOKE ALL ON FUNCTION public.get_platform_file_internal(uuid,uuid) FROM app_runtime;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_announcement_command(p_actor uuid,p_session uuid,p_operation text,p_id uuid,p_input jsonb,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_row public.platform_announcements; v_result jsonb; v_items jsonb; v_total bigint; v_pub uuid;
 v_page integer:=coalesce((p_input->>'page')::integer,1); v_size integer:=coalesce((p_input->>'pageSize')::integer,20);
 v_ref record; v_action text; v_attachments uuid[]; v_resources uuid[]; v_orgs uuid[]; v_resource uuid; v_binding uuid; v_uploader uuid;
BEGIN
 v_action:=CASE p_operation WHEN 'list' THEN 'read' WHEN 'export-page' THEN 'export' WHEN 'get' THEN 'read'
  WHEN 'readers' THEN 'readers' WHEN 'create' THEN 'create' WHEN 'update' THEN 'update'
  WHEN 'publish' THEN 'publish' WHEN 'withdraw' THEN 'publish' WHEN 'delete' THEN 'delete' ELSE NULL END;
 IF p_operation='media' THEN
  IF EXISTS(SELECT 1 FROM public.platform_file_references r JOIN public.platform_announcements a ON a.id=r.announcement_id WHERE r.file_id=p_id AND r.version_id=(p_input->>'versionId')::uuid AND a.deleted_at IS NULL) THEN
   PERFORM public.require_platform_action(p_actor,p_session,'platform.announcement:read');
  ELSE PERFORM public.require_platform_action(p_actor,p_session,'platform.file:read'); END IF;
  RETURN public.get_platform_file_internal(p_id,(p_input->>'versionId')::uuid);
 END IF;
 IF v_action IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 PERFORM public.require_platform_action(p_actor,p_session,'platform.announcement:'||v_action);
 IF p_operation IN ('create','update','publish','delete') THEN PERFORM 1 FROM public.platform_file_policy WHERE id=1 FOR UPDATE; END IF;
 IF p_request IS NULL OR length(p_request)=0 OR v_page<1 OR v_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF p_operation IN ('list','export-page') THEN
  WITH filtered AS MATERIALIZED (SELECT a FROM public.platform_announcements a WHERE a.deleted_at IS NULL
   AND (nullif(p_input->>'q','') IS NULL OR a.title ILIKE '%'||(p_input->>'q')||'%')
   AND (p_input->>'type' IS NULL OR a.type=p_input->>'type') AND(p_input->>'status' IS NULL OR a.status=p_input->>'status')),
  page AS (SELECT a FROM filtered ORDER BY (a).updated_at DESC,(a).id DESC LIMIT v_size OFFSET (v_page::bigint-1)*v_size)
  SELECT coalesce(jsonb_agg(public.platform_announcement_summary(a) ORDER BY(a).updated_at DESC,(a).id DESC),'[]'::jsonb),
    (SELECT count(*) FROM filtered) INTO v_items,v_total FROM page;
  v_result:=jsonb_build_object('items',v_items,'page',v_page,'pageSize',v_size,'total',v_total);
 ELSE
  IF p_operation='create' THEN
   IF length(btrim(p_input->>'title')) NOT BETWEEN 1 AND 200 OR p_input->>'type' NOT IN('notice','announcement')
    OR jsonb_typeof(p_input->'content')<>'object' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   p_id:=gen_random_uuid();
   INSERT INTO public.platform_announcements(id,title,type,audience,content,author_id)
   VALUES(p_id,btrim(p_input->>'title'),p_input->>'type',p_input->>'audience',p_input->'content',p_actor) RETURNING * INTO v_row;
  ELSE
   SELECT * INTO v_row FROM public.platform_announcements a WHERE a.id=p_id AND a.deleted_at IS NULL FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  IF p_operation='readers' THEN
   WITH filtered AS MATERIALIZED (SELECT r.user_id,r.read_at,u.name,
    left(split_part(u.email,'@',1),1)||'***@'||split_part(u.email,'@',2) masked_email
    FROM public.platform_announcement_reads r LEFT JOIN public."user" u ON u.id=r.user_id WHERE r.publication_id=v_row.publication_id),
   page AS (SELECT * FROM filtered ORDER BY read_at DESC,user_id LIMIT v_size OFFSET (v_page::bigint-1)*v_size)
   SELECT coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'name',name,'maskedEmail',masked_email,'readAt',read_at)
    ORDER BY read_at DESC,user_id),'[]'::jsonb),(SELECT count(*) FROM filtered) INTO v_items,v_total FROM page;
   v_result:=jsonb_build_object('items',v_items,'page',v_page,'pageSize',v_size,'total',v_total);
  ELSE
   IF p_operation NOT IN('get','create') AND (p_input->>'expectedVersion')::integer IS DISTINCT FROM v_row.version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   IF p_operation IN('create','update','publish') THEN
    IF p_operation='update' AND v_row.status='published' THEN RAISE EXCEPTION 'ANNOUNCEMENT_STATE_CONFLICT'; END IF;
    v_orgs:=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p_input->'organizationIds'));
    IF p_input->>'audience' NOT IN('platform','allTenants','organizations') OR
     ((p_input->>'audience'='organizations') IS DISTINCT FROM (cardinality(v_orgs)>0)) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF (SELECT count(*) FROM public.organization o WHERE o.id=ANY(v_orgs))<>cardinality(v_orgs) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF p_operation IN('create','update') THEN
     v_attachments:=ARRAY(SELECT (value->>'versionId')::uuid FROM jsonb_array_elements(p_input->'attachments'));
     IF EXISTS(SELECT 1 FROM public.platform_announcement_file_refs(p_input->'content',p_input->'attachments')) THEN
      PERFORM public.require_platform_action(p_actor,p_session,'platform.file:read');
     END IF;
     FOR v_ref IN SELECT * FROM public.platform_announcement_file_refs(p_input->'content',p_input->'attachments') LOOP
      IF NOT EXISTS(SELECT 1 FROM public.platform_file_entries e JOIN public.platform_file_versions v ON v.file_id=e.id WHERE e.id=v_ref.file_id AND v.id=v_ref.version_id AND e.state='active' AND v.state='available') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF EXISTS(SELECT 1 FROM public.platform_file_entries WHERE id=v_ref.file_id AND busy_operation_id IS NOT NULL) THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
     END LOOP;
     DELETE FROM public.platform_file_references WHERE announcement_id=p_id;
     INSERT INTO public.platform_file_references(announcement_id,file_id,version_id) SELECT p_id,file_id,version_id FROM public.platform_announcement_file_refs(p_input->'content',p_input->'attachments');
     UPDATE public.platform_announcements SET title=btrim(p_input->>'title'),type=p_input->>'type',content=p_input->'content',
      attachments=v_attachments,audience=p_input->>'audience',organization_ids=v_orgs,
      version=version+CASE WHEN p_operation='create' THEN 0 ELSE 1 END,updated_at=clock_timestamp()
      WHERE id=p_id RETURNING * INTO v_row;
    ELSE
     IF v_row.status='published' THEN RAISE EXCEPTION 'ANNOUNCEMENT_STATE_CONFLICT'; END IF;
     v_pub:=gen_random_uuid();
     INSERT INTO public.platform_announcement_publications(id,announcement_id,title,type,audience,organization_ids,content,attachments,published_by)
      VALUES(v_pub,p_id,v_row.title,v_row.type,p_input->>'audience',v_orgs,v_row.content,v_row.attachments,p_actor);
     UPDATE public.platform_announcements SET status='published',audience=p_input->>'audience',organization_ids=v_orgs,
      publication_id=v_pub,published_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_row;
    END IF;
   ELSIF p_operation='withdraw' THEN
    IF v_row.status<>'published' THEN RAISE EXCEPTION 'ANNOUNCEMENT_STATE_CONFLICT'; END IF;
    UPDATE public.platform_announcements SET status='withdrawn',version=version+1,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_row;
   ELSIF p_operation='delete' THEN
    IF v_row.status='published' THEN RAISE EXCEPTION 'ANNOUNCEMENT_STATE_CONFLICT'; END IF;
    DELETE FROM public.platform_file_references WHERE announcement_id=p_id;
    UPDATE public.platform_announcements SET deleted_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE id=p_id;
   END IF;
   v_result:=CASE WHEN p_operation='delete' THEN jsonb_build_object('id',p_id,'deleted',true)
    ELSE public.platform_announcement_summary(v_row)||jsonb_build_object('organizationIds',to_jsonb(v_row.organization_ids),
     'content',v_row.content,'attachments',public.platform_announcement_attachments(v_row.attachments)) END;
  END IF;
 END IF;
 BEGIN
  INSERT INTO public.audit_events(scope,event_code,actor_id,resource_type,resource_id,result,request_id,fields)
   VALUES('platform','platform.announcement_'||replace(p_operation,'-','_'),p_actor,'announcement',p_id,'succeeded',p_request,
    jsonb_build_object('version',v_row.version,'publicationId',v_row.publication_id));
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
 RETURN v_result;
END;
$f$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_announcement_inbox(p_actor uuid,p_session uuid,p_organization uuid,p_operation text,p_id uuid,p_input jsonb,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_row public.platform_announcements; v_pub public.platform_announcement_publications; v_items jsonb; v_total bigint;
 v_unread bigint; v_result jsonb; v_read timestamptz; v_page integer:=coalesce((p_input->>'page')::integer,1);
 v_size integer:=coalesce((p_input->>'pageSize')::integer,20); v_id uuid:=p_id;
BEGIN
 PERFORM public.require_active_account(p_actor);
 IF p_organization IS NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.read_platform_access(p_actor,p_session)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 ELSE
  -- 租户入口必须位于已经建立组织上下文的 TenantTx；身份由成员 Guard 提供。
  IF current_setting('app.organization_id',true) IS DISTINCT FROM p_organization::text THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM public.require_active_organization(p_organization);
  IF NOT EXISTS(SELECT 1 FROM public.member m WHERE m.organization_id=p_organization AND m.user_id=p_actor) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 END IF;
 IF v_page<1 OR v_size NOT BETWEEN 1 AND 100 OR p_operation NOT IN('list','get','read','media') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF p_operation='list' THEN
  WITH visible AS MATERIALIZED (
   SELECT a,NOT EXISTS(SELECT 1 FROM public.platform_announcement_reads r WHERE r.publication_id=a.publication_id AND r.user_id=p_actor) unread
   FROM public.platform_announcements a JOIN public.platform_announcement_publications p ON p.id=a.publication_id
   WHERE a.status='published' AND a.deleted_at IS NULL AND
    ((p_organization IS NULL AND p.audience='platform') OR(p_organization IS NOT NULL AND
     (p.audience='allTenants' OR(p.audience='organizations' AND p_organization=ANY(p.organization_ids)))))
  ), filtered AS MATERIALIZED (SELECT * FROM visible WHERE
    (nullif(p_input->>'q','') IS NULL OR(a).title ILIKE '%'||(p_input->>'q')||'%')
    AND(coalesce(p_input->>'unreadOnly','false')<>'true' OR unread)),
  page AS(SELECT * FROM filtered ORDER BY(a).published_at DESC,(a).id DESC LIMIT v_size OFFSET(v_page::bigint-1)*v_size)
  SELECT coalesce(jsonb_agg(public.platform_announcement_summary(a)||jsonb_build_object('unread',unread)
   ORDER BY(a).published_at DESC,(a).id DESC),'[]'::jsonb),(SELECT count(*) FROM filtered),(SELECT count(*) FROM visible WHERE unread)
   INTO v_items,v_total,v_unread FROM page;
  RETURN jsonb_build_object('items',v_items,'page',v_page,'pageSize',v_size,'total',v_total,'unreadCount',v_unread);
 END IF;
 IF p_operation='media' THEN
  -- 同一个版本可被多份公告复用；必须命中当前可读的发布快照，不能任取一份绑定。
  SELECT a.id INTO v_id FROM public.platform_announcements a JOIN public.platform_announcement_publications p ON p.id=a.publication_id
  JOIN public.platform_file_references r ON r.announcement_id=a.id
  WHERE r.file_id=p_id AND r.version_id=(p_input->>'versionId')::uuid AND a.status='published' AND a.deleted_at IS NULL
   AND ((p_organization IS NULL AND p.audience='platform') OR(p_organization IS NOT NULL AND(p.audience='allTenants' OR(p.audience='organizations' AND p_organization=ANY(p.organization_ids)))))
   AND (r.version_id=ANY(p.attachments) OR EXISTS(SELECT 1 FROM public.platform_announcement_file_refs(p.content,'[]') f WHERE f.file_id=p_id AND f.version_id=r.version_id))
  ORDER BY a.id LIMIT 1;
 END IF;
 SELECT * INTO v_row FROM public.platform_announcements a WHERE a.id=v_id AND a.status='published' AND a.deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO v_pub FROM public.platform_announcement_publications p WHERE p.id=v_row.publication_id AND
  ((p_organization IS NULL AND p.audience='platform') OR(p_organization IS NOT NULL AND
   (p.audience='allTenants' OR(p.audience='organizations' AND p_organization=ANY(p.organization_ids)))));
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF p_operation='media' THEN RETURN public.get_platform_file_internal(p_id,(p_input->>'versionId')::uuid); END IF;
 IF p_operation='read' THEN
  IF (p_input->>'publicationId')::uuid IS DISTINCT FROM v_pub.id THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  INSERT INTO public.platform_announcement_reads(publication_id,user_id) VALUES(v_pub.id,p_actor) ON CONFLICT DO NOTHING;
  SELECT read_at INTO v_read FROM public.platform_announcement_reads WHERE publication_id=v_pub.id AND user_id=p_actor;
  v_result:=jsonb_build_object('publicationId',v_pub.id,'readAt',v_read);
 ELSE
  v_result:=public.platform_announcement_summary(v_row)||jsonb_build_object('content',v_pub.content,
   'attachments',public.platform_announcement_attachments(v_pub.attachments),'unread',NOT EXISTS(
    SELECT 1 FROM public.platform_announcement_reads r WHERE r.publication_id=v_pub.id AND r.user_id=p_actor));
 END IF;
 BEGIN
  INSERT INTO public.audit_events(scope,event_code,actor_id,organization_id,resource_type,resource_id,result,request_id,fields)
  VALUES('user','user.announcement_'||p_operation,p_actor,p_organization,'announcement',v_id,'succeeded',p_request,
   jsonb_build_object('publicationId',v_pub.id));
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
 RETURN v_result;
END;
$f$;


--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_file_batch(p_actor uuid,p_session uuid,p_id uuid,p_mode text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_batch public.platform_file_batches;v_item jsonb;v_index integer;v_root integer;v_items jsonb:='[]';v_action text;v_permission text;v_op public.platform_file_operations;v_root_item jsonb;v_result jsonb:='[]';v_expected jsonb;v_error jsonb;
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
   WHERE parent.state=child.state AND parent.trash_root_id IS NOT DISTINCT FROM child.trash_root_id AND parent.path=child.path[1:cardinality(parent.path)] ORDER BY cardinality(parent.path),ord LIMIT 1;
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
  SELECT * INTO v_op FROM public.platform_file_operations WHERE id=(v_root_item->>'requestedOperationId')::uuid;
  v_expected:=v_batch.input->'items'->(v_root_item->>'index')::integer;
  IF v_batch.input->>'parentId' IS NOT NULL THEN v_expected:=v_expected||jsonb_build_object('parentId',v_batch.input->>'parentId'); END IF;
  v_error:=v_root_item->'error';
  -- 收据属于精确意图；不能将其他操作的已完成状态投影为本批次成功。
  IF v_op.id IS NOT NULL AND (v_op.actor_id<>p_actor OR v_op.action<>v_batch.action OR v_op.input<>v_expected) THEN
   v_op:=NULL;v_error:=jsonb_build_object('code','IDEMPOTENCY_KEY_REUSED');
  END IF;
  v_result:=v_result||jsonb_build_array(v_item||jsonb_build_object('operationId',v_root_item->>'requestedOperationId',
   'state',CASE WHEN v_item->>'index'<>v_item->>'rootIndex' THEN 'covered' WHEN v_op.id IS NOT NULL THEN v_op.phase WHEN v_error<>'null'::jsonb THEN 'failed' ELSE 'pending' END,
   'operation',CASE WHEN v_op.id IS NULL THEN NULL ELSE public.platform_file_receipt(v_op) END,
   'error',CASE WHEN v_op.error_code IS NOT NULL THEN jsonb_build_object('code',v_op.error_code) ELSE v_error END));
 END LOOP;
 RETURN jsonb_build_object('batchId',p_id,'action',v_batch.action,'createdAt',public.platform_file_time(v_batch.created_at),'items',v_result);
END;
$f$;

--> statement-breakpoint
CREATE POLICY audit_events_platform_file_expired_select ON public.audit_events FOR SELECT TO platform_executor USING(scope='platform' AND organization_id IS NULL AND event_code='platform.file_expired');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_audit_event_codes(p_scope text)
RETURNS text[] LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $function$
  SELECT CASE p_scope
    WHEN 'platform' THEN ARRAY['platform.access_denied', 'platform.mfa_verified', 'platform.organizations_queried',
      'platform.organization_viewed', 'platform.users_queried', 'platform.user_viewed',
      'platform.user_sensitive_viewed', 'platform.organization_suspended', 'platform.organization_resumed',
      'platform.audit_queried', 'platform.audit_viewed', 'platform.settings_viewed', 'platform.settings_updated',
      'platform.storage_policy_viewed', 'platform.storage_policy_updated',
      'platform.employee_created','platform.user_password_login_unlocked','platform.user_created', 'platform.user_updated', 'platform.user_suspended', 'platform.user_resumed', 'platform.user_password_reset_requested', 'platform.session_revoked', 'platform.sessions_queried', 'platform.login_logs_queried'] || ARRAY['platform.announcement_list','platform.announcement_get','platform.announcement_create','platform.announcement_update','platform.announcement_publish','platform.announcement_withdraw','platform.announcement_delete','platform.announcement_readers','platform.announcement_export_page','platform.task_submitted','platform.task_completed','platform.task_failed','platform.resource_created','platform.resource_read'] || public.platform_system_audit_event_codes() || public.platform_schedule_audit_codes() || ARRAY['platform.file_workspace','platform.file_create_folder','platform.file_failed','platform.file_upload','platform.file_overwrite','platform.file_rename','platform.file_move','platform.file_trash','platform.file_restore','platform.file_purge','platform.file_policy','platform.file_expired']::text[]
    WHEN 'tenant' THEN ARRAY['member.invited', 'invitation.resent', 'invitation.accepted', 'invitation.rejected',
      'invitation.canceled', 'member.role_changed', 'member.removed', 'member.left',
      'role.created', 'role.updated', 'role.deleted', 'organization.settings_updated',
      'invitation.delivery_smtp_accepted', 'invitation.delivery_failed', 'invitation.delivery_unknown']
    ELSE ARRAY[]::text[]
  END;
$function$;


--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_file_prepare_upload(p_actor uuid,p_session uuid,p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_op public.platform_file_operations; v_policy public.platform_file_policy; v_entry public.platform_file_entries;
 v_parent public.platform_file_entries; v_old public.platform_file_versions; v_entry_id uuid; v_version uuid:=gen_random_uuid();v_objects jsonb;v_path text[];v_bytes bigint;v_name text;v_stem text;v_extension text;v_suffix text;v_number integer:=1;
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
  v_name:=v_op.input->>'name';
  WHILE EXISTS(SELECT 1 FROM public.platform_file_entries WHERE parent_id=v_parent.id AND name=v_name AND state='active') LOOP
   IF coalesce((v_op.input->>'automaticName')::boolean,false)=false THEN RAISE EXCEPTION 'FILE_NAME_CONFLICT'; END IF;
   v_number:=v_number+1;
   v_extension:=coalesce(substring(v_op.input->>'name' from '\.[^.]{1,16}$'),'');
   v_stem:=left(v_op.input->>'name',length(v_op.input->>'name')-length(v_extension));
   v_suffix:=' ('||v_number::text||')'||v_extension;
   WHILE octet_length(v_stem||v_suffix)>255 LOOP v_stem:=left(v_stem,length(v_stem)-1); END LOOP;
   v_name:=v_stem||v_suffix;
  END LOOP;
  v_entry_id:=gen_random_uuid(); v_path:=v_parent.path||ARRAY[v_name];
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
  VALUES(v_op.entry_id,(v_op.input->>'parentId')::uuid,'file',v_op.plans->0->'path'->>-1,ARRAY(SELECT jsonb_array_elements_text(v_op.plans->0->'path')),v_version,p_id,p_actor) RETURNING * INTO v_entry;
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

