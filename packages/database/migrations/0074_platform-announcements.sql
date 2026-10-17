CREATE TABLE "platform_announcement_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"audience" text NOT NULL,
	"organization_ids" uuid[] NOT NULL,
	"content" jsonb NOT NULL,
	"attachments" uuid[] NOT NULL,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_announcement_reads" (
	"publication_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_announcement_reads_publication_id_user_id_pk" PRIMARY KEY("publication_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "platform_announcement_resources" (
	"resource_id" uuid PRIMARY KEY NOT NULL,
	"announcement_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"audience" text NOT NULL,
	"organization_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"content" jsonb NOT NULL,
	"attachments" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"author_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"publication_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "platform_announcements_status_check" CHECK ("platform_announcements"."status" IN ('draft','published','withdrawn')),
	CONSTRAINT "platform_announcements_type_check" CHECK ("platform_announcements"."type" IN ('notice','announcement')),
	CONSTRAINT "platform_announcements_audience_check" CHECK ("platform_announcements"."audience" IN ('platform','allTenants','organizations'))
);
--> statement-breakpoint
ALTER TABLE "platform_announcement_publications" ADD CONSTRAINT "platform_announcement_publications_announcement_id_platform_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."platform_announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_announcement_reads" ADD CONSTRAINT "platform_announcement_reads_publication_id_platform_announcement_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."platform_announcement_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_announcement_resources" ADD CONSTRAINT "platform_announcement_resources_announcement_id_platform_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."platform_announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_publications_announcement_idx" ON "platform_announcement_publications" USING btree ("announcement_id","published_at");--> statement-breakpoint
CREATE INDEX "platform_announcement_reads_user_idx" ON "platform_announcement_reads" USING btree ("user_id","publication_id");--> statement-breakpoint
CREATE INDEX "platform_announcement_resources_announcement_idx" ON "platform_announcement_resources" USING btree ("announcement_id");--> statement-breakpoint
CREATE INDEX "platform_announcements_updated_idx" ON "platform_announcements" USING btree ("updated_at","id");
--> statement-breakpoint
ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_announcements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_announcement_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_announcement_publications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_announcement_reads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_announcement_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_announcement_resources FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_announcements_executor ON public.platform_announcements TO platform_executor USING(true) WITH CHECK(true);
CREATE POLICY platform_publications_executor ON public.platform_announcement_publications TO platform_executor USING(true) WITH CHECK(true);
CREATE POLICY platform_reads_executor ON public.platform_announcement_reads TO platform_executor USING(true) WITH CHECK(true);
CREATE POLICY platform_announcement_resources_executor ON public.platform_announcement_resources TO platform_executor USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON public.platform_announcements TO platform_executor;
GRANT SELECT,INSERT ON public.platform_announcement_publications,public.platform_announcement_reads TO platform_executor;
GRANT SELECT,INSERT,DELETE ON public.platform_announcement_resources TO platform_executor;
GRANT SELECT ON public.platform_resources TO platform_executor;
GRANT SELECT(id,organization_id,user_id) ON public.member TO platform_executor;
GRANT EXECUTE ON FUNCTION public.require_active_organization(uuid) TO platform_executor;
GRANT SELECT(id,name,email) ON public."user" TO platform_executor;
GRANT SELECT(organization_id,status) ON public.organization_status TO platform_executor;
CREATE POLICY audit_events_announcement_management_insert ON public.audit_events FOR INSERT TO platform_executor WITH CHECK(
 scope='platform' AND organization_id IS NULL AND NOT tenant_visible AND event_code IN(
 'platform.announcement_list','platform.announcement_get','platform.announcement_create','platform.announcement_update',
 'platform.announcement_publish','platform.announcement_withdraw','platform.announcement_delete','platform.announcement_readers','platform.announcement_export_page'));
CREATE POLICY audit_events_announcement_recipient_insert ON public.audit_events FOR INSERT TO platform_executor WITH CHECK(
 scope='user' AND NOT tenant_visible AND event_code IN('user.announcement_get','user.announcement_read'));
GRANT CREATE ON SCHEMA public TO platform_executor;
--> statement-breakpoint
CREATE FUNCTION public.platform_announcement_summary(p_row public.platform_announcements) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
 SELECT jsonb_build_object('id',p_row.id,'title',p_row.title,'type',p_row.type,'status',p_row.status,
  'audience',p_row.audience,'version',p_row.version,'publicationId',p_row.publication_id,'publishedAt',p_row.published_at,
  'createdAt',p_row.created_at,'updatedAt',p_row.updated_at,
  'authorName',(SELECT u.name FROM public."user" u WHERE u.id=p_row.author_id));
$f$;
ALTER FUNCTION public.platform_announcement_summary(public.platform_announcements) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_announcement_summary(public.platform_announcements) FROM PUBLIC;

CREATE FUNCTION public.platform_announcement_attachments(p_ids uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
 SELECT coalesce(jsonb_agg(jsonb_build_object('fileId',r.id,'versionId',r.id,'name',r.name,'mimeType',r.mime_type,'byteSize',r.bytes)
  ORDER BY a.ordinality),'[]'::jsonb) FROM unnest(p_ids) WITH ORDINALITY a(id,ordinality)
 JOIN public.platform_resources r ON r.id=a.id AND r.purpose='announcement';
$f$;
ALTER FUNCTION public.platform_announcement_attachments(uuid[]) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_announcement_attachments(uuid[]) FROM PUBLIC;

CREATE FUNCTION public.platform_announcement_command(p_actor uuid,p_session uuid,p_operation text,p_id uuid,p_input jsonb,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_row public.platform_announcements; v_result jsonb; v_items jsonb; v_total bigint; v_pub uuid;
 v_page integer:=coalesce((p_input->>'page')::integer,1); v_size integer:=coalesce((p_input->>'pageSize')::integer,20);
 v_action text; v_attachments uuid[]; v_resources uuid[]; v_orgs uuid[]; v_resource uuid; v_binding uuid; v_uploader uuid;
BEGIN
 v_action:=CASE p_operation WHEN 'list' THEN 'read' WHEN 'export-page' THEN 'export' WHEN 'get' THEN 'read'
  WHEN 'readers' THEN 'readers' WHEN 'create' THEN 'create' WHEN 'update' THEN 'update'
  WHEN 'publish' THEN 'publish' WHEN 'withdraw' THEN 'publish' WHEN 'delete' THEN 'delete' ELSE NULL END;
 IF p_operation='media' THEN
  -- 尚未绑定的上传只对创建者可见；绑定后按公告管理读取权限判断。
  SELECT ar.announcement_id INTO v_binding FROM public.platform_announcement_resources ar WHERE ar.resource_id=p_id;
  IF v_binding IS NULL THEN
   SELECT r.uploaded_by INTO v_uploader FROM public.platform_resources r WHERE r.id=p_id AND r.purpose='announcement';
   IF v_uploader IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   IF EXISTS(SELECT 1 FROM public.read_platform_access(p_actor,p_session) a WHERE 'platform.announcement:create'=ANY(a.permissions)) THEN
    PERFORM public.require_platform_action(p_actor,p_session,'platform.announcement:create');
   ELSE PERFORM public.require_platform_action(p_actor,p_session,'platform.announcement:update'); END IF;
  ELSE PERFORM public.require_platform_action(p_actor,p_session,'platform.announcement:read');
   IF NOT EXISTS(SELECT 1 FROM public.platform_announcements a WHERE a.id=v_binding AND a.deleted_at IS NULL) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  RETURN jsonb_build_object('id',p_id);
 END IF;
 IF v_action IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 PERFORM public.require_platform_action(p_actor,p_session,'platform.announcement:'||v_action);
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
     v_attachments:=ARRAY(SELECT (value->>'fileId')::uuid FROM jsonb_array_elements(p_input->'attachments'));
     v_resources:=ARRAY(SELECT DISTINCT id FROM (
       SELECT unnest(v_attachments) id UNION ALL
       SELECT (value->>'fileId')::uuid FROM jsonb_path_query(p_input->'content','$.**.attrs') AS nodes(value) WHERE value ? 'fileId'
     ) refs ORDER BY id);
     FOREACH v_resource IN ARRAY v_resources LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('announcement-resource:'||v_resource::text,0));
      SELECT uploaded_by INTO v_uploader FROM public.platform_resources r WHERE r.id=v_resource AND r.purpose='announcement';
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      SELECT announcement_id INTO v_binding FROM public.platform_announcement_resources WHERE resource_id=v_resource;
      IF (v_binding IS NOT NULL AND v_binding<>p_id) OR (v_binding IS NULL AND v_uploader<>p_actor) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
     END LOOP;
     DELETE FROM public.platform_announcement_resources WHERE announcement_id=p_id AND NOT(resource_id=ANY(v_resources));
     INSERT INTO public.platform_announcement_resources(resource_id,announcement_id) SELECT unnest(v_resources),p_id ON CONFLICT DO NOTHING;
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
ALTER FUNCTION public.platform_announcement_command(uuid,uuid,text,uuid,jsonb,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_announcement_command(uuid,uuid,text,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_announcement_command(uuid,uuid,text,uuid,jsonb,text) TO app_runtime;
--> statement-breakpoint
CREATE FUNCTION public.platform_announcement_inbox(p_actor uuid,p_session uuid,p_organization uuid,p_operation text,p_id uuid,p_input jsonb,p_request text)
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
 IF p_operation='media' THEN SELECT announcement_id INTO v_id FROM public.platform_announcement_resources WHERE resource_id=p_id; END IF;
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
ALTER FUNCTION public.platform_announcement_inbox(uuid,uuid,uuid,text,uuid,jsonb,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_announcement_inbox(uuid,uuid,uuid,text,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_announcement_inbox(uuid,uuid,uuid,text,uuid,jsonb,text) TO app_runtime;
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
      'platform.employee_created','platform.user_password_login_unlocked','platform.user_created', 'platform.user_updated', 'platform.user_suspended', 'platform.user_resumed', 'platform.user_password_reset_requested', 'platform.session_revoked', 'platform.sessions_queried', 'platform.login_logs_queried'] || ARRAY['platform.announcement_list','platform.announcement_get','platform.announcement_create','platform.announcement_update','platform.announcement_publish','platform.announcement_withdraw','platform.announcement_delete','platform.announcement_readers','platform.announcement_export_page','platform.task_submitted','platform.task_completed','platform.task_failed','platform.resource_created','platform.resource_read'] || public.platform_system_audit_event_codes()
    WHEN 'tenant' THEN ARRAY['member.invited', 'invitation.resent', 'invitation.accepted', 'invitation.rejected',
      'invitation.canceled', 'member.role_changed', 'member.removed', 'member.left',
      'role.created', 'role.updated', 'role.deleted', 'organization.settings_updated',
      'invitation.delivery_smtp_accepted', 'invitation.delivery_failed', 'invitation.delivery_unknown']
    ELSE ARRAY[]::text[]
  END;
$function$;
