CREATE TABLE "platform_employee_post" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	CONSTRAINT "platform_employee_post_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "platform_employee_profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"department_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_role_profile" (
	"role_id" uuid PRIMARY KEY NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_department" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parent_id" uuid,
	CONSTRAINT "platform_department_key_unique" UNIQUE("key"),
	CONSTRAINT "platform_department_status_check" CHECK ("platform_department"."status" IN ('active', 'disabled')),
	CONSTRAINT "platform_department_key_check" CHECK ("platform_department"."key" ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$'),
	CONSTRAINT "platform_department_name_check" CHECK (length(btrim("platform_department"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "platform_department_sort_check" CHECK ("platform_department"."sort" >= 0),
	CONSTRAINT "platform_department_parent_check" CHECK ("platform_department"."id" <> "platform_department"."parent_id")
);
--> statement-breakpoint
CREATE TABLE "platform_dictionary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"remark" text,
	CONSTRAINT "platform_dictionary_key_unique" UNIQUE("key"),
	CONSTRAINT "platform_dictionary_status_check" CHECK ("platform_dictionary"."status" IN ('active', 'disabled')),
	CONSTRAINT "platform_dictionary_key_check" CHECK ("platform_dictionary"."key" ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$'),
	CONSTRAINT "platform_dictionary_name_check" CHECK (length(btrim("platform_dictionary"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "platform_dictionary_sort_check" CHECK ("platform_dictionary"."sort" >= 0),
	CONSTRAINT "platform_dictionary_remark_check" CHECK (length("platform_dictionary"."remark") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "platform_dictionary_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dictionary_id" uuid NOT NULL,
	"value" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_dictionary_item_dictionary_value_unique" UNIQUE("dictionary_id","value"),
	CONSTRAINT "platform_dictionary_item_status_check" CHECK ("platform_dictionary_item"."status" IN ('active', 'disabled')),
	CONSTRAINT "platform_dictionary_item_sort_check" CHECK ("platform_dictionary_item"."sort" >= 0),
	CONSTRAINT "platform_dictionary_item_value_check" CHECK (length(btrim("platform_dictionary_item"."value")) BETWEEN 1 AND 500),
	CONSTRAINT "platform_dictionary_item_label_check" CHECK (length(btrim("platform_dictionary_item"."label")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "platform_iframe_origin_allowlist" (
	"origin" text PRIMARY KEY NOT NULL,
	CONSTRAINT "platform_iframe_origin_allowlist_origin_check" CHECK ("platform_iframe_origin_allowlist"."origin" ~ '^https?://[^[:space:]@/?#]+$' AND "platform_iframe_origin_allowlist"."origin" = lower("platform_iframe_origin_allowlist"."origin"))
);
--> statement-breakpoint
CREATE TABLE "platform_menu" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"route_key" text,
	"action_key" text,
	"url" text,
	"icon" text,
	"hidden" boolean DEFAULT false NOT NULL,
	CONSTRAINT "platform_menu_key_unique" UNIQUE("key"),
	CONSTRAINT "platform_menu_status_check" CHECK ("platform_menu"."status" IN ('active', 'disabled')),
	CONSTRAINT "platform_menu_key_check" CHECK ("platform_menu"."key" ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$'),
	CONSTRAINT "platform_menu_name_check" CHECK (length(btrim("platform_menu"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "platform_menu_sort_check" CHECK ("platform_menu"."sort" >= 0),
	CONSTRAINT "platform_menu_parent_check" CHECK ("platform_menu"."id" <> "platform_menu"."parent_id"),
	CONSTRAINT "platform_menu_kind_check" CHECK ("platform_menu"."kind" IN ('directory', 'page', 'action', 'external', 'iframe')),
	CONSTRAINT "platform_menu_target_check" CHECK (("platform_menu"."kind" = 'directory' AND "platform_menu"."route_key" IS NULL AND "platform_menu"."action_key" IS NULL AND "platform_menu"."url" IS NULL) OR ("platform_menu"."kind" = 'page' AND "platform_menu"."route_key" IS NOT NULL AND "platform_menu"."action_key" IS NULL AND "platform_menu"."url" IS NULL) OR ("platform_menu"."kind" = 'action' AND "platform_menu"."route_key" IS NULL AND "platform_menu"."action_key" IS NOT NULL AND "platform_menu"."url" IS NULL) OR ("platform_menu"."kind" IN ('external', 'iframe') AND "platform_menu"."route_key" IS NULL AND "platform_menu"."action_key" IS NULL AND "platform_menu"."url" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "platform_parameter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"value" text NOT NULL,
	"remark" text,
	CONSTRAINT "platform_parameter_key_unique" UNIQUE("key"),
	CONSTRAINT "platform_parameter_status_check" CHECK ("platform_parameter"."status" IN ('active', 'disabled')),
	CONSTRAINT "platform_parameter_key_check" CHECK ("platform_parameter"."key" ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$'),
	CONSTRAINT "platform_parameter_name_check" CHECK (length(btrim("platform_parameter"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "platform_parameter_sort_check" CHECK ("platform_parameter"."sort" >= 0),
	CONSTRAINT "platform_parameter_value_check" CHECK (length("platform_parameter"."value") <= 10000),
	CONSTRAINT "platform_parameter_remark_check" CHECK (length("platform_parameter"."remark") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "platform_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_post_key_unique" UNIQUE("key"),
	CONSTRAINT "platform_post_status_check" CHECK ("platform_post"."status" IN ('active', 'disabled')),
	CONSTRAINT "platform_post_key_check" CHECK ("platform_post"."key" ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$'),
	CONSTRAINT "platform_post_name_check" CHECK (length(btrim("platform_post"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "platform_post_sort_check" CHECK ("platform_post"."sort" >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform_system_cache" (
	"resource" text NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "platform_system_cache_pkey" PRIMARY KEY("resource","key"),
	CONSTRAINT "platform_system_cache_version_check" CHECK ("platform_system_cache"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "platform_system_cache_revision" (
	"resource" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "platform_system_cache_revision_resource_check" CHECK ("platform_system_cache_revision"."resource" IN ('dictionary', 'parameter')),
	CONSTRAINT "platform_system_cache_revision_version_check" CHECK ("platform_system_cache_revision"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "platform_employee_post" ADD CONSTRAINT "platform_employee_post_user_id_platform_assignment_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_assignment"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_employee_post" ADD CONSTRAINT "platform_employee_post_post_id_platform_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."platform_post"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_employee_profile" ADD CONSTRAINT "platform_employee_profile_user_id_platform_assignment_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_assignment"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_employee_profile" ADD CONSTRAINT "platform_employee_profile_department_id_platform_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."platform_department"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_role_profile" ADD CONSTRAINT "platform_role_profile_role_id_platform_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."platform_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_department" ADD CONSTRAINT "platform_department_parent_id_platform_department_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."platform_department"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_dictionary_item" ADD CONSTRAINT "platform_dictionary_item_dictionary_id_platform_dictionary_id_fk" FOREIGN KEY ("dictionary_id") REFERENCES "public"."platform_dictionary"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_menu" ADD CONSTRAINT "platform_menu_parent_id_platform_menu_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."platform_menu"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_system_cache" ADD CONSTRAINT "platform_system_cache_resource_platform_system_cache_revision_resource_fk" FOREIGN KEY ("resource") REFERENCES "public"."platform_system_cache_revision"("resource") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_department_parent_sort_idx" ON "platform_department" USING btree ("parent_id","sort","id");--> statement-breakpoint
CREATE INDEX "platform_dictionary_item_dictionary_sort_idx" ON "platform_dictionary_item" USING btree ("dictionary_id","sort","id");--> statement-breakpoint
CREATE INDEX "platform_menu_parent_sort_idx" ON "platform_menu" USING btree ("parent_id","sort","id");
--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint
-- iframe 来源属于部署信任边界；空白名单意味着当前部署没有允许内嵌的站点。

--> statement-breakpoint

INSERT INTO public.platform_system_cache_revision(resource) VALUES('dictionary'),('parameter');

--> statement-breakpoint
-- 默认导航作为部署种子，不随员工任职或角色授予重复创建。
INSERT INTO public.platform_menu(id,key,name,sort,parent_id,kind,route_key) VALUES
  ('f227a12a-5420-5723-b270-cd799d0ed7f3','sys-organizations','组织管理',10,NULL,'page','organizations'),
  ('21cd6476-7562-57b9-954f-90ee12e084c4','sys-users','全局账号',20,NULL,'page','users'),
  ('da8f27a7-38b0-5ff1-ae9d-8ed539a02316','sys-system-management','系统管理',30,NULL,'directory',NULL),
  ('297ac970-abb4-50e8-aed1-d432d9e1302c','sys-system-monitoring','系统监控',40,NULL,'directory',NULL),
  ('f3fd86db-0f8f-5dc3-88e1-70e751294664','sys-settings','平台设置',50,NULL,'page','settings'),
  ('619e4c0b-2802-5097-9f3e-93b46dd1e022','sys-employees','用户管理',10,'da8f27a7-38b0-5ff1-ae9d-8ed539a02316','page','employees'),
  ('fbb0ffe3-f9e8-553b-97e3-bce2efcab3cb','sys-roles','角色管理',20,'da8f27a7-38b0-5ff1-ae9d-8ed539a02316','page','roles'),
  ('77c1fb28-b248-5cbe-897c-9ea6ef5468ad','sys-menus','菜单管理',30,'da8f27a7-38b0-5ff1-ae9d-8ed539a02316','page','menus'),
  ('cf01fbeb-3db3-5844-8326-ef58d25eeaa9','sys-departments','部门管理',40,'da8f27a7-38b0-5ff1-ae9d-8ed539a02316','page','departments'),
  ('38e6e9ed-5fa2-5a2f-a772-77fff8974cf8','sys-posts','岗位管理',50,'da8f27a7-38b0-5ff1-ae9d-8ed539a02316','page','posts'),
  ('19980382-0c37-5371-ba2e-617f0de46d80','sys-dictionaries','字典管理',60,'da8f27a7-38b0-5ff1-ae9d-8ed539a02316','page','dictionaries'),
  ('de8399bc-7d77-5739-9460-c82ca4cda1d2','sys-parameters','参数设置',70,'da8f27a7-38b0-5ff1-ae9d-8ed539a02316','page','parameters'),
  ('ae24c306-392c-584d-b42e-39f8d36bf214','sys-announcements','通知公告',80,'da8f27a7-38b0-5ff1-ae9d-8ed539a02316','page','announcements'),
  ('4b21c469-4399-586c-aff5-15985dbe33d8','sys-logs','日志管理',90,'da8f27a7-38b0-5ff1-ae9d-8ed539a02316','directory',NULL),
  ('d8b44eea-dc37-5820-ae3d-8395dd530dd2','sys-audit-events','操作日志',10,'4b21c469-4399-586c-aff5-15985dbe33d8','page','audit-events'),
  ('71b68d38-f31f-5835-9672-2dc8576ded66','sys-login-events','登录日志',20,'4b21c469-4399-586c-aff5-15985dbe33d8','page','login-events'),
  ('7e945459-1853-5412-9973-8fce4eb7baac','sys-sessions','在线会话',10,'297ac970-abb4-50e8-aed1-d432d9e1302c','page','sessions'),
  ('66b8a94f-54ae-591e-ac9d-5c73258d9d52','sys-tasks','任务管理',20,'297ac970-abb4-50e8-aed1-d432d9e1302c','page','tasks');
--> statement-breakpoint
ALTER TABLE public.platform_menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_menu FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_menu FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE,DELETE ON public.platform_menu TO platform_executor;
CREATE POLICY platform_menu_executor ON public.platform_menu TO platform_executor USING(true) WITH CHECK(true);
--> statement-breakpoint
ALTER TABLE public.platform_department ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_department FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_department FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE,DELETE ON public.platform_department TO platform_executor;
CREATE POLICY platform_department_executor ON public.platform_department TO platform_executor USING(true) WITH CHECK(true);
--> statement-breakpoint
ALTER TABLE public.platform_post ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_post FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_post FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE,DELETE ON public.platform_post TO platform_executor;
CREATE POLICY platform_post_executor ON public.platform_post TO platform_executor USING(true) WITH CHECK(true);
--> statement-breakpoint
ALTER TABLE public.platform_dictionary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_dictionary FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_dictionary FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE,DELETE ON public.platform_dictionary TO platform_executor;
CREATE POLICY platform_dictionary_executor ON public.platform_dictionary TO platform_executor USING(true) WITH CHECK(true);
--> statement-breakpoint
ALTER TABLE public.platform_dictionary_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_dictionary_item FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_dictionary_item FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE,DELETE ON public.platform_dictionary_item TO platform_executor;
CREATE POLICY platform_dictionary_item_executor ON public.platform_dictionary_item TO platform_executor USING(true) WITH CHECK(true);
--> statement-breakpoint
ALTER TABLE public.platform_parameter ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_parameter FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_parameter FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE,DELETE ON public.platform_parameter TO platform_executor;
CREATE POLICY platform_parameter_executor ON public.platform_parameter TO platform_executor USING(true) WITH CHECK(true);
--> statement-breakpoint
ALTER TABLE public.platform_system_cache_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_system_cache_revision FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_system_cache_revision FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
GRANT SELECT,UPDATE(version) ON public.platform_system_cache_revision TO platform_executor;
CREATE POLICY platform_system_cache_revision_executor ON public.platform_system_cache_revision TO platform_executor USING(true) WITH CHECK(true);
--> statement-breakpoint
ALTER TABLE public.platform_system_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_system_cache FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_system_cache FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
GRANT SELECT,INSERT,DELETE ON public.platform_system_cache TO platform_executor;
CREATE POLICY platform_system_cache_executor ON public.platform_system_cache TO platform_executor USING(true) WITH CHECK(true);
--> statement-breakpoint
ALTER TABLE public.platform_iframe_origin_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_iframe_origin_allowlist FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_iframe_origin_allowlist FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
GRANT SELECT ON public.platform_iframe_origin_allowlist TO platform_executor;
CREATE POLICY platform_iframe_origin_allowlist_executor ON public.platform_iframe_origin_allowlist FOR SELECT TO platform_executor USING(true);
CREATE POLICY platform_iframe_origin_allowlist_migration ON public.platform_iframe_origin_allowlist TO app_migrator USING(true) WITH CHECK(true);
--> statement-breakpoint
-- 注册目录由发布代码维护；菜单配置不能制造新的内部页面或平台权限。
CREATE FUNCTION public.platform_menu_actions()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $function$
  SELECT array_remove(public.platform_permission_catalog(),'platform.authorization:manage');
$function$;
--> statement-breakpoint
CREATE FUNCTION public.platform_menu_registry()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $function$
  SELECT jsonb_build_object('pages',(SELECT jsonb_agg(jsonb_build_object('key',key,'path','/platform/'||key) ORDER BY ordinal)
    FROM unnest(ARRAY['organizations', 'users', 'employees', 'roles', 'menus', 'departments', 'posts', 'dictionaries', 'parameters', 'announcements', 'audit-events', 'login-events', 'sessions', 'settings', 'tasks']::text[]) WITH ORDINALITY AS pages(key,ordinal)),
    'actions',(SELECT jsonb_agg(jsonb_build_object('key',key) ORDER BY key) FROM unnest(public.platform_menu_actions()) AS actions(key)));
$function$;
--> statement-breakpoint
CREATE FUNCTION public.platform_menu_route_permission(p_key text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $function$
  SELECT CASE p_key
    WHEN 'organizations' THEN 'platform.organization:read' WHEN 'users' THEN 'platform.user:read'
    WHEN 'employees' THEN 'platform.employee:read' WHEN 'roles' THEN 'platform.role:read'
    WHEN 'menus' THEN 'platform.menu:read' WHEN 'departments' THEN 'platform.department:read'
    WHEN 'posts' THEN 'platform.post:read' WHEN 'dictionaries' THEN 'platform.dictionary:read'
    WHEN 'parameters' THEN 'platform.parameter:read' WHEN 'announcements' THEN 'platform.announcement:read'
    WHEN 'audit-events' THEN 'platform.audit:read' WHEN 'login-events' THEN 'platform.login:read'
    WHEN 'sessions' THEN 'platform.session:read' WHEN 'settings' THEN 'platform.settings:read'
    WHEN 'tasks' THEN 'platform.task:read' END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.platform_system_audit_event_codes()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $function$
  SELECT ARRAY['platform.employee_created', 'platform.employee_updated', 'platform.employee_deleted', 'platform.employee_status_changed', 'platform.employee_roles_changed', 'platform.role_created', 'platform.role_updated', 'platform.role_deleted', 'platform.role_status_changed', 'platform.role_permissions_changed', 'platform.role_employees_assigned', 'platform.role_employees_revoked', 'platform.menu_created', 'platform.menu_updated', 'platform.menu_deleted', 'platform.menu_status_changed', 'platform.department_created', 'platform.department_updated', 'platform.department_deleted', 'platform.department_status_changed', 'platform.post_created', 'platform.post_updated', 'platform.post_deleted', 'platform.post_status_changed', 'platform.dictionary_created', 'platform.dictionary_updated', 'platform.dictionary_deleted', 'platform.dictionary_status_changed', 'platform.dictionary_cache_refreshed', 'platform.dictionary_item_created', 'platform.dictionary_item_updated', 'platform.dictionary_item_deleted', 'platform.dictionary_item_status_changed', 'platform.parameter_created', 'platform.parameter_updated', 'platform.parameter_deleted', 'platform.parameter_status_changed', 'platform.parameter_cache_refreshed']::text[];
$function$;
--> statement-breakpoint
GRANT INSERT(scope,event_code,actor_id,resource_type,resource_id,result,request_id,fields,tenant_visible,occurred_at) ON public.audit_events TO platform_executor;
CREATE POLICY audit_events_platform_system_insert ON public.audit_events FOR INSERT TO platform_executor
  WITH CHECK(scope='platform' AND organization_id IS NULL AND NOT tenant_visible AND fields='{}'::jsonb
    AND event_code=ANY(public.platform_system_audit_event_codes()));
CREATE FUNCTION public.append_platform_system_audit(p_actor uuid,p_resource text,p_operation text,p_target uuid,p_request text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE v_event text := 'platform.'||replace(p_resource,'-','_')||'_'||p_operation;
BEGIN
  IF v_event IS NULL OR NOT(v_event=ANY(public.platform_system_audit_event_codes())) OR p_actor IS NULL OR
    p_request IS NULL OR length(btrim(p_request))=0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  BEGIN
    -- 仅保存操作事实与资源标识，不能把参数值或员工输入复制进审计。
    INSERT INTO public.audit_events(scope,event_code,actor_id,resource_type,resource_id,result,request_id,fields,occurred_at)
    VALUES('platform',v_event,p_actor,replace(p_resource,'-','_'),p_target,'succeeded',p_request,'{}'::jsonb,clock_timestamp());
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.platform_system_catalog_projection(p_resource text,p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE v_result jsonb; v_children boolean;
BEGIN
  v_result:=jsonb_build_object('id',p_row->'id','status',p_row->'status','sort',p_row->'sort',
    'createdAt',p_row->'created_at','updatedAt',p_row->'updated_at');
  IF p_resource='dictionary-item' THEN
    RETURN v_result||jsonb_build_object('dictionaryId',p_row->'dictionary_id','value',p_row->'value','label',p_row->'label');
  END IF;
  v_result:=v_result||jsonb_build_object('key',p_row->'key','name',p_row->'name');
  IF p_resource IN ('menu','department') THEN
    IF p_row ? 'has_children' THEN v_children:=(p_row->>'has_children')::boolean;
    ELSIF p_resource='menu' THEN SELECT EXISTS(SELECT 1 FROM public.platform_menu WHERE parent_id=(p_row->>'id')::uuid) INTO v_children;
    ELSE SELECT EXISTS(SELECT 1 FROM public.platform_department WHERE parent_id=(p_row->>'id')::uuid) INTO v_children;
    END IF;
    v_result:=v_result||jsonb_build_object('parentId',p_row->'parent_id','hasChildren',v_children);
  END IF;
  IF p_resource='menu' THEN
    v_result:=v_result||jsonb_build_object('kind',p_row->'kind','routeKey',p_row->'route_key','actionKey',p_row->'action_key',
      'url',p_row->'url','icon',p_row->'icon','hidden',p_row->'hidden');
  END IF;
  IF p_resource IN ('dictionary','parameter') THEN v_result:=v_result||jsonb_build_object('remark',p_row->'remark'); END IF;
  IF p_resource='parameter' THEN v_result:=v_result||jsonb_build_object('value',p_row->'value'); END IF;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.rebuild_platform_system_cache(p_resource text)
RETURNS integer LANGUAGE plpgsql SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE v_version integer;
BEGIN
  IF p_resource NOT IN ('dictionary','parameter') OR p_resource IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  -- 版本、缓存行和管理写入共享事务；读者只会看到整批提交前或整批提交后的缓存。
  UPDATE public.platform_system_cache_revision SET version=version+1 WHERE resource=p_resource RETURNING version INTO v_version;
  DELETE FROM public.platform_system_cache WHERE resource=p_resource;
  IF p_resource='dictionary' THEN
    INSERT INTO public.platform_system_cache(resource,key,version,payload)
    SELECT 'dictionary',d.key,v_version,public.platform_system_catalog_projection('dictionary',to_jsonb(d))||jsonb_build_object('version',v_version,
      'items',coalesce((SELECT jsonb_agg(public.platform_system_catalog_projection('dictionary-item',to_jsonb(i)) ORDER BY i.sort,i.id)
        FROM public.platform_dictionary_item i WHERE i.dictionary_id=d.id AND i.status='active'),'[]'::jsonb))
    FROM public.platform_dictionary d WHERE d.status='active';
  ELSE
    INSERT INTO public.platform_system_cache(resource,key,version,payload)
    SELECT 'parameter',p.key,v_version,public.platform_system_catalog_projection('parameter',to_jsonb(p))||jsonb_build_object('version',v_version)
    FROM public.platform_parameter p WHERE p.status='active';
  END IF;
  RETURN v_version;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.platform_system_navigation_children(p_parent uuid,p_permissions text[])
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog SET row_security=on AS $function$
  WITH children AS MATERIALIZED (
    SELECT m.*,public.platform_system_navigation_children(m.id,p_permissions) AS children
    FROM public.platform_menu m WHERE m.parent_id IS NOT DISTINCT FROM p_parent
      AND m.status='active' AND NOT m.hidden AND m.kind<>'action'
      AND (m.kind<>'page' OR public.platform_menu_route_permission(m.route_key)=ANY(p_permissions))
      AND (m.kind<>'iframe' OR EXISTS(SELECT 1 FROM public.platform_iframe_origin_allowlist
        WHERE origin=lower(substring(m.url FROM '^(https?://[^/?#]+)'))))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind,'routeKey',route_key,
    'url',url,'icon',icon,'hidden',hidden,'children',children) ORDER BY sort,id)
    FILTER(WHERE kind<>'directory' OR jsonb_array_length(children)>0),'[]'::jsonb) FROM children;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.platform_system_catalog(
  p_actor uuid,p_session uuid,p_resource text,p_operation text,p_id uuid,p_input jsonb,p_request text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE
  v_table text; v_action text; v_namespace text; v_permissions text[];
  v_old jsonb; v_row jsonb; v_payload jsonb; v_result jsonb; v_fields text[]; v_required text[];
  v_field text; v_column text; v_assignments text; v_sort text; v_order text;
  v_status text; v_q text; v_page integer; v_size integer; v_offset bigint; v_dictionary uuid;
  v_parent uuid; v_parent_row jsonb; v_cycle boolean; v_has_active_children boolean; v_version integer;
BEGIN
  IF p_resource IS NULL OR p_resource NOT IN ('menu','department','post','dictionary','dictionary-item','parameter') OR
    p_operation IS NULL OR p_operation NOT IN ('list','export-page','get','create','update','delete','set-status','refresh','by-key','navigation','registry') OR
    p_input IS NULL OR jsonb_typeof(p_input)<>'object' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  v_table:='platform_'||replace(p_resource,'-','_');
  v_namespace:=CASE WHEN p_resource='dictionary-item' THEN 'dictionary' ELSE p_resource END;
  IF p_operation='navigation' THEN
    IF p_resource<>'menu' OR p_input<>'{}'::jsonb THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    SELECT permissions INTO v_permissions FROM public.read_platform_access(p_actor,p_session);
    IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    RETURN jsonb_build_object('items',public.platform_system_navigation_children(NULL,v_permissions));
  END IF;
  v_action:=CASE p_operation WHEN 'create' THEN 'create' WHEN 'update' THEN 'update' WHEN 'set-status' THEN 'update'
    WHEN 'delete' THEN 'delete' WHEN 'refresh' THEN 'refresh' WHEN 'export-page' THEN 'export' ELSE 'read' END;
  PERFORM public.require_platform_action(p_actor,p_session,'platform.'||v_namespace||':'||v_action);
  -- 导出执行器复用同一受限投影，授权动作独立于页面读取。
  IF p_operation='export-page' THEN p_operation:='list'; END IF;
  IF p_operation='registry' THEN
    IF p_resource<>'menu' OR p_input<>'{}'::jsonb THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    RETURN public.platform_menu_registry();
  END IF;
  IF p_operation IN ('create','update','delete','set-status','refresh') THEN
    -- 同一树的移动/启停必须串行判定，字典条目与字典类型共用缓存写锁。
    PERFORM pg_advisory_xact_lock(hashtextextended('platform-system:'||v_namespace,0));
    PERFORM public.require_platform_action(p_actor,p_session,'platform.'||v_namespace||':'||v_action);
  END IF;
  IF p_operation='refresh' THEN
    IF p_resource NOT IN ('dictionary','parameter') OR p_input<>'{}'::jsonb THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    v_version:=public.rebuild_platform_system_cache(p_resource);
    PERFORM public.append_platform_system_audit(p_actor,p_resource,'cache_refreshed',NULL,p_request);
    RETURN jsonb_build_object('refreshed',true,'version',v_version);
  END IF;
  IF p_operation='by-key' THEN
    IF p_resource NOT IN ('dictionary','parameter') OR NOT(p_input ? 'key') OR p_input-ARRAY['key']<>'{}'::jsonb THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    SELECT payload INTO v_result FROM public.platform_system_cache WHERE resource=p_resource AND key=p_input->>'key';
    IF v_result IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    RETURN v_result;
  END IF;
  IF p_resource='dictionary-item' THEN
    v_dictionary:=(p_input->>'dictionaryId')::uuid;
    IF v_dictionary IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.platform_dictionary WHERE id=v_dictionary) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  IF p_operation='list' THEN
    v_status:=p_input->>'status'; v_q:=nullif(btrim(p_input->>'q'),'');
    IF (v_status IS NOT NULL AND v_status NOT IN ('active','disabled')) OR length(v_q)>200 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF p_resource IN ('menu','department') THEN
      IF p_input-ARRAY['parentId','q','status']<>'{}'::jsonb THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
      v_parent:=(p_input->>'parentId')::uuid;
      IF v_parent IS NOT NULL THEN
        EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',v_table) INTO v_parent_row USING v_parent;
        IF v_parent_row IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      END IF;
      EXECUTE format($query$
        WITH RECURSIVE matched AS (
          SELECT id,parent_id FROM public.%1$I WHERE ($1::text IS NULL OR status=$1)
            AND ($2::text IS NULL OR strpos(lower(key),lower($2))>0 OR strpos(lower(name),lower($2))>0)
        ), visible AS (
          SELECT id,parent_id FROM matched UNION
          SELECT p.id,p.parent_id FROM public.%1$I p JOIN visible v ON p.id=v.parent_id
        ), children AS (
          SELECT m.*,EXISTS(SELECT 1 FROM public.%1$I c JOIN visible v ON v.id=c.id WHERE c.parent_id=m.id) AS has_children
          FROM public.%1$I m JOIN visible v ON v.id=m.id WHERE m.parent_id IS NOT DISTINCT FROM $3::uuid
        ), ancestors AS (
          SELECT id,parent_id,1 AS depth FROM public.%1$I WHERE id=$3 UNION ALL
          SELECT m.id,m.parent_id,a.depth+1 FROM public.%1$I m JOIN ancestors a ON m.id=a.parent_id
        ) SELECT jsonb_build_object(
          'items',coalesce((SELECT jsonb_agg(public.platform_system_catalog_projection($4,to_jsonb(c)) ORDER BY sort,id) FROM children c),'[]'::jsonb),
          'ancestors',coalesce((SELECT jsonb_agg(public.platform_system_catalog_projection($4,to_jsonb(m)) ORDER BY a.depth DESC)
            FROM ancestors a JOIN public.%1$I m USING(id)),'[]'::jsonb))
      $query$,v_table) INTO v_result USING v_status,v_q,v_parent,p_resource;
      RETURN v_result;
    END IF;
    IF p_input-ARRAY['q','status','page','pageSize','sortBy','sortOrder','dictionaryId']<>'{}'::jsonb OR
      (p_resource<>'dictionary-item' AND p_input ? 'dictionaryId') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    v_page:=coalesce((p_input->>'page')::integer,1); v_size:=coalesce((p_input->>'pageSize')::integer,20);
    v_sort:=coalesce(p_input->>'sortBy','sort'); v_order:=coalesce(p_input->>'sortOrder','asc');
    IF v_page<1 OR v_size NOT BETWEEN 1 AND 100 OR v_order NOT IN ('asc','desc') OR
      (p_resource='dictionary-item' AND v_sort NOT IN ('sort','value','label','createdAt')) OR
      (p_resource<>'dictionary-item' AND v_sort NOT IN ('sort','key','name','createdAt')) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    v_sort:=CASE WHEN v_sort='createdAt' THEN 'created_at' ELSE v_sort END;
    v_offset:=(v_page::bigint-1)*v_size;
    EXECUTE format($query$
      WITH filtered AS MATERIALIZED (
        SELECT t.* FROM public.%1$I t WHERE ($1::text IS NULL OR status=$1)
          AND ($2::text IS NULL OR strpos(lower(%2$I),lower($2))>0 OR strpos(lower(%3$I),lower($2))>0) %4$s
      ), page AS (SELECT * FROM filtered ORDER BY %5$I %6$s,id %6$s LIMIT $4 OFFSET $5)
      SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(public.platform_system_catalog_projection($6,to_jsonb(p)) ORDER BY %5$I %6$s,id %6$s) FROM page p),'[]'::jsonb),
        'page',$3,'pageSize',$4,'total',(SELECT count(*) FROM filtered))
    $query$,v_table,CASE WHEN p_resource='dictionary-item' THEN 'value' ELSE 'key' END,
      CASE WHEN p_resource='dictionary-item' THEN 'label' ELSE 'name' END,
      CASE WHEN p_resource='dictionary-item' THEN 'AND dictionary_id=$7' ELSE '' END,v_sort,v_order)
      INTO v_result USING v_status,v_q,v_page,v_size,v_offset,p_resource,v_dictionary;
    RETURN v_result;
  END IF;
  IF p_operation<>'create' THEN
    IF p_id IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',v_table) INTO v_old USING p_id;
    IF v_old IS NULL OR (p_resource='dictionary-item' AND (v_old->>'dictionary_id')::uuid<>v_dictionary) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF p_operation='get' THEN
      IF p_input-ARRAY['dictionaryId']<>'{}'::jsonb OR (p_resource<>'dictionary-item' AND p_input<>'{}'::jsonb) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
      RETURN public.platform_system_catalog_projection(p_resource,v_old);
    END IF;
    IF p_operation='delete' THEN
      IF p_input-ARRAY['dictionaryId']<>'{}'::jsonb OR (p_resource<>'dictionary-item' AND p_input<>'{}'::jsonb) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
      EXECUTE format('DELETE FROM public.%I WHERE id=$1',v_table) USING p_id;
      IF v_namespace IN ('dictionary','parameter') THEN PERFORM public.rebuild_platform_system_cache(v_namespace); END IF;
      PERFORM public.append_platform_system_audit(p_actor,p_resource,'deleted',p_id,p_request);
      RETURN jsonb_build_object('id',p_id,'deleted',true);
    END IF;
  END IF;
  v_fields:=CASE p_resource
    WHEN 'menu' THEN ARRAY['key','name','status','sort','parentId','kind','routeKey','actionKey','url','icon','hidden']
    WHEN 'department' THEN ARRAY['key','name','status','sort','parentId']
    WHEN 'post' THEN ARRAY['key','name','status','sort']
    WHEN 'dictionary' THEN ARRAY['key','name','status','sort','remark']
    WHEN 'dictionary-item' THEN ARRAY['dictionaryId','value','label','status','sort']
    WHEN 'parameter' THEN ARRAY['key','name','status','sort','value','remark'] END;
  IF p_operation='set-status' THEN
    v_required:=ARRAY['status'];
    IF p_input-(CASE WHEN p_resource='dictionary-item' THEN ARRAY['status','dictionaryId'] ELSE v_required END)<>'{}'::jsonb THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  ELSE
    v_required:=v_fields;
    IF p_input-v_fields<>'{}'::jsonb THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  END IF;
  IF NOT(p_input ?& v_required) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  v_payload:=CASE WHEN p_operation='create' THEN jsonb_build_object('id',gen_random_uuid(),'created_at',clock_timestamp()) ELSE v_old END;
  v_payload:=v_payload||jsonb_build_object('updated_at',clock_timestamp());
  v_assignments:='';
  FOREACH v_field IN ARRAY v_fields LOOP
    v_column:=CASE v_field WHEN 'parentId' THEN 'parent_id' WHEN 'routeKey' THEN 'route_key' WHEN 'actionKey' THEN 'action_key'
      WHEN 'dictionaryId' THEN 'dictionary_id' ELSE v_field END;
    IF p_input ? v_field THEN v_payload:=v_payload||jsonb_build_object(v_column,p_input->v_field); END IF;
    v_assignments:=v_assignments||format('%I=r.%I,',v_column,v_column);
  END LOOP;
  v_assignments:=v_assignments||'updated_at=r.updated_at';
  IF p_resource IN ('menu','department') THEN
    v_parent:=(v_payload->>'parent_id')::uuid;
    IF v_parent IS NOT NULL THEN
      EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',v_table) INTO v_parent_row USING v_parent;
      IF v_parent_row IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF p_resource='menu' AND v_parent_row->>'kind'='action' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
      EXECUTE format($query$WITH RECURSIVE ancestors AS (
        SELECT id,parent_id FROM public.%1$I WHERE id=$1 UNION ALL
        SELECT p.id,p.parent_id FROM public.%1$I p JOIN ancestors a ON p.id=a.parent_id
      ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=$2)$query$,v_table)
        INTO v_cycle USING v_parent,(v_payload->>'id')::uuid;
      IF v_cycle THEN RAISE EXCEPTION 'TREE_CYCLE'; END IF;
      IF v_parent_row->>'status'<>'active' AND (p_operation='create' OR v_payload->>'status'='active' OR
        v_old->'parent_id' IS DISTINCT FROM v_payload->'parent_id') THEN RAISE EXCEPTION 'PARENT_DISABLED'; END IF;
    END IF;
    IF v_payload->>'status'='disabled' THEN
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE parent_id=$1 AND status=''active'')',v_table)
        INTO v_has_active_children USING (v_payload->>'id')::uuid;
      IF v_has_active_children THEN RAISE EXCEPTION 'RESOURCE_IN_USE'; END IF;
    END IF;
  END IF;
  -- 操作节点没有导航载体，不能把已有的下级导航变为不可达。
  IF p_resource='menu' AND p_operation='update' AND v_payload->>'kind'='action' AND v_old->>'kind'<>'action' AND
    EXISTS(SELECT 1 FROM public.platform_menu WHERE parent_id=(v_payload->>'id')::uuid) THEN RAISE EXCEPTION 'RESOURCE_IN_USE'; END IF;
  -- 停用现有节点不执行其目标；部署收紧白名单后，管理员仍须能停用旧 iframe。
  IF p_resource='menu' AND NOT(p_operation='set-status' AND v_payload->>'status'='disabled') THEN
    IF v_payload->>'kind'='page' AND public.platform_menu_route_permission(v_payload->>'route_key') IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF v_payload->>'kind'='action' AND NOT(coalesce(v_payload->>'action_key','')=ANY(public.platform_menu_actions())) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF v_payload->>'kind' IN ('external','iframe') AND (v_payload->>'url' IS NULL OR
      v_payload->>'url' !~ '^https?://[^[:space:]@/?#]+([/?#][^[:space:]]*)?$' OR length(v_payload->>'url')>2000) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF v_payload->>'kind'='iframe' AND NOT EXISTS(SELECT 1 FROM public.platform_iframe_origin_allowlist
      WHERE origin=lower(substring(v_payload->>'url' FROM '^(https?://[^/?#]+)'))) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  END IF;
  IF p_operation='create' THEN
    EXECUTE format('INSERT INTO public.%1$I SELECT (jsonb_populate_record(NULL::public.%1$I,$1)).* RETURNING to_jsonb(%1$I.*)',v_table) INTO v_row USING v_payload;
  ELSE
    EXECUTE format('UPDATE public.%1$I t SET %2$s FROM jsonb_populate_record(NULL::public.%1$I,$2) r WHERE t.id=$1 RETURNING to_jsonb(t.*)',v_table,v_assignments)
      INTO v_row USING p_id,v_payload;
  END IF;
  IF v_namespace IN ('dictionary','parameter') THEN PERFORM public.rebuild_platform_system_cache(v_namespace); END IF;
  PERFORM public.append_platform_system_audit(p_actor,p_resource,CASE p_operation WHEN 'create' THEN 'created'
    WHEN 'set-status' THEN 'status_changed' ELSE 'updated' END,(v_row->>'id')::uuid,p_request);
  RETURN public.platform_system_catalog_projection(p_resource,v_row);
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range OR not_null_violation OR check_violation THEN RAISE EXCEPTION 'VALIDATION_ERROR';
  WHEN unique_violation THEN RAISE EXCEPTION 'KEY_ALREADY_EXISTS';
  WHEN foreign_key_violation OR restrict_violation THEN RAISE EXCEPTION 'RESOURCE_IN_USE';
END;
$function$;
--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
--> statement-breakpoint
ALTER FUNCTION public.platform_menu_actions() OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_menu_actions() FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
ALTER FUNCTION public.platform_menu_registry() OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_menu_registry() FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
ALTER FUNCTION public.platform_menu_route_permission(text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_menu_route_permission(text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
ALTER FUNCTION public.platform_system_audit_event_codes() OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_system_audit_event_codes() FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
ALTER FUNCTION public.append_platform_system_audit(uuid,text,text,uuid,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.append_platform_system_audit(uuid,text,text,uuid,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
ALTER FUNCTION public.platform_system_catalog_projection(text,jsonb) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_system_catalog_projection(text,jsonb) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
ALTER FUNCTION public.rebuild_platform_system_cache(text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.rebuild_platform_system_cache(text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
ALTER FUNCTION public.platform_system_navigation_children(uuid,text[]) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_system_navigation_children(uuid,text[]) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
ALTER FUNCTION public.platform_system_catalog(uuid,uuid,text,text,uuid,jsonb,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_system_catalog(uuid,uuid,text,text,uuid,jsonb,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.platform_system_catalog(uuid,uuid,text,text,uuid,jsonb,text) TO app_runtime;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM platform_executor;

--> statement-breakpoint
-- 部门、岗位只扩展员工资料；任职和角色仍使用授权基座唯一事实源。



ALTER TABLE public.platform_employee_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_employee_profile FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_employee_post ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_employee_post FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_role_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_role_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_employee_profile_executor ON public.platform_employee_profile TO platform_executor USING(true) WITH CHECK(true);
CREATE POLICY platform_employee_post_executor ON public.platform_employee_post TO platform_executor USING(true) WITH CHECK(true);
CREATE POLICY platform_role_profile_executor ON public.platform_role_profile TO platform_executor USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.platform_employee_profile,public.platform_employee_post,public.platform_role_profile TO platform_executor;
--> statement-breakpoint
CREATE FUNCTION public.platform_system_employee_projection(p_user uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $f$
 SELECT jsonb_build_object('userId',a.user_id,'name',u.name,
   'maskedEmail',left(split_part(u.email,'@',1),1)||'***@'||split_part(u.email,'@',2),
   'status',CASE a.status WHEN 'active' THEN 'active' ELSE 'disabled' END,
   'departmentId',p.department_id,
   'postIds',COALESCE((SELECT jsonb_agg(x.post_id ORDER BY x.post_id) FROM public.platform_employee_post x WHERE x.user_id=a.user_id),'[]'::jsonb),
   'roleIds',COALESCE((SELECT jsonb_agg(x.role_id ORDER BY x.role_id) FROM public.platform_assignment_role x WHERE x.user_id=a.user_id),'[]'::jsonb),
   'version',a.version+s.version-1,'createdAt',a.granted_at,
   'lockedUntil',CASE WHEN l.locked_until>statement_timestamp() THEN l.locked_until END,
   'failedAttempts',(SELECT count(*) FROM unnest(l.failure_times) t WHERE t>statement_timestamp()-interval '15 minutes'))
 FROM public.platform_assignment a JOIN public."user" u ON u.id=a.user_id
 JOIN public.user_account_status s ON s.user_id=a.user_id
 LEFT JOIN public.platform_employee_profile p ON p.user_id=a.user_id
 LEFT JOIN public.password_login_lock l ON l.user_id=a.user_id
 WHERE a.user_id=p_user AND a.status<>'revoked';
$f$;
CREATE FUNCTION public.platform_system_role_projection(p_role uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $f$
 SELECT jsonb_build_object('id',r.id,'key',r.key,'name',r.name,
  'status',CASE r.status WHEN 'active' THEN 'active' ELSE 'disabled' END,
  'sort',COALESCE(p.sort,0),'builtIn',r.built_in,'permissions',to_jsonb(r.permissions),
  'createdAt',r.created_at,'updatedAt',r.updated_at)
 FROM public.platform_role r LEFT JOIN public.platform_role_profile p ON p.role_id=r.id WHERE r.id=p_role;
$f$;
--> statement-breakpoint
CREATE FUNCTION public.validate_platform_employee_links(p_department uuid,p_posts uuid[],p_roles uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $f$
BEGIN
 IF p_department IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.platform_department WHERE id=p_department AND status='active') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_posts) x WHERE NOT EXISTS(SELECT 1 FROM public.platform_post WHERE id=x AND status='active'))
 OR EXISTS(SELECT 1 FROM unnest(p_roles) x WHERE NOT EXISTS(SELECT 1 FROM public.platform_role WHERE id=x AND status='active')) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF cardinality(p_posts)>100 OR cardinality(p_roles)>100 OR array_position(p_posts,NULL) IS NOT NULL OR array_position(p_roles,NULL) IS NOT NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
END;
$f$;
--> statement-breakpoint
CREATE FUNCTION public.platform_system_identity(p_actor uuid,p_session uuid,p_resource text,p_operation text,p_id uuid,p_input jsonb,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE
 v_result jsonb; v_id uuid:=p_id; v_ids uuid[]; v_posts uuid[]; v_roles uuid[]; v_department uuid;
 v_page integer:=COALESCE((p_input->>'page')::integer,1); v_size integer:=COALESCE((p_input->>'pageSize')::integer,20);
 v_sort text:=COALESCE(p_input->>'sortBy',CASE WHEN p_resource='employee' THEN 'createdAt' ELSE 'sort' END);
 v_order text:=COALESCE(p_input->>'sortOrder',CASE WHEN p_resource='employee' THEN 'desc' ELSE 'asc' END);
 v_status text:=p_input->>'status'; v_q text:=NULLIF(btrim(p_input->>'q'),'');
 v_row public.platform_assignment%ROWTYPE; v_role public.platform_role%ROWTYPE;
 v_now timestamptz:=clock_timestamp(); v_account_version integer; v_permission text; v_name text; v_email text;
BEGIN
 IF p_resource IS NULL OR p_resource NOT IN ('employee','role') OR p_operation IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object'
 OR p_request IS NULL OR length(btrim(p_request))=0 OR v_page<1 OR v_size<1 OR v_size>100
 OR v_order NOT IN ('asc','desc') OR (v_status IS NOT NULL AND v_status NOT IN ('active','disabled')) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF p_operation NOT IN ('list','get','candidates','employees','create','update','delete','batch-delete','set-status','set-roles','set-permissions','assign-employees','revoke-employees','import-lookup','export-page') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF p_operation='export-page' THEN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.'||p_resource||':export');
  p_operation:='list';
  -- 导出使用同一受限投影，但由独立export权限授权，不要求角色额外持有read。
  v_permission:='export';
 END IF;
 IF p_resource='employee' AND p_operation='import-lookup' THEN
  v_email:=lower(btrim(p_input->>'email'));
  IF v_email IS NULL OR length(v_email)=0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  PERFORM public.lock_platform_authorization();
  PERFORM id FROM public."user" WHERE lower(email)=v_email FOR UPDATE;
  PERFORM public.require_platform_action(p_actor,p_session,'platform.authorization:manage');
  -- 精确匹配仅供导入在同事务决定授任职或更新；返回标识和版本，不返回邮箱快照。
  SELECT jsonb_build_object('userId',u.id,'employeeId',CASE WHEN a.status<>'revoked' THEN a.user_id END,
   'expectedVersion',CASE WHEN a.status<>'revoked' THEN a.version+s.version-1 END,'emailVerified',u.email_verified)
  INTO v_result FROM public."user" u JOIN public.user_account_status s ON s.user_id=u.id LEFT JOIN public.platform_assignment a ON a.user_id=u.id WHERE lower(u.email)=v_email;
  RETURN COALESCE(v_result,jsonb_build_object('userId',NULL,'employeeId',NULL,'expectedVersion',NULL,'emailVerified',false));
 END IF;
 IF p_operation IN ('list','get','candidates','employees') THEN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.'||p_resource||':'||COALESCE(v_permission,'read'));
  IF p_operation='candidates' THEN
   IF p_resource<>'employee' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   PERFORM public.require_platform_action(p_actor,p_session,'platform.authorization:manage');
   -- 候选只投影已验证且无当前任职的全局账号，不读取完整邮箱给前端。
   WITH eligible AS(SELECT u.id,u.name,left(split_part(u.email,'@',1),1)||'***@'||split_part(u.email,'@',2) AS masked_email,u.created_at
    FROM public."user" u WHERE u.email_verified AND NOT EXISTS(SELECT 1 FROM public.platform_assignment a WHERE a.user_id=u.id AND a.status<>'revoked')),
   matched AS(SELECT * FROM eligible WHERE v_q IS NULL OR strpos(lower(name),lower(v_q))>0 OR strpos(lower(masked_email),lower(v_q))>0 OR id::text=v_q),
   selected AS(SELECT * FROM matched ORDER BY created_at DESC,id DESC LIMIT v_size OFFSET (v_page::bigint-1)*v_size)
   SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',id,'name',name,'maskedEmail',masked_email) ORDER BY created_at DESC,id DESC) FROM selected),'[]'::jsonb),
    'page',v_page,'pageSize',v_size,'total',(SELECT count(*) FROM matched)) INTO v_result;
   RETURN v_result;
  END IF;
  IF p_operation='get' THEN
   v_result:=CASE p_resource WHEN 'employee' THEN public.platform_system_employee_projection(p_id) ELSE public.platform_system_role_projection(p_id) END;
   IF v_result IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF; RETURN v_result;
  END IF;
  IF p_resource='employee' OR p_operation='employees' THEN
   IF v_sort NOT IN ('name','status','createdAt') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   IF p_operation='employees' THEN
    IF NOT EXISTS(SELECT 1 FROM public.platform_role WHERE id=p_id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF NOT (p_input ? 'assigned') OR jsonb_typeof(p_input->'assigned')<>'boolean' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   END IF;
   WITH eligible AS(SELECT a.user_id,u.name,a.status,a.granted_at,p.department_id,
    left(split_part(u.email,'@',1),1)||'***@'||split_part(u.email,'@',2) AS masked_email
    FROM public.platform_assignment a JOIN public."user" u ON u.id=a.user_id LEFT JOIN public.platform_employee_profile p ON p.user_id=a.user_id
    WHERE a.status<>'revoked'),
   matched AS(SELECT * FROM eligible e WHERE
    (v_status IS NULL OR e.status=CASE v_status WHEN 'disabled' THEN 'suspended' ELSE 'active' END)
    AND (v_q IS NULL OR strpos(lower(e.name),lower(v_q))>0 OR strpos(lower(e.masked_email),lower(v_q))>0 OR e.user_id::text=v_q)
    AND (p_input->>'departmentId' IS NULL OR e.department_id=(p_input->>'departmentId')::uuid)
    AND (p_input->>'roleId' IS NULL OR EXISTS(SELECT 1 FROM public.platform_assignment_role x WHERE x.user_id=e.user_id AND x.role_id=(p_input->>'roleId')::uuid))
    AND (p_operation<>'employees' OR EXISTS(SELECT 1 FROM public.platform_assignment_role x WHERE x.user_id=e.user_id AND x.role_id=p_id)=(p_input->>'assigned')::boolean)),
   ordered AS(SELECT user_id,row_number() OVER(ORDER BY
    CASE WHEN v_sort='name' AND v_order='asc' THEN name END ASC,CASE WHEN v_sort='name' AND v_order='desc' THEN name END DESC,
    CASE WHEN v_sort='status' AND v_order='asc' THEN status END ASC,CASE WHEN v_sort='status' AND v_order='desc' THEN status END DESC,
    CASE WHEN v_sort='createdAt' AND v_order='asc' THEN granted_at END ASC,CASE WHEN v_sort='createdAt' AND v_order='desc' THEN granted_at END DESC,user_id) AS n FROM matched),
   selected AS(SELECT * FROM ordered ORDER BY n LIMIT v_size OFFSET (v_page::bigint-1)*v_size)
   SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.platform_system_employee_projection(user_id) ORDER BY n) FROM selected),'[]'::jsonb),
    'page',v_page,'pageSize',v_size,'total',(SELECT count(*) FROM matched)) INTO v_result; RETURN v_result;
  END IF;
  IF v_sort NOT IN ('name','key','sort','createdAt') OR p_operation<>'list' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  WITH matched AS(SELECT r.*,COALESCE(p.sort,0) AS sort FROM public.platform_role r LEFT JOIN public.platform_role_profile p ON p.role_id=r.id
   WHERE(v_status IS NULL OR r.status=CASE v_status WHEN 'disabled' THEN 'suspended' ELSE 'active' END)
    AND(v_q IS NULL OR strpos(lower(r.name),lower(v_q))>0 OR strpos(lower(r.key),lower(v_q))>0)),
  ordered AS(SELECT id,row_number() OVER(ORDER BY
    CASE WHEN v_sort='name' AND v_order='asc' THEN name END ASC,CASE WHEN v_sort='name' AND v_order='desc' THEN name END DESC,
    CASE WHEN v_sort='key' AND v_order='asc' THEN key END ASC,CASE WHEN v_sort='key' AND v_order='desc' THEN key END DESC,
    CASE WHEN v_sort='sort' AND v_order='asc' THEN sort END ASC,CASE WHEN v_sort='sort' AND v_order='desc' THEN sort END DESC,
    CASE WHEN v_sort='createdAt' AND v_order='asc' THEN created_at END ASC,CASE WHEN v_sort='createdAt' AND v_order='desc' THEN created_at END DESC,id) AS n FROM matched),
  selected AS(SELECT * FROM ordered ORDER BY n LIMIT v_size OFFSET(v_page::bigint-1)*v_size)
  SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.platform_system_role_projection(id) ORDER BY n) FROM selected),'[]'::jsonb),'page',v_page,'pageSize',v_size,'total',(SELECT count(*) FROM matched)) INTO v_result;
  RETURN v_result;
 END IF;
 -- 与所有任职、角色和全局账号状态写入共用同一事务锁，等锁后重新鉴权。
 PERFORM public.lock_platform_authorization();
 -- 先取得目标账号锁，再通过鉴权取得actor状态读锁，保持与原生改名的user→status顺序一致。
 IF p_resource='employee' THEN
  IF p_operation='create' AND p_input->>'mode'='existing' THEN
   PERFORM id FROM public."user" WHERE id=(p_input->>'userId')::uuid FOR UPDATE;
  ELSIF p_operation IN ('update','set-status','set-roles') THEN
   PERFORM id FROM public."user" WHERE id=p_id FOR UPDATE;
  END IF;
 END IF;
 PERFORM public.require_platform_action(p_actor,p_session,
  CASE WHEN p_resource='employee' AND p_operation='update' THEN 'platform.employee:update'
   WHEN p_resource='role' AND p_operation IN ('create','update','delete','set-status') THEN 'platform.role:'||CASE p_operation WHEN 'set-status' THEN 'update' ELSE p_operation END
   ELSE 'platform.authorization:manage' END);
 IF p_resource='employee' THEN
  IF p_operation='create' THEN
   v_department:=(p_input->>'departmentId')::uuid;
   SELECT COALESCE(array_agg(DISTINCT x::uuid),'{}'::uuid[]) INTO v_posts FROM jsonb_array_elements_text(COALESCE(p_input->'postIds','[]'::jsonb)) x;
   SELECT COALESCE(array_agg(DISTINCT x::uuid),'{}'::uuid[]) INTO v_roles FROM jsonb_array_elements_text(COALESCE(p_input->'roleIds','[]'::jsonb)) x;
   PERFORM public.validate_platform_employee_links(v_department,v_posts,v_roles);
   IF p_input->>'mode'='create' THEN
    v_id:=public.create_platform_employee(p_actor,p_session,p_input->>'email',p_input->>'name',p_input->>'passwordHash',v_roles,'platform employee creation',p_request);
   ELSIF p_input->>'mode'='existing' THEN
    v_id:=(p_input->>'userId')::uuid;
    PERFORM 1 FROM public."user" WHERE id=v_id AND email_verified FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    SELECT * INTO v_row FROM public.platform_assignment WHERE user_id=v_id FOR UPDATE;
    IF FOUND AND v_row.status<>'revoked' THEN RAISE EXCEPTION 'KEY_ALREADY_EXISTS'; END IF;
    INSERT INTO public.platform_assignment(user_id,status,version,granted_at,granted_by,grant_reason)
     VALUES(v_id,'active',1,v_now,p_actor::text,'platform employee assignment')
     ON CONFLICT(user_id) DO UPDATE SET status='active',version=public.platform_assignment.version+1,granted_at=v_now,granted_by=p_actor::text,grant_reason='platform employee assignment',revoked_at=NULL,revoked_by=NULL,revoke_reason=NULL;
    INSERT INTO public.platform_assignment_role(user_id,role_id) SELECT v_id,x FROM unnest(v_roles) x;
   ELSE RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   INSERT INTO public.platform_employee_profile(user_id,department_id) VALUES(v_id,v_department)
    ON CONFLICT(user_id) DO UPDATE SET department_id=EXCLUDED.department_id,updated_at=v_now;
   DELETE FROM public.platform_employee_post WHERE user_id=v_id;
   INSERT INTO public.platform_employee_post(user_id,post_id) SELECT v_id,x FROM unnest(v_posts) x;
   IF p_input->>'mode'='existing' THEN
    PERFORM public.append_platform_system_audit(p_actor,'employee','created',v_id,p_request);
   END IF;
   RETURN public.platform_system_employee_projection(v_id);
  END IF;
  IF p_operation IN ('delete','batch-delete') THEN
   IF p_operation='delete' THEN v_ids:=ARRAY[p_id]; ELSE SELECT array_agg(DISTINCT x::uuid) INTO v_ids FROM jsonb_array_elements_text(p_input->'userIds') x; END IF;
   IF cardinality(v_ids) IS NULL OR cardinality(v_ids)<1 OR cardinality(v_ids)>100 OR array_position(v_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   IF EXISTS(SELECT 1 FROM unnest(v_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.platform_assignment WHERE user_id=x AND status<>'revoked')) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   UPDATE public.platform_assignment SET status='revoked',version=version+1,revoked_at=v_now,revoked_by=p_actor::text,revoke_reason='platform employee removed' WHERE user_id=ANY(v_ids);
   DELETE FROM public.platform_employee_post WHERE user_id=ANY(v_ids);
   DELETE FROM public.platform_employee_profile WHERE user_id=ANY(v_ids);
   FOREACH v_id IN ARRAY v_ids LOOP PERFORM public.append_platform_system_audit(p_actor,'employee','deleted',v_id,p_request); END LOOP;
   IF p_operation='delete' THEN RETURN jsonb_build_object('id',p_id,'deleted',true); END IF;
   RETURN jsonb_build_object('userIds',to_jsonb(v_ids),'deleted',true);
  END IF;
  -- 姓名由全局账号共享；合成版本同时覆盖本人改名、任职资料和角色关联变化。
  SELECT version INTO v_account_version FROM public.user_account_status WHERE user_id=p_id;
  SELECT * INTO v_row FROM public.platform_assignment WHERE user_id=p_id AND status<>'revoked' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF (p_input->>'expectedVersion')::integer IS NULL OR (p_input->>'expectedVersion')::integer<>v_row.version+v_account_version-1 THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF p_operation='update' THEN
   IF jsonb_typeof(p_input->'postIds') IS DISTINCT FROM 'array' OR NOT(p_input ? 'departmentId') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   v_name:=btrim(p_input->>'name');v_department:=(p_input->>'departmentId')::uuid;
   SELECT COALESCE(array_agg(DISTINCT x::uuid),'{}'::uuid[]) INTO v_posts FROM jsonb_array_elements_text(p_input->'postIds') x;
   IF v_name IS NULL OR length(v_name)<1 OR length(v_name)>200 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   PERFORM public.validate_platform_employee_links(v_department,v_posts,'{}');
   UPDATE public."user" SET name=v_name,updated_at=v_now AT TIME ZONE 'UTC' WHERE id=p_id AND name IS DISTINCT FROM v_name;
   INSERT INTO public.platform_employee_profile(user_id,department_id) VALUES(p_id,v_department) ON CONFLICT(user_id) DO UPDATE SET department_id=EXCLUDED.department_id,updated_at=v_now;
   DELETE FROM public.platform_employee_post WHERE user_id=p_id;
   INSERT INTO public.platform_employee_post(user_id,post_id) SELECT p_id,x FROM unnest(v_posts) x;
   UPDATE public.platform_assignment SET version=version+1 WHERE user_id=p_id;
   PERFORM public.append_platform_system_audit(p_actor,'employee','updated',p_id,p_request);
  ELSIF p_operation='set-status' THEN
   IF v_status IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   UPDATE public.platform_assignment SET status=CASE v_status WHEN 'disabled' THEN 'suspended' ELSE 'active' END,version=version+1,
    revoked_at=CASE WHEN v_status='disabled' THEN v_now END,revoked_by=CASE WHEN v_status='disabled' THEN p_actor::text END,
    revoke_reason=CASE WHEN v_status='disabled' THEN 'platform employee disabled' END WHERE user_id=p_id;
   PERFORM public.append_platform_system_audit(p_actor,'employee','status_changed',p_id,p_request);
  ELSIF p_operation='set-roles' THEN
   IF jsonb_typeof(p_input->'roleIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   IF v_row.status<>'active' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   SELECT COALESCE(array_agg(DISTINCT x::uuid),'{}'::uuid[]) INTO v_roles FROM jsonb_array_elements_text(p_input->'roleIds') x;
   PERFORM public.validate_platform_employee_links(NULL,'{}',v_roles);
   DELETE FROM public.platform_assignment_role WHERE user_id=p_id;
   INSERT INTO public.platform_assignment_role(user_id,role_id) SELECT p_id,x FROM unnest(v_roles) x;
   UPDATE public.platform_assignment SET version=version+1 WHERE user_id=p_id;
   PERFORM public.append_platform_system_audit(p_actor,'employee','roles_changed',p_id,p_request);
  ELSE RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  RETURN public.platform_system_employee_projection(p_id);
 END IF;
 IF p_operation='create' THEN
  IF p_input->>'key' IS NULL OR p_input->>'key' !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$' OR length(btrim(p_input->>'name')) NOT BETWEEN 1 AND 200 OR v_status IS NULL OR COALESCE((p_input->>'sort')::integer,-1)<0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  v_id:=gen_random_uuid();
  INSERT INTO public.platform_role(id,key,name,status,built_in,permissions,version,created_at,updated_at)
   VALUES(v_id,p_input->>'key',btrim(p_input->>'name'),CASE v_status WHEN 'disabled' THEN 'suspended' ELSE 'active' END,false,'{}',1,v_now,v_now);
  INSERT INTO public.platform_role_profile(role_id,sort) VALUES(v_id,(p_input->>'sort')::integer);
  PERFORM public.append_platform_system_audit(p_actor,'role','created',v_id,p_request);
 ELSE
  SELECT * INTO v_role FROM public.platform_role WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_role.built_in AND v_role.key='platform_admin' AND p_operation IN ('update','delete','set-status','set-permissions') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_operation='update' THEN
   IF p_input->>'key' IS NULL OR p_input->>'key' !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$' OR length(btrim(p_input->>'name')) NOT BETWEEN 1 AND 200 OR v_status IS NULL OR COALESCE((p_input->>'sort')::integer,-1)<0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   IF v_role.built_in AND p_input->>'key'<>v_role.key THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
   -- 角色元信息和启停允许普通role:update，权限内容始终由独立超级管理员动作修改。
   UPDATE public.platform_role SET key=p_input->>'key',name=btrim(p_input->>'name'),status=CASE v_status WHEN 'disabled' THEN 'suspended' ELSE 'active' END,version=version+1,updated_at=v_now WHERE id=p_id;
   INSERT INTO public.platform_role_profile(role_id,sort) VALUES(p_id,(p_input->>'sort')::integer) ON CONFLICT(role_id) DO UPDATE SET sort=EXCLUDED.sort;
   PERFORM public.append_platform_system_audit(p_actor,'role','updated',p_id,p_request);
  ELSIF p_operation='set-status' THEN
   IF v_status IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   UPDATE public.platform_role SET status=CASE v_status WHEN 'disabled' THEN 'suspended' ELSE 'active' END,version=version+1,updated_at=v_now WHERE id=p_id;
   PERFORM public.append_platform_system_audit(p_actor,'role','status_changed',p_id,p_request);
  ELSIF p_operation='delete' THEN
   IF EXISTS(SELECT 1 FROM public.platform_assignment_role WHERE role_id=p_id) THEN RAISE EXCEPTION 'RESOURCE_IN_USE'; END IF;
   DELETE FROM public.platform_role WHERE id=p_id;
   PERFORM public.append_platform_system_audit(p_actor,'role','deleted',p_id,p_request);
   RETURN jsonb_build_object('id',p_id,'deleted',true);
  ELSIF p_operation='set-permissions' THEN
   IF jsonb_typeof(p_input->'permissions') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'permissions')>500 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   FOR v_permission IN SELECT jsonb_array_elements_text(p_input->'permissions') LOOP
    IF v_permission='platform.authorization:manage' OR NOT v_permission=ANY(public.platform_menu_actions()) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   END LOOP;
   UPDATE public.platform_role SET permissions=ARRAY(SELECT DISTINCT jsonb_array_elements_text(p_input->'permissions')),version=version+1,updated_at=v_now WHERE id=p_id;
   PERFORM public.append_platform_system_audit(p_actor,'role','permissions_changed',p_id,p_request);
  ELSIF p_operation IN ('assign-employees','revoke-employees') THEN
   SELECT array_agg(DISTINCT x::uuid) INTO v_ids FROM jsonb_array_elements_text(p_input->'userIds') x;
   IF cardinality(v_ids) IS NULL OR cardinality(v_ids)<1 OR cardinality(v_ids)>100 OR array_position(v_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   IF EXISTS(SELECT 1 FROM unnest(v_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.platform_assignment WHERE user_id=x AND status='active')) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   IF p_operation='assign-employees' THEN
    IF v_role.status<>'active' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    INSERT INTO public.platform_assignment_role(user_id,role_id) SELECT x,p_id FROM unnest(v_ids) x ON CONFLICT DO NOTHING;
   ELSE DELETE FROM public.platform_assignment_role WHERE role_id=p_id AND user_id=ANY(v_ids); END IF;
   UPDATE public.platform_assignment SET version=version+1 WHERE user_id=ANY(v_ids);
   FOREACH v_id IN ARRAY v_ids LOOP PERFORM public.append_platform_system_audit(p_actor,'employee','roles_changed',v_id,p_request); END LOOP;
   PERFORM public.append_platform_system_audit(p_actor,'role',CASE p_operation WHEN 'assign-employees' THEN 'employees_assigned' ELSE 'employees_revoked' END,p_id,p_request);
   RETURN jsonb_build_object('roleId',p_id,'userIds',to_jsonb(v_ids),'assigned',p_operation='assign-employees');
  ELSE RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 END IF;
 RETURN public.platform_system_role_projection(v_id);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'KEY_ALREADY_EXISTS';
 WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation THEN RAISE EXCEPTION 'VALIDATION_ERROR';
END;
$f$;
--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.platform_system_employee_projection(uuid) OWNER TO platform_executor;
ALTER FUNCTION public.platform_system_role_projection(uuid) OWNER TO platform_executor;
ALTER FUNCTION public.validate_platform_employee_links(uuid,uuid[],uuid[]) OWNER TO platform_executor;
ALTER FUNCTION public.platform_system_identity(uuid,uuid,text,text,uuid,jsonb,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_system_employee_projection(uuid),public.platform_system_role_projection(uuid),public.validate_platform_employee_links(uuid,uuid[],uuid[]),public.platform_system_identity(uuid,uuid,text,text,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_system_identity(uuid,uuid,text,text,uuid,jsonb,text) TO app_runtime;

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
      'platform.employee_created','platform.user_password_login_unlocked','platform.user_created', 'platform.user_updated', 'platform.user_suspended', 'platform.user_resumed', 'platform.user_password_reset_requested', 'platform.session_revoked', 'platform.sessions_queried', 'platform.login_logs_queried'] || public.platform_system_audit_event_codes()
    WHEN 'tenant' THEN ARRAY['member.invited', 'invitation.resent', 'invitation.accepted', 'invitation.rejected',
      'invitation.canceled', 'member.role_changed', 'member.removed', 'member.left',
      'role.created', 'role.updated', 'role.deleted', 'organization.settings_updated',
      'invitation.delivery_smtp_accepted', 'invitation.delivery_failed', 'invitation.delivery_unknown']
    ELSE ARRAY[]::text[]
  END;
$function$;
