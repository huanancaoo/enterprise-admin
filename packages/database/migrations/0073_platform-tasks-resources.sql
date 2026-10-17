-- platform-resources:start
CREATE TABLE "platform_resources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_resources_purpose_check" CHECK ("platform_resources"."purpose" IN ('announcement','task-input','task-output')),
	CONSTRAINT "platform_resources_name_check" CHECK (octet_length(btrim("platform_resources"."name")) BETWEEN 1 AND 255),
	CONSTRAINT "platform_resources_mime_check" CHECK ("platform_resources"."mime_type" ~ '^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$'),
	CONSTRAINT "platform_resources_bytes_check" CHECK ("platform_resources"."bytes" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "platform_resources_hash_check" CHECK ("platform_resources"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "platform_resources_uploader_created_idx" ON "platform_resources" USING btree ("uploaded_by","created_at");
--> statement-breakpoint
ALTER TABLE public.platform_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_resources FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_resources FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT SELECT, INSERT ON public.platform_resources TO platform_executor;
CREATE POLICY platform_resources_executor_read ON public.platform_resources FOR SELECT TO platform_executor USING (true);
CREATE POLICY platform_resources_executor_insert ON public.platform_resources FOR INSERT TO platform_executor WITH CHECK (true);
CREATE POLICY audit_events_platform_resource_insert ON public.audit_events FOR INSERT TO platform_executor
WITH CHECK (scope = 'platform' AND organization_id IS NULL AND NOT tenant_visible
  AND event_code IN ('platform.resource_created','platform.resource_read'));
--> statement-breakpoint
CREATE FUNCTION public.platform_resource_projection(p_resource public.platform_resources)
RETURNS jsonb LANGUAGE sql STABLE STRICT SET search_path = pg_catalog AS $function$
  SELECT jsonb_build_object('id',(p_resource).id,'purpose',(p_resource).purpose,'uploadedBy',(p_resource).uploaded_by,
    'name',(p_resource).name,'mimeType',(p_resource).mime_type,'bytes',(p_resource).bytes,
    'sha256',(p_resource).sha256,'createdAt',(p_resource).created_at);
$function$;
--> statement-breakpoint
CREATE FUNCTION public.require_platform_resource_write(p_actor uuid,p_session uuid,p_purpose text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_permissions text[];
BEGIN
  IF p_purpose IS NULL OR p_purpose NOT IN ('announcement','task-input','task-output') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  IF p_purpose = 'announcement' THEN
    SELECT permissions INTO v_permissions FROM public.read_platform_access(p_actor,p_session);
    IF NOT FOUND OR NOT ('platform.announcement:create'=ANY(v_permissions) OR 'platform.announcement:update'=ANY(v_permissions)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  ELSE
    PERFORM public.require_platform_action(p_actor,p_session,
      CASE p_purpose WHEN 'task-input' THEN 'platform.authorization:manage' ELSE 'platform.task:read' END);
  END IF;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.prepare_platform_resource(p_actor uuid,p_session uuid,p_purpose text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  PERFORM public.require_platform_resource_write(p_actor,p_session,p_purpose);
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.create_platform_resource(p_actor uuid,p_session uuid,p_id uuid,p_purpose text,p_name text,p_mime text,p_bytes bigint,p_sha256 text,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_resource public.platform_resources;
BEGIN
  PERFORM public.require_platform_resource_write(p_actor,p_session,p_purpose);
  IF p_id IS NULL OR p_name IS NULL OR p_name <> btrim(p_name) OR octet_length(p_name) NOT BETWEEN 1 AND 255
    OR p_mime IS NULL OR p_mime !~ '^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$'
    OR p_bytes IS NULL OR p_bytes NOT BETWEEN 0 AND 9007199254740991
    OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
    OR p_request IS NULL OR length(btrim(p_request)) = 0
  THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  INSERT INTO public.platform_resources(id,purpose,uploaded_by,name,mime_type,bytes,sha256)
    VALUES(p_id,p_purpose,p_actor,p_name,p_mime,p_bytes,p_sha256) RETURNING * INTO v_resource;
  BEGIN
    INSERT INTO public.audit_events(scope,event_code,actor_id,resource_type,resource_id,result,request_id,fields)
    VALUES('platform','platform.resource_created',p_actor,'platform_resource',p_id,'succeeded',p_request,
      jsonb_build_object('purpose',p_purpose,'bytes',p_bytes));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN public.platform_resource_projection(v_resource);
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.get_platform_resource(p_actor uuid,p_session uuid,p_id uuid,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_resource public.platform_resources;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.read_platform_access(p_actor,p_session)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_request IS NULL OR length(btrim(p_request)) = 0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  SELECT * INTO v_resource FROM public.platform_resources WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_resource.purpose = 'announcement' THEN
    PERFORM public.require_platform_resource_write(p_actor,p_session,'announcement');
  ELSE
    PERFORM public.require_platform_action(p_actor,p_session,'platform.task:read');
    IF v_resource.uploaded_by <> p_actor THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  END IF;
  BEGIN
    INSERT INTO public.audit_events(scope,event_code,actor_id,resource_type,resource_id,result,request_id,fields)
    VALUES('platform','platform.resource_read',p_actor,'platform_resource',p_id,'succeeded',p_request,
      jsonb_build_object('purpose',v_resource.purpose));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN public.platform_resource_projection(v_resource);
END;
$function$;
--> statement-breakpoint
-- HTTP 读取必须先经公告/任务的领域授权；此入口只给内部物理服务投影定位事实。
CREATE FUNCTION public.get_platform_resource_internal(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_resource public.platform_resources;
BEGIN
  SELECT * INTO v_resource FROM public.platform_resources WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN public.platform_resource_projection(v_resource);
END;
$function$;
--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.platform_resource_projection(public.platform_resources) OWNER TO platform_executor;
ALTER FUNCTION public.require_platform_resource_write(uuid,uuid,text) OWNER TO platform_executor;
ALTER FUNCTION public.prepare_platform_resource(uuid,uuid,text) OWNER TO platform_executor;
ALTER FUNCTION public.create_platform_resource(uuid,uuid,uuid,text,text,text,bigint,text,text) OWNER TO platform_executor;
ALTER FUNCTION public.get_platform_resource(uuid,uuid,uuid,text) OWNER TO platform_executor;
ALTER FUNCTION public.get_platform_resource_internal(uuid) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.platform_resource_projection(public.platform_resources),
  public.require_platform_resource_write(uuid,uuid,text),public.prepare_platform_resource(uuid,uuid,text),
  public.create_platform_resource(uuid,uuid,uuid,text,text,text,bigint,text,text),
  public.get_platform_resource(uuid,uuid,uuid,text),public.get_platform_resource_internal(uuid)
  FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.prepare_platform_resource(uuid,uuid,text),
  public.create_platform_resource(uuid,uuid,uuid,text,text,text,bigint,text,text),
  public.get_platform_resource(uuid,uuid,uuid,text),public.get_platform_resource_internal(uuid) TO app_runtime;
-- platform-resources:end

--> statement-breakpoint
-- platform-tasks:start
CREATE TABLE "platform_task_rows" (
	"task_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"status" text NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "platform_task_rows_task_id_row_number_pk" PRIMARY KEY("task_id","row_number"),
	CONSTRAINT "platform_task_rows_number_check" CHECK ("platform_task_rows"."row_number" BETWEEN 2 AND 10001),
	CONSTRAINT "platform_task_rows_status_check" CHECK ("platform_task_rows"."status" IN ('created','updated','granted','skipped','failed')),
	CONSTRAINT "platform_task_rows_result_check" CHECK (jsonb_typeof("platform_task_rows"."result") = 'object' AND "platform_task_rows"."result" ? 'outcome' AND jsonb_typeof("platform_task_rows"."result"->'outcome') = 'string' AND "platform_task_rows"."result"->>'outcome' = "platform_task_rows"."status" AND (("platform_task_rows"."status" = 'failed' AND "platform_task_rows"."result" ? 'code' AND jsonb_typeof("platform_task_rows"."result"->'code') = 'string' AND "platform_task_rows"."result"->>'code' ~ '^[A-Z_]{1,100}$' AND "platform_task_rows"."result" - 'outcome' - 'code' = '{}'::jsonb) OR ("platform_task_rows"."status" <> 'failed' AND "platform_task_rows"."result" - 'outcome' = '{}'::jsonb)))
);
--> statement-breakpoint
CREATE TABLE "platform_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"resource" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"intent_fingerprint" text NOT NULL,
	"input" jsonb NOT NULL,
	"credential_ciphertext" text,
	"result_resource_id" uuid,
	"result" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text NOT NULL,
	CONSTRAINT "platform_tasks_actor_idempotency_unique" UNIQUE("actor_id","idempotency_key"),
	CONSTRAINT "platform_tasks_kind_check" CHECK ("platform_tasks"."kind" IN ('export','employee-import')),
	CONSTRAINT "platform_tasks_resource_check" CHECK ("platform_tasks"."resource" IN ('employees','roles','menus','departments','posts','dictionaries','dictionary-items','parameters','users','organizations','login-events','sessions','audit-events')),
	CONSTRAINT "platform_tasks_status_check" CHECK ("platform_tasks"."status" IN ('pending','queued','running','completed','failed','rejected')),
	CONSTRAINT "platform_tasks_idempotency_check" CHECK (length(btrim("platform_tasks"."idempotency_key")) BETWEEN 1 AND 200),
	CONSTRAINT "platform_tasks_fingerprint_check" CHECK ("platform_tasks"."intent_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "platform_tasks_input_check" CHECK (jsonb_typeof("platform_tasks"."input") = 'object'),
	CONSTRAINT "platform_tasks_credential_check" CHECK (("platform_tasks"."kind" = 'export' AND "platform_tasks"."credential_ciphertext" IS NULL) OR ("platform_tasks"."kind" = 'employee-import' AND "platform_tasks"."resource" = 'employees' AND (("platform_tasks"."status" IN ('pending','queued','running') AND "platform_tasks"."credential_ciphertext" IS NOT NULL AND length("platform_tasks"."credential_ciphertext") > 0) OR ("platform_tasks"."status" IN ('completed','failed','rejected') AND "platform_tasks"."credential_ciphertext" IS NULL)))),
	CONSTRAINT "platform_tasks_result_check" CHECK (("platform_tasks"."status" = 'completed' AND "platform_tasks"."result_resource_id" IS NOT NULL AND "platform_tasks"."error_code" IS NULL) OR ("platform_tasks"."status" IN ('failed','rejected') AND "platform_tasks"."result_resource_id" IS NULL AND "platform_tasks"."result" IS NULL AND "platform_tasks"."error_code" IS NOT NULL AND "platform_tasks"."error_code" ~ '^[A-Z_]{1,100}$') OR ("platform_tasks"."status" IN ('pending','queued','running') AND "platform_tasks"."result_resource_id" IS NULL AND "platform_tasks"."result" IS NULL AND "platform_tasks"."error_code" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "platform_task_rows" ADD CONSTRAINT "platform_task_rows_task_id_platform_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."platform_tasks"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_tasks" ADD CONSTRAINT "platform_tasks_result_resource_id_platform_resources_id_fk" FOREIGN KEY ("result_resource_id") REFERENCES "public"."platform_resources"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "platform_tasks_actor_created_id_idx" ON "platform_tasks" USING btree ("actor_id","created_at","id");
--> statement-breakpoint
CREATE INDEX "platform_tasks_status_updated_id_idx" ON "platform_tasks" USING btree ("status","updated_at","id");
--> statement-breakpoint
ALTER TABLE public.platform_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_task_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_task_rows FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_tasks,public.platform_task_rows FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT SELECT,INSERT,UPDATE ON public.platform_tasks TO platform_executor;
GRANT SELECT,INSERT ON public.platform_task_rows TO platform_executor;
CREATE POLICY platform_tasks_executor ON public.platform_tasks TO platform_executor USING(true) WITH CHECK(true);
CREATE POLICY platform_task_rows_executor ON public.platform_task_rows TO platform_executor USING(true) WITH CHECK(true);
--> statement-breakpoint
CREATE FUNCTION public.platform_task_audit_event_codes()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
  SELECT ARRAY['platform.task_submitted','platform.task_completed','platform.task_failed']::text[];
$f$;
CREATE POLICY audit_events_platform_tasks_insert ON public.audit_events FOR INSERT TO platform_executor
  WITH CHECK(scope='platform' AND organization_id IS NULL AND NOT tenant_visible
    AND resource_type='task' AND resource_id IS NOT NULL AND fields='{}'::jsonb
    AND ((event_code IN ('platform.task_submitted','platform.task_completed') AND result='succeeded')
      OR (event_code='platform.task_failed' AND result IN ('failed','denied'))));
GRANT INSERT(scope,event_code,actor_id,resource_type,resource_id,result,request_id,fields,occurred_at) ON public.audit_events TO platform_executor;
CREATE FUNCTION public.append_platform_task_audit(p_actor uuid,p_task uuid,p_status text,p_request text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
BEGIN
  IF p_actor IS NULL OR p_task IS NULL OR p_status IS NULL OR
    p_status NOT IN ('submitted','completed','failed','rejected') OR p_request IS NULL OR length(btrim(p_request))=0
  THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  BEGIN
    -- 日志只记任务的管理事实，导入内容与临时凭据不进入审计。
    INSERT INTO public.audit_events(scope,event_code,actor_id,resource_type,resource_id,result,request_id,fields,occurred_at)
    VALUES('platform','platform.task_'||CASE p_status WHEN 'rejected' THEN 'failed' ELSE p_status END,
      p_actor,'task',p_task,CASE p_status WHEN 'failed' THEN 'failed' WHEN 'rejected' THEN 'denied' ELSE 'succeeded' END,
      p_request,'{}'::jsonb,clock_timestamp());
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
END;
$f$;
--> statement-breakpoint
CREATE FUNCTION public.platform_task_projection(p_task public.platform_tasks)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
  SELECT jsonb_build_object('id',p_task.id,'actorId',p_task.actor_id,'kind',p_task.kind,
    'resource',p_task.resource,'status',p_task.status,'createdAt',p_task.created_at,'updatedAt',p_task.updated_at,
    'errorCode',p_task.error_code,'resultAvailable',p_task.status='completed' AND p_task.result_resource_id IS NOT NULL,
    'result',p_task.result);
$f$;
CREATE FUNCTION public.platform_task_action(p_kind text,p_resource text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE v_resource text;
BEGIN
  IF p_kind='employee-import' AND p_resource='employees' THEN RETURN 'platform.authorization:manage'; END IF;
  IF p_kind IS DISTINCT FROM 'export' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  v_resource:=CASE p_resource
    WHEN 'employees' THEN 'employee' WHEN 'roles' THEN 'role' WHEN 'menus' THEN 'menu'
    WHEN 'departments' THEN 'department' WHEN 'posts' THEN 'post' WHEN 'dictionaries' THEN 'dictionary'
    WHEN 'dictionary-items' THEN 'dictionary' WHEN 'parameters' THEN 'parameter' WHEN 'users' THEN 'user'
    WHEN 'organizations' THEN 'organization' WHEN 'login-events' THEN 'login' WHEN 'sessions' THEN 'session'
    WHEN 'audit-events' THEN 'audit' END;
  IF v_resource IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  RETURN 'platform.'||v_resource||':export';
END;
$f$;
--> statement-breakpoint
CREATE FUNCTION public.platform_task_command(p_actor uuid,p_session uuid,p_operation text,p_id uuid,p_input jsonb,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE
  v_task public.platform_tasks%ROWTYPE; v_existing public.platform_tasks%ROWTYPE;
  v_kind text; v_resource text; v_action text; v_key text; v_fingerprint text; v_input jsonb;
  v_page integer; v_size integer; v_result jsonb; v_resource_id uuid; v_status text; v_error text;
BEGIN
  IF p_actor IS NULL OR p_session IS NULL OR p_operation IS NULL OR
    p_operation NOT IN ('submit','find','list','get','download','claim','queued','complete','fail') OR
    p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR p_request IS NULL OR length(btrim(p_request))=0
  THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF p_operation='submit' THEN
    v_kind:=p_input->>'kind'; v_resource:=p_input->>'resource';
    v_action:=public.platform_task_action(v_kind,v_resource);
    v_key:=p_input->>'idempotencyKey'; v_fingerprint:=p_input->>'intentFingerprint'; v_input:=p_input->'input';
    IF v_key IS NULL OR length(btrim(v_key)) NOT BETWEEN 1 AND 200 OR v_fingerprint IS NULL OR
      v_fingerprint !~ '^[0-9a-f]{64}$'
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    PERFORM public.lock_platform_authorization();
    PERFORM public.require_platform_action(p_actor,p_session,'platform.task:read');
    PERFORM public.require_platform_action(p_actor,p_session,'platform.task:create');
    PERFORM public.require_platform_action(p_actor,p_session,v_action);
    SELECT * INTO v_existing FROM public.platform_tasks WHERE actor_id=p_actor AND idempotency_key=v_key FOR UPDATE;
    IF FOUND THEN
      IF v_existing.intent_fingerprint<>v_fingerprint OR v_existing.kind<>v_kind OR v_existing.resource<>v_resource
      THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
      RETURN public.platform_task_projection(v_existing);
    END IF;
    IF v_input IS NULL OR jsonb_typeof(v_input)<>'object' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF v_kind='export' THEN
      IF v_input-'filters'<>'{}'::jsonb OR jsonb_typeof(v_input->'filters') IS DISTINCT FROM 'object'
        OR p_input->>'credentialCiphertext' IS NOT NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_input->'filters') k WHERE k NOT IN
        ('q','status','departmentId','roleId','dictionaryId','parentId','sortBy','sortOrder','method','result','userId','actorId','eventCode','organizationId','from','to'))
      THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    ELSE
      IF v_input-'inputResourceId'-'updateExisting'<>'{}'::jsonb OR NOT(v_input ? 'inputResourceId') OR
        jsonb_typeof(v_input->'updateExisting') IS DISTINCT FROM 'boolean' OR
        p_input->>'credentialCiphertext' IS NULL OR length(p_input->>'credentialCiphertext')=0
      THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
      v_resource_id:=(v_input->>'inputResourceId')::uuid;
      IF NOT EXISTS(SELECT 1 FROM public.platform_resources WHERE id=v_resource_id AND uploaded_by=p_actor AND purpose='task-input')
      THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    END IF;
    INSERT INTO public.platform_tasks(id,actor_id,session_id,kind,resource,idempotency_key,intent_fingerprint,input,credential_ciphertext,request_id)
    VALUES(COALESCE(p_id,gen_random_uuid()),p_actor,p_session,v_kind,v_resource,v_key,v_fingerprint,v_input,p_input->>'credentialCiphertext',p_request)
    RETURNING * INTO v_task;
    PERFORM public.append_platform_task_audit(p_actor,v_task.id,'submitted',p_request);
    RETURN public.platform_task_projection(v_task);
  END IF;
  IF p_operation='find' THEN
    PERFORM public.require_platform_action(p_actor,p_session,'platform.task:read');
    v_key:=p_input->>'idempotencyKey';
    IF v_key IS NULL OR length(btrim(v_key)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    SELECT * INTO v_task FROM public.platform_tasks WHERE actor_id=p_actor AND idempotency_key=v_key;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN public.platform_task_projection(v_task);
  END IF;
  IF p_operation='list' THEN
    PERFORM public.require_platform_action(p_actor,p_session,'platform.task:read');
    v_page:=COALESCE((p_input->>'page')::integer,1);v_size:=COALESCE((p_input->>'pageSize')::integer,20);
    IF v_page<1 OR v_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    WITH owned AS(SELECT * FROM public.platform_tasks WHERE actor_id=p_actor),
    selected AS(SELECT * FROM owned ORDER BY created_at DESC,id DESC LIMIT v_size OFFSET(v_page::bigint-1)*v_size)
    SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.platform_task_projection(s::public.platform_tasks) ORDER BY s.created_at DESC,s.id DESC) FROM selected s),'[]'::jsonb),
      'page',v_page,'pageSize',v_size,'total',(SELECT count(*) FROM owned)) INTO v_result;
    RETURN v_result;
  END IF;
  IF p_id IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF p_operation IN ('get','download') THEN
    PERFORM public.require_platform_action(p_actor,p_session,'platform.task:read');
    SELECT * INTO v_task FROM public.platform_tasks WHERE id=p_id AND actor_id=p_actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF p_operation='get' THEN RETURN public.platform_task_projection(v_task); END IF;
    PERFORM public.require_platform_action(p_actor,p_session,'platform.task:download');
    PERFORM public.require_platform_action(p_actor,p_session,public.platform_task_action(v_task.kind,v_task.resource));
    IF v_task.status<>'completed' OR v_task.result_resource_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    RETURN jsonb_build_object('resultResourceId',v_task.result_resource_id);
  END IF;
  -- 与幂等提交共用授权锁→任务行锁顺序，避免重复提交和 Worker 结算互相等待。
  IF p_operation<>'fail' THEN PERFORM public.lock_platform_authorization(); END IF;
  -- 队列结算只接受任务最初绑定的身份和会话，不能用另一个有效会话接管任务。
  SELECT * INTO v_task FROM public.platform_tasks WHERE id=p_id AND actor_id=p_actor AND session_id=p_session FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_operation='fail' THEN
    v_status:=p_input->>'status';v_error:=p_input->>'errorCode';
    IF v_status IS NULL OR v_status NOT IN ('failed','rejected') OR v_error IS NULL OR v_error !~ '^[A-Z_]{1,100}$'
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF v_task.status IN ('completed','failed','rejected') THEN RETURN public.platform_task_projection(v_task); END IF;
    -- 撤权后必须仍能结算原绑定任务，否则临时凭据会因鉴权失败永久保留。
    UPDATE public.platform_tasks SET status=v_status,error_code=v_error,credential_ciphertext=NULL,
      result_resource_id=NULL,result=NULL,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_task;
    PERFORM public.append_platform_task_audit(p_actor,p_id,v_status,p_request);
    RETURN public.platform_task_projection(v_task);
  END IF;
  PERFORM public.require_platform_action(p_actor,p_session,'platform.task:read');
  PERFORM public.require_platform_action(p_actor,p_session,public.platform_task_action(v_task.kind,v_task.resource));
  IF v_task.status IN ('completed','failed','rejected') THEN RETURN public.platform_task_projection(v_task); END IF;
  IF p_operation='claim' THEN
    UPDATE public.platform_tasks SET status='running',updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_task;
    RETURN public.platform_task_projection(v_task)||jsonb_build_object('input',v_task.input,
      'credentialCiphertext',v_task.credential_ciphertext,'sessionId',v_task.session_id);
  END IF;
  IF p_operation='queued' THEN
    IF v_task.status='pending' THEN
      UPDATE public.platform_tasks SET status='queued',updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_task;
    END IF;
    RETURN public.platform_task_projection(v_task);
  END IF;
  IF v_task.status<>'running' THEN RAISE EXCEPTION 'TASK_NOT_RUNNING'; END IF;
  v_resource_id:=(p_input->>'resultResourceId')::uuid;
  IF v_resource_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.platform_resources WHERE id=v_resource_id AND uploaded_by=p_actor AND purpose='task-output')
  THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_result:=NULLIF(p_input->'result','null'::jsonb);
  IF v_result IS NOT NULL THEN
    IF jsonb_typeof(v_result)<>'object' OR v_result-'total'-'created'-'updated'-'granted'-'skipped'-'failed'-'issues'<>'{}'::jsonb OR
      NOT(v_result ?& ARRAY['total','created','updated','granted','skipped','failed','issues']) OR jsonb_typeof(v_result->'issues')<>'array'
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_each(v_result-'issues') e WHERE jsonb_typeof(e.value)<>'number' OR (e.value#>>'{}') !~ '^[0-9]+$') OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(v_result->'issues') i WHERE
        jsonb_typeof(i)<>'object' OR i-'rowNumber'-'code'<>'{}'::jsonb OR NOT(i ?& ARRAY['rowNumber','code']) OR
        jsonb_typeof(i->'rowNumber')<>'number' OR i->>'rowNumber' !~ '^[1-9][0-9]*$' OR
        jsonb_typeof(i->'code')<>'string' OR i->>'code' !~ '^[A-Z_]{1,100}$')
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  END IF;
  UPDATE public.platform_tasks SET status='completed',result_resource_id=v_resource_id,result=v_result,
    credential_ciphertext=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_task;
  PERFORM public.append_platform_task_audit(p_actor,p_id,'completed',p_request);
  RETURN public.platform_task_projection(v_task);
END;
$f$;
--> statement-breakpoint
CREATE FUNCTION public.platform_tasks_pending(p_after uuid DEFAULT NULL,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE v_result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  -- UUID 游标遍历所有未终结任务；重试中的旧任务不能一直占住首批名额，阻塞后续任务。
  SELECT COALESCE(jsonb_agg(jsonb_build_object('scope','platform','taskId',id,'actorId',actor_id,
    'sessionId',session_id,'requestId',request_id) ORDER BY id),'[]'::jsonb)
  INTO v_result FROM(SELECT id,actor_id,session_id,request_id FROM public.platform_tasks
    WHERE status IN ('pending','queued','running') AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT p_limit) tasks;
  RETURN v_result;
END;
$f$;
--> statement-breakpoint
CREATE FUNCTION public.platform_task_employee_row(p_actor uuid,p_session uuid,p_task uuid,p_row integer,p_input jsonb,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE
  v_task public.platform_tasks%ROWTYPE; v_result jsonb; v_employee jsonb; v_lookup jsonb; v_current jsonb;
  v_user uuid; v_update boolean; v_error text;
BEGIN
  IF p_actor IS NULL OR p_session IS NULL OR p_task IS NULL OR p_row IS NULL OR p_row NOT BETWEEN 2 AND 10001 OR
    p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR p_request IS NULL OR length(btrim(p_request))=0
  THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  PERFORM public.lock_platform_authorization();
  SELECT * INTO v_task FROM public.platform_tasks WHERE id=p_task AND actor_id=p_actor AND session_id=p_session FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM public.require_platform_action(p_actor,p_session,'platform.task:read');
  PERFORM public.require_platform_action(p_actor,p_session,'platform.authorization:manage');
  IF v_task.kind<>'employee-import' OR v_task.status<>'running' THEN RAISE EXCEPTION 'TASK_NOT_RUNNING'; END IF;
  SELECT result INTO v_result FROM public.platform_task_rows WHERE task_id=p_task AND row_number=p_row;
  IF FOUND THEN RETURN v_result; END IF;
  v_employee:=p_input->'employee';v_update:=(v_task.input->>'updateExisting')::boolean;
  IF jsonb_typeof(v_employee) IS DISTINCT FROM 'object' OR v_employee-'name'-'email'-'departmentId'-'postIds'-'roleIds'<>'{}'::jsonb OR
    NOT(v_employee ?& ARRAY['name','email','departmentId','postIds','roleIds']) OR
    jsonb_typeof(p_input->'updateExisting') IS DISTINCT FROM 'boolean' OR (p_input->>'updateExisting')::boolean IS DISTINCT FROM v_update
  THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  BEGIN
    -- 同一事务持有任务行和授权锁：员工成功写入与行收据共同提交，重试不会再次创建或改写员工。
    v_lookup:=public.platform_system_identity(p_actor,p_session,'employee','import-lookup',NULL,jsonb_build_object('email',v_employee->>'email'),p_request);
    v_user:=(v_lookup->>'userId')::uuid;
    IF v_user IS NULL THEN
      IF p_input->>'passwordHash' IS NULL OR length(p_input->>'passwordHash')=0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
      PERFORM public.platform_system_identity(p_actor,p_session,'employee','create',NULL,
        v_employee||jsonb_build_object('mode','create','passwordHash',p_input->>'passwordHash'),p_request);
      v_result:=jsonb_build_object('outcome','created');
    ELSIF NOT(v_lookup->>'emailVerified')::boolean THEN
      v_result:=jsonb_build_object('outcome','failed','code','ACCOUNT_NOT_VERIFIED');
    ELSIF v_lookup->>'employeeId' IS NULL THEN
      PERFORM public.require_active_account(v_user);
      PERFORM public.platform_system_identity(p_actor,p_session,'employee','create',NULL,
        (v_employee-'email'-'name')||jsonb_build_object('mode','existing','userId',v_user),p_request);
      v_result:=jsonb_build_object('outcome','granted');
    ELSIF NOT v_update THEN
      v_result:=jsonb_build_object('outcome','skipped');
    ELSE
      PERFORM public.require_active_account(v_user);
      v_current:=public.platform_system_identity(p_actor,p_session,'employee','get',v_user,'{}'::jsonb,p_request);
      IF v_current->>'status'<>'active' THEN
        v_result:=jsonb_build_object('outcome','failed','code','ASSIGNMENT_INACTIVE');
      ELSE
        v_current:=public.platform_system_identity(p_actor,p_session,'employee','update',v_user,
          (v_employee-'email'-'roleIds')||jsonb_build_object('expectedVersion',v_lookup->'expectedVersion'),p_request);
        PERFORM public.platform_system_identity(p_actor,p_session,'employee','set-roles',v_user,
          jsonb_build_object('roleIds',v_employee->'roleIds','expectedVersion',v_current->'version'),p_request);
        v_result:=jsonb_build_object('outcome','updated');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_error:=CASE SQLERRM
      WHEN 'ACCOUNT_SUSPENDED' THEN 'ACCOUNT_SUSPENDED'
      WHEN 'PLATFORM_EMAIL_UNVERIFIED' THEN 'ACCOUNT_NOT_VERIFIED'
      WHEN 'VERSION_CONFLICT' THEN 'VERSION_CONFLICT'
      WHEN 'LAST_PLATFORM_SUPERADMIN' THEN 'ASSIGNMENT_NOT_ALLOWED'
      WHEN 'EMAIL_ALREADY_EXISTS' THEN 'EMPLOYEE_EXISTS'
      WHEN 'KEY_ALREADY_EXISTS' THEN 'EMPLOYEE_EXISTS'
      WHEN 'PLATFORM_ROLE_NOT_FOUND' THEN 'ROLE_NOT_FOUND'
      WHEN 'VALIDATION_ERROR' THEN 'INVALID_ASSIGNMENT'
      WHEN 'NOT_FOUND' THEN 'INVALID_ASSIGNMENT'
      ELSE NULL END;
    -- 鉴权、审计或基础设施故障中止整项任务，不能伪装成某一行的普通数据错误。
    IF v_error IS NULL THEN RAISE; END IF;
    v_result:=jsonb_build_object('outcome','failed','code',v_error);
  END;
  INSERT INTO public.platform_task_rows(task_id,row_number,status,result) VALUES(p_task,p_row,v_result->>'outcome',v_result);
  RETURN v_result;
END;
$f$;
--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.platform_task_audit_event_codes() OWNER TO platform_executor;
ALTER FUNCTION public.append_platform_task_audit(uuid,uuid,text,text) OWNER TO platform_executor;
ALTER FUNCTION public.platform_task_projection(public.platform_tasks) OWNER TO platform_executor;
ALTER FUNCTION public.platform_task_action(text,text) OWNER TO platform_executor;
ALTER FUNCTION public.platform_task_command(uuid,uuid,text,uuid,jsonb,text) OWNER TO platform_executor;
ALTER FUNCTION public.platform_tasks_pending(uuid,integer) OWNER TO platform_executor;
ALTER FUNCTION public.platform_task_employee_row(uuid,uuid,uuid,integer,jsonb,text) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.platform_task_audit_event_codes(),public.append_platform_task_audit(uuid,uuid,text,text),
  public.platform_task_projection(public.platform_tasks),public.platform_task_action(text,text),
  public.platform_task_command(uuid,uuid,text,uuid,jsonb,text),public.platform_tasks_pending(uuid,integer),
  public.platform_task_employee_row(uuid,uuid,uuid,integer,jsonb,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.platform_task_command(uuid,uuid,text,uuid,jsonb,text),public.platform_tasks_pending(uuid,integer),
  public.platform_task_employee_row(uuid,uuid,uuid,integer,jsonb,text) TO app_runtime;
-- platform-tasks:end
