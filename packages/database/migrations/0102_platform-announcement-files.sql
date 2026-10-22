GRANT CREATE ON SCHEMA public TO platform_executor;
-- 原资源身份保留为首个文件/版本身份；每个资源单独目录避免原文件名的同级冲突。
-- 物理复制由持久操作计划执行。API 启动须完成迁入计划，校验字节后才清理旧对象。
-- FORCE RLS 也约束表所有者；迁入事务只临时允许迁移角色移除已映射的公告记录。
CREATE POLICY platform_resources_migration_delete ON public.platform_resources FOR DELETE TO app_migrator USING(purpose='announcement');
DO $migration$
DECLARE r public.platform_resources;v_folder uuid;v_operation uuid;v_path text[];v_objects jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM public.platform_resources WHERE purpose='announcement') THEN
  INSERT INTO public.platform_file_entries(id,parent_id,kind,name,path)
  VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','folder','历史公告资源',ARRAY['历史公告资源']);
 END IF;
 FOR r IN SELECT * FROM public.platform_resources WHERE purpose='announcement' ORDER BY id LOOP
  v_folder:=gen_random_uuid();v_operation:=gen_random_uuid();v_path:=ARRAY['历史公告资源',r.id::text,r.name];
  INSERT INTO public.platform_file_entries(id,parent_id,kind,name,path,created_by,created_at)
  VALUES(v_folder,'00000000-0000-4000-8000-000000000003','folder',r.id::text,ARRAY['历史公告资源',r.id::text],r.uploaded_by,r.created_at);
  INSERT INTO public.platform_file_entries(id,parent_id,kind,name,path,current_version_id,busy_operation_id,created_by,created_at)
  VALUES(r.id,v_folder,'file',r.name,v_path,r.id,v_operation,r.uploaded_by,r.created_at);
  INSERT INTO public.platform_file_versions(id,file_id,bytes,content_type,sha256,storage_area,storage_path,created_at)
  VALUES(r.id,r.id,r.bytes,r.mime_type,r.sha256,'files',v_path,r.created_at);
  v_objects:=jsonb_build_array(public.platform_file_object(true,NULL,NULL,'files',ARRAY['历史公告资源'],0,NULL),
   public.platform_file_object(true,NULL,NULL,'files',ARRAY['历史公告资源',r.id::text],0,NULL),
   public.platform_file_object(false,'files',ARRAY[r.id::text],'files',v_path,r.bytes,r.sha256));
  INSERT INTO public.platform_file_operations(id,actor_id,action,request_id,input,phase,entry_id,objects,plans,committed_at,result,lease_id,lease_expires_at)
  VALUES(v_operation,r.uploaded_by,'move','platform-file-import','{}','committed',r.id,v_objects,'[{"import":true}]',clock_timestamp(),jsonb_build_object('entryId',r.id,'revision',1,'versionId',r.id),gen_random_uuid(),clock_timestamp()-interval '1 second');
 END LOOP;
 INSERT INTO public.platform_file_references(announcement_id,file_id,version_id)
 SELECT a.announcement_id,a.resource_id,a.resource_id FROM public.platform_announcement_resources a JOIN public.platform_announcements n ON n.id=a.announcement_id WHERE n.deleted_at IS NULL;
 UPDATE public.platform_file_policy SET used_bytes=(SELECT coalesce(sum(bytes),0) FROM public.platform_file_versions WHERE state='available') WHERE id=1;
 DELETE FROM public.platform_resources WHERE purpose='announcement';
END;
$migration$;
DROP POLICY platform_resources_migration_delete ON public.platform_resources;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_file_reference_count(p_entries uuid[]) RETURNS integer
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT count(*)::integer FROM public.platform_file_references r JOIN public.platform_announcements a ON a.id=r.announcement_id WHERE r.file_id=ANY(p_entries) AND a.deleted_at IS NULL;
$f$;
CREATE OR REPLACE FUNCTION public.platform_announcement_attachments(p_ids uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
 SELECT coalesce(jsonb_agg(jsonb_build_object('fileId',e.id,'versionId',v.id,'name',e.name,'mimeType',v.content_type,'byteSize',v.bytes) ORDER BY a.ordinality),'[]')
 FROM unnest(p_ids) WITH ORDINALITY a(id,ordinality) JOIN public.platform_file_versions v ON v.id=a.id JOIN public.platform_file_entries e ON e.id=v.file_id;
$f$;
CREATE FUNCTION public.platform_announcement_file_refs(p_content jsonb,p_attachments jsonb) RETURNS TABLE(file_id uuid,version_id uuid)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT DISTINCT (r->>'fileId')::uuid,(r->>'versionId')::uuid FROM (
 SELECT value r FROM jsonb_array_elements(p_attachments)
 UNION ALL SELECT value FROM jsonb_path_query(p_content,'$.**.attrs') nodes(value) WHERE value ? 'fileId') refs;
$f$;
CREATE FUNCTION public.get_platform_file_internal(p_id uuid,p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_entry public.platform_file_entries;v_version public.platform_file_versions;
BEGIN
 SELECT * INTO v_entry FROM public.platform_file_entries WHERE id=p_id AND state='active' AND kind='file' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF v_entry.busy_operation_id IS NOT NULL THEN RAISE EXCEPTION 'FILE_OPERATION_IN_PROGRESS'; END IF;
 SELECT * INTO v_version FROM public.platform_file_versions WHERE id=p_version AND file_id=p_id AND state='available' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 RETURN jsonb_build_object('resource',jsonb_build_object('id',p_id,'versionId',p_version,'name',v_entry.name,'mimeType',v_version.content_type,'bytes',v_version.bytes,'sha256',v_version.sha256),'area',v_version.storage_area,'path',v_version.storage_path);
END;
$f$;

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
  PERFORM public.get_platform_file_internal(p_id,(p_input->>'versionId')::uuid);
  RETURN jsonb_build_object('id',p_id);
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
 IF p_operation='media' THEN RETURN jsonb_build_object('id',p_id); END IF;
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
CREATE OR REPLACE FUNCTION public.require_platform_resource_write(p_actor uuid,p_session uuid,p_purpose text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
BEGIN
 IF p_purpose IS NULL OR p_purpose NOT IN ('task-input','task-output') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 PERFORM public.require_platform_action(p_actor,p_session,CASE p_purpose WHEN 'task-input' THEN 'platform.authorization:manage' ELSE 'platform.task:read' END);
END;
$f$;

CREATE OR REPLACE FUNCTION public.get_platform_resource(p_actor uuid,p_session uuid,p_id uuid,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_resource public.platform_resources;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.read_platform_access(p_actor,p_session)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_request IS NULL OR length(btrim(p_request)) = 0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  SELECT * INTO v_resource FROM public.platform_resources WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM public.require_platform_action(p_actor,p_session,'platform.task:read');
  IF v_resource.uploaded_by <> p_actor THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  BEGIN
    INSERT INTO public.audit_events(scope,event_code,actor_id,resource_type,resource_id,result,request_id,fields)
    VALUES('platform','platform.resource_read',p_actor,'platform_resource',p_id,'succeeded',p_request,
      jsonb_build_object('purpose',v_resource.purpose));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN public.platform_resource_projection(v_resource);
END;
$function$;
ALTER FUNCTION public.platform_announcement_file_refs(jsonb,jsonb) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_announcement_file_refs(jsonb,jsonb) FROM PUBLIC;
ALTER FUNCTION public.get_platform_file_internal(uuid,uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.get_platform_file_internal(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_file_internal(uuid,uuid) TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
