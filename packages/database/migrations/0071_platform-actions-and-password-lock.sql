CREATE FUNCTION public.platform_permission_catalog() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $function$ SELECT ARRAY['platform.authorization:manage','platform.organization:read','platform.organization:update','platform.organization:export','platform.user:read','platform.user:create','platform.user:update','platform.user:suspend','platform.user:resetPassword','platform.user:readSensitive','platform.user:unlock','platform.user:export','platform.audit:read','platform.audit:export','platform.settings:read','platform.settings:update','platform.login:read','platform.login:export','platform.session:read','platform.session:revoke','platform.session:export','platform.employee:read','platform.employee:create','platform.employee:update','platform.employee:delete','platform.employee:export','platform.role:read','platform.role:create','platform.role:update','platform.role:delete','platform.role:export','platform.menu:read','platform.menu:create','platform.menu:update','platform.menu:delete','platform.menu:export','platform.department:read','platform.department:create','platform.department:update','platform.department:delete','platform.department:export','platform.post:read','platform.post:create','platform.post:update','platform.post:delete','platform.post:export','platform.dictionary:read','platform.dictionary:create','platform.dictionary:update','platform.dictionary:delete','platform.dictionary:export','platform.dictionary:refresh','platform.parameter:read','platform.parameter:create','platform.parameter:update','platform.parameter:delete','platform.parameter:export','platform.parameter:refresh','platform.announcement:read','platform.announcement:create','platform.announcement:update','platform.announcement:delete','platform.announcement:publish','platform.announcement:readers','platform.task:read','platform.task:download']::text[]; $function$;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE,DELETE ON public.platform_assignment,public.platform_role,public.platform_assignment_role TO platform_executor;
GRANT SELECT,INSERT,UPDATE ON public.password_login_lock TO platform_executor;
REVOKE ALL ON public.platform_role,public.platform_assignment_role,public.password_login_lock FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
REVOKE ALL ON public.platform_assignment FROM platform_deployer;
ALTER TABLE public.platform_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_role FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_role_executor ON public.platform_role TO platform_executor USING(true) WITH CHECK(true);
ALTER TABLE public.platform_assignment_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_assignment_role FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_assignment_role_executor ON public.platform_assignment_role TO platform_executor USING(true) WITH CHECK(true);
ALTER TABLE public.password_login_lock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_login_lock FORCE ROW LEVEL SECURITY;
CREATE POLICY password_login_lock_executor ON public.password_login_lock TO platform_executor USING(true) WITH CHECK(true);
--> statement-breakpoint
DROP FUNCTION public.read_platform_access(uuid,uuid);
CREATE FUNCTION public.read_platform_access(p_user_id uuid,p_session_id uuid)
RETURNS TABLE(roles jsonb,permissions text[],mfa_verified_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."user" WHERE id=p_user_id) THEN RETURN; END IF;
 PERFORM public.require_active_account(p_user_id);
 RETURN QUERY SELECT
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'key',r.key,'name',r.name,'builtIn',r.built_in) ORDER BY r.key)
 FROM public.platform_assignment_role ar JOIN public.platform_role r ON r.id=ar.role_id WHERE ar.user_id=p_user_id AND r.status='active'),'[]'::jsonb),
 CASE WHEN EXISTS(SELECT 1 FROM public.platform_assignment_role ar JOIN public.platform_role r ON r.id=ar.role_id
 WHERE ar.user_id=p_user_id AND r.built_in AND r.key='platform_admin' AND r.status='active')
 THEN public.platform_permission_catalog()
 ELSE ARRAY(SELECT DISTINCT unnest(r.permissions) FROM public.platform_assignment_role ar JOIN public.platform_role r ON r.id=ar.role_id
 WHERE ar.user_id=p_user_id AND r.status='active' ORDER BY 1) END,
 assurance.verified_at
 FROM public.platform_assignment a JOIN public.session s ON s.id=p_session_id AND s.user_id=p_user_id AND s.expires_at>clock_timestamp()
 LEFT JOIN public.platform_session_assurance assurance ON assurance.session_id=s.id AND assurance.user_id=p_user_id
 WHERE a.user_id=p_user_id AND a.status='active';
END; $function$;
--> statement-breakpoint
CREATE FUNCTION public.require_platform_action(p_actor uuid,p_session uuid,p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE v_permissions text[];
BEGIN
 SELECT permissions INTO v_permissions FROM public.read_platform_access(p_actor,p_session);
 IF NOT FOUND OR p_action IS NULL OR NOT p_action=ANY(v_permissions) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
END; $function$;
--> statement-breakpoint
CREATE FUNCTION public.lock_platform_authorization() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
 SELECT pg_advisory_xact_lock(20261017,1);
$function$;
--> statement-breakpoint
CREATE FUNCTION public.lock_platform_authorization_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
BEGIN PERFORM public.lock_platform_authorization(); RETURN NULL; END; $function$;
CREATE TRIGGER platform_assignment_serial BEFORE INSERT OR UPDATE OR DELETE ON public.platform_assignment FOR EACH STATEMENT EXECUTE FUNCTION public.lock_platform_authorization_change();
CREATE TRIGGER platform_assignment_role_serial BEFORE INSERT OR UPDATE OR DELETE ON public.platform_assignment_role FOR EACH STATEMENT EXECUTE FUNCTION public.lock_platform_authorization_change();
CREATE TRIGGER platform_role_serial BEFORE INSERT OR UPDATE OR DELETE ON public.platform_role FOR EACH STATEMENT EXECUTE FUNCTION public.lock_platform_authorization_change();
CREATE TRIGGER platform_account_status_serial BEFORE UPDATE OF status ON public.user_account_status FOR EACH STATEMENT EXECUTE FUNCTION public.lock_platform_authorization_change();
--> statement-breakpoint
CREATE FUNCTION public.guard_platform_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.built_in AND OLD.key='platform_admin' THEN RAISE EXCEPTION 'BUILT_IN_ROLE_IMMUTABLE'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF (TG_OP='INSERT' AND NEW.built_in) OR (TG_OP='UPDATE' AND NEW.built_in IS DISTINCT FROM OLD.built_in)
 OR (TG_OP='UPDATE' AND OLD.built_in AND NEW.key IS DISTINCT FROM OLD.key)
 OR NEW.status NOT IN ('active','suspended') OR NEW.version<1
 OR NOT NEW.permissions<@public.platform_permission_catalog() OR 'platform.authorization:manage'=ANY(NEW.permissions)
 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 RETURN NEW;
END; $function$;
CREATE TRIGGER platform_role_guard BEFORE INSERT OR UPDATE OR DELETE ON public.platform_role FOR EACH ROW EXECUTE FUNCTION public.guard_platform_role();
--> statement-breakpoint
CREATE FUNCTION public.clear_inactive_platform_roles() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
BEGIN
 IF NEW.status<>'active' THEN DELETE FROM public.platform_assignment_role WHERE user_id=NEW.user_id; END IF;
 RETURN NEW;
END; $function$;
CREATE TRIGGER platform_assignment_clear_roles AFTER UPDATE OF status ON public.platform_assignment FOR EACH ROW EXECUTE FUNCTION public.clear_inactive_platform_roles();
--> statement-breakpoint
CREATE FUNCTION public.guard_last_platform_superadmin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE v_reduced boolean;
BEGIN
 -- 在事务结束时核对最终状态，允许同事务重新分配；事务锁序列化并发自我降权。
 IF TG_TABLE_NAME='platform_assignment_role' THEN
   SELECT EXISTS(SELECT 1 FROM public.platform_role WHERE id=OLD.role_id AND key='platform_admin' AND built_in) INTO v_reduced;
 ELSE
   SELECT EXISTS(SELECT 1 FROM public.platform_assignment_role ar JOIN public.platform_role r ON r.id=ar.role_id
     WHERE ar.user_id=OLD.user_id AND r.key='platform_admin' AND r.built_in) INTO v_reduced;
 END IF;
 IF v_reduced AND NOT EXISTS(SELECT 1 FROM public.platform_assignment a
 JOIN public.user_account_status s ON s.user_id=a.user_id AND s.status='active'
 JOIN public.platform_assignment_role ar ON ar.user_id=a.user_id
 JOIN public.platform_role r ON r.id=ar.role_id AND r.key='platform_admin' AND r.built_in AND r.status='active'
 WHERE a.status='active') THEN RAISE EXCEPTION 'LAST_PLATFORM_SUPERADMIN'; END IF;
 RETURN NULL;
END; $function$;
CREATE CONSTRAINT TRIGGER platform_last_superadmin_role AFTER DELETE OR UPDATE ON public.platform_assignment_role
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_last_platform_superadmin();
CREATE CONSTRAINT TRIGGER platform_last_superadmin_account AFTER UPDATE ON public.user_account_status
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(OLD.status='active' AND NEW.status='suspended') EXECUTE FUNCTION public.guard_last_platform_superadmin();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_platform_organizations(
  p_actor uuid, p_session uuid, p_q text, p_status text,
  p_page integer, p_size integer, p_sort text, p_order text, p_request text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.organization:read');
  IF p_page < 1 OR p_size NOT BETWEEN 1 AND 100 OR length(p_q) > 200
    OR (p_status IS NOT NULL AND p_status NOT IN ('ACTIVE', 'SUSPENDED'))
    OR p_sort NOT IN ('name', 'slug', 'createdAt', 'memberCount') OR p_order NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization AS o LEFT JOIN public.organization_status AS s
    ON s.organization_id = o.id WHERE s.organization_id IS NULL) THEN
    RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE';
  END IF;
  WITH filtered AS (
    SELECT o.id, o.name, o.slug, o.created_at AT TIME ZONE 'UTC' AS created_at, s.status, s.status_version,
      (SELECT count(*) FROM public.member AS m WHERE m.organization_id = o.id)::integer AS member_count
    FROM public.organization AS o JOIN public.organization_status AS s ON s.organization_id = o.id
    WHERE (p_status IS NULL OR s.status = p_status)
      AND (p_q IS NULL OR strpos(lower(o.name), lower(p_q)) > 0 OR strpos(lower(o.slug), lower(p_q)) > 0)
  ), page AS (
    SELECT * FROM filtered ORDER BY
      CASE WHEN p_order = 'asc' AND p_sort = 'name' THEN name END ASC,
      CASE WHEN p_order = 'desc' AND p_sort = 'name' THEN name END DESC,
      CASE WHEN p_order = 'asc' AND p_sort = 'slug' THEN slug END ASC,
      CASE WHEN p_order = 'desc' AND p_sort = 'slug' THEN slug END DESC,
      CASE WHEN p_order = 'asc' AND p_sort = 'createdAt' THEN created_at END ASC,
      CASE WHEN p_order = 'desc' AND p_sort = 'createdAt' THEN created_at END DESC,
      CASE WHEN p_order = 'asc' AND p_sort = 'memberCount' THEN member_count END ASC,
      CASE WHEN p_order = 'desc' AND p_sort = 'memberCount' THEN member_count END DESC, id ASC
    LIMIT p_size OFFSET ((p_page::bigint - 1) * p_size)
  ) SELECT jsonb_build_object('items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'slug', slug, 'createdAt', created_at,
      'status', status, 'version', status_version, 'memberCount', member_count)) FROM page), '[]'::jsonb),
    'page', p_page, 'pageSize', p_size, 'total', (SELECT count(*) FROM filtered)) INTO v_result;
  -- 运营读取必须先记录访问事实，审计失败时不把已查询的投影返回调用者。
  BEGIN
    INSERT INTO public.audit_events (scope, event_code, actor_id, resource_type, result, request_id, fields)
    VALUES ('platform', 'platform.organizations_queried', p_actor, 'organization', 'succeeded', p_request,
      jsonb_build_object('status', p_status, 'page', p_page, 'pageSize', p_size, 'sortBy', p_sort, 'sortOrder', p_order));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_platform_organization(p_actor uuid, p_session uuid, p_organization uuid, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.organization:read');
  SELECT jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'createdAt', o.created_at AT TIME ZONE 'UTC',
    'defaultLocale', o.default_locale, 'status', s.status, 'version', s.status_version,
    'statusChangedAt', s.status_changed_at,
    'memberCount', (SELECT count(*) FROM public.member AS m WHERE m.organization_id = o.id),
    -- 成员概览只按角色计数，不把全局身份字段或任意认证 metadata 带入平台响应。
    'members', COALESCE((SELECT jsonb_agg(jsonb_build_object('role', summary.role, 'count', summary.total) ORDER BY summary.role)
      FROM (SELECT m.role, count(*) AS total FROM public.member AS m WHERE m.organization_id = o.id GROUP BY m.role) AS summary), '[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'occurredAt', a.occurred_at,
      'eventCode', a.event_code, 'actorId', a.actor_id, 'result', a.result, 'operationId', a.operation_id)
      ORDER BY a.occurred_at DESC, a.id DESC) FROM public.audit_events AS a
      WHERE a.organization_id = o.id AND a.scope = 'platform'
        AND a.event_code IN ('platform.organization_suspended', 'platform.organization_resumed')), '[]'::jsonb))
  INTO v_result FROM public.organization AS o JOIN public.organization_status AS s ON s.organization_id = o.id
  WHERE o.id = p_organization;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.organization WHERE id = p_organization) THEN
      RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE';
    END IF;
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  BEGIN
    INSERT INTO public.audit_events (organization_id, scope, event_code, actor_id, resource_type, resource_id, result, request_id, fields)
    VALUES (p_organization, 'platform', 'platform.organization_viewed', p_actor, 'organization', p_organization,
      'succeeded', p_request, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.transition_platform_organization(
  p_actor uuid, p_session uuid, p_organization uuid, p_action text,
  p_reason text, p_expected integer, p_key text, p_request text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE
  v_status text; v_version integer; v_target text;
  v_scope text := 'platform:organization:' || p_organization::text;
  v_hash text; v_receipt record; v_operation uuid; v_result jsonb; v_changed boolean;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.organization:update');
  IF p_action IS NULL OR p_action NOT IN ('suspend', 'resume') OR p_reason IS NULL
    OR length(btrim(p_reason)) NOT BETWEEN 10 AND 500 OR p_expected IS NULL OR p_expected < 1
    OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 128 OR p_key !~ '^[A-Za-z0-9:_-]+$' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  -- 与 TenantTx、原生组织写入使用同一状态行锁；锁决定写入和停用的提交边界。
  SELECT status, status_version INTO v_status, v_version FROM public.organization_status
  WHERE organization_id = p_organization FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  -- 等待组织锁期间任职或 MFA 可能变化；必须在读取旧收据前重新授权。
  PERFORM public.require_platform_action(p_actor,p_session,'platform.organization:update');
  v_hash := encode(sha256(convert_to(jsonb_build_object('reason', p_reason, 'expectedVersion', p_expected)::text, 'UTF8')), 'hex');
  DELETE FROM public.operation_receipts WHERE actor_id = p_actor AND scope_key = v_scope AND expires_at <= clock_timestamp();
  SELECT request_hash, safe_result INTO v_receipt FROM public.operation_receipts
  WHERE actor_id = p_actor AND scope_key = v_scope AND action = p_action AND idempotency_key = p_key;
  IF FOUND THEN
    IF v_receipt.request_hash <> v_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    RETURN v_receipt.safe_result;
  END IF;
  IF v_version <> p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  v_target := CASE p_action WHEN 'suspend' THEN 'SUSPENDED' ELSE 'ACTIVE' END;
  v_changed := v_status <> v_target;
  v_operation := gen_random_uuid();
  IF v_changed THEN
    UPDATE public.organization_status SET status = v_target, status_version = status_version + 1,
      authorization_version = authorization_version + 1, status_changed_at = clock_timestamp(),
      status_changed_by = p_actor, internal_reason = p_reason WHERE organization_id = p_organization
    RETURNING status_version INTO v_version;
  END IF;
  v_result := jsonb_build_object('organizationId', p_organization, 'status', v_target, 'version', v_version,
    'changed', v_changed, 'result', CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END, 'operationId', v_operation);
  BEGIN
    INSERT INTO public.audit_events (organization_id, scope, event_code, actor_id, resource_type, resource_id,
      result, reason, request_id, operation_id, tenant_visible, public_summary, fields)
    VALUES (p_organization, 'platform', CASE WHEN NOT v_changed THEN 'platform.organization_transition_attempted'
      WHEN p_action = 'suspend' THEN 'platform.organization_suspended' ELSE 'platform.organization_resumed' END,
      p_actor, 'organization', p_organization, CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END,
      p_reason, p_request, v_operation::text, v_changed,
      CASE WHEN v_changed THEN CASE p_action WHEN 'suspend' THEN 'Organization suspended' ELSE 'Organization resumed' END END,
      jsonb_build_object('action', p_action, 'previousStatus', v_status, 'status', v_target, 'version', v_version));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  -- 收据、状态和成功审计属于同一事务；只有完整提交的结果才能被重放。
  INSERT INTO public.operation_receipts (actor_id, scope_key, action, idempotency_key, request_hash, operation_id, safe_result, expires_at)
  VALUES (p_actor, v_scope, p_action, p_key, v_hash, v_operation, v_result, clock_timestamp() + interval '24 hours');
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_platform_users(p_actor uuid, p_session uuid, p_q text, p_page integer, p_size integer, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.user:read');
  IF p_page IS NULL OR p_page < 1 OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 100 OR length(p_q) > 200
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF EXISTS (SELECT 1 FROM public."user" u LEFT JOIN public.user_account_status s ON s.user_id = u.id WHERE s.user_id IS NULL)
    THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  WITH directory AS (
    SELECT u.id, u.name, left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2) AS masked_email,
      u.email_verified, u.created_at AT TIME ZONE 'UTC' AS created_at, s.status, s.version,
      (SELECT count(*) FROM public.member m WHERE m.user_id = u.id)::integer AS organization_count
    FROM public."user" u JOIN public.user_account_status s ON s.user_id = u.id
  ), filtered AS (
    SELECT * FROM directory WHERE p_q IS NULL OR strpos(lower(name), lower(p_q)) > 0
      OR strpos(lower(masked_email), lower(p_q)) > 0 OR id::text = p_q
  ), page AS (
    SELECT * FROM filtered ORDER BY created_at DESC, id ASC LIMIT p_size OFFSET ((p_page::bigint - 1) * p_size)
  ) SELECT jsonb_build_object('items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'userId', id, 'name', name, 'maskedEmail', masked_email, 'lockedUntil',(SELECT l.locked_until FROM public.password_login_lock l WHERE l.user_id=id AND l.locked_until>clock_timestamp()), 'emailVerified', email_verified,
    'createdAt', created_at, 'organizationCount', organization_count, 'status', status, 'version', version)
    ORDER BY created_at DESC, id ASC) FROM page), '[]'::jsonb),
    'page', p_page, 'pageSize', p_size, 'total', (SELECT count(*) FROM filtered)) INTO v_result;
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, result, request_id, fields)
    VALUES ('platform', 'platform.users_queried', p_actor, 'user', 'succeeded', p_request,
      jsonb_build_object('page', p_page, 'pageSize', p_size));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_platform_user(p_actor uuid, p_session uuid, p_user uuid, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.user:read');
  IF EXISTS (SELECT 1 FROM public.member m LEFT JOIN public.organization_status s ON s.organization_id = m.organization_id
    WHERE m.user_id = p_user AND s.organization_id IS NULL) THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  IF EXISTS (SELECT 1 FROM public."user" u LEFT JOIN public.user_account_status s ON s.user_id = u.id
    WHERE u.id = p_user AND s.user_id IS NULL) THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  SELECT jsonb_build_object('userId', u.id, 'name', u.name,
    'maskedEmail', left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2),
    'lockedUntil',(SELECT l.locked_until FROM public.password_login_lock l WHERE l.user_id=u.id AND l.locked_until>clock_timestamp()), 'emailVerified', u.email_verified, 'createdAt', u.created_at AT TIME ZONE 'UTC',
    'twoFactorEnabled', COALESCE(u.two_factor_enabled, false), 'status', s.status, 'version', s.version,
    'organizationCount', (SELECT count(*) FROM public.member m WHERE m.user_id = u.id),
    'organizations', COALESCE((SELECT jsonb_agg(jsonb_build_object('organizationId', o.id, 'name', o.name, 'slug', o.slug,
      'status', os.status, 'role', m.role, 'joinedAt', m.created_at AT TIME ZONE 'UTC') ORDER BY o.name, o.id)
      FROM public.member m JOIN public.organization o ON o.id = m.organization_id
      JOIN public.organization_status os ON os.organization_id = o.id WHERE m.user_id = u.id), '[]'::jsonb))
    INTO v_result FROM public."user" u JOIN public.user_account_status s ON s.user_id = u.id WHERE u.id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, resource_id, result, request_id, fields)
    VALUES ('platform', 'platform.user_viewed', p_actor, 'user', p_user, 'succeeded', p_request, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_platform_sensitive_profile(p_actor uuid, p_session uuid, p_user uuid, p_purpose text, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  -- 对不存在的目标也先验证敏感权限，审计员不能借响应探测全站身份。
  PERFORM public.require_platform_action(p_actor,p_session,'platform.user:readSensitive');
  IF p_purpose IS NULL OR length(btrim(p_purpose)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  SELECT jsonb_build_object('userId', id, 'email', email) INTO v_result FROM public."user" WHERE id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, resource_id, result, request_id, reason, fields)
    VALUES ('platform', 'platform.user_sensitive_viewed', p_actor, 'user', p_user, 'succeeded', p_request, btrim(p_purpose), '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_platform_audit_events(
  p_actor uuid, p_session uuid, p_from timestamptz, p_to timestamptz,
  p_organization uuid, p_filter_actor uuid, p_event text, p_result text,
  p_page integer, p_page_size integer, p_request text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_items jsonb; v_total bigint; v_offset bigint; v_now timestamptz;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.audit:read');
  v_now := clock_timestamp();
  IF p_to IS NULL THEN p_to := v_now; END IF;
  IF p_from IS NULL THEN p_from := p_to - interval '30 days'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to > v_now OR
    p_to - p_from > interval '90 days' OR p_page IS NULL OR p_page < 1 OR
    p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR
    (p_result IS NOT NULL AND p_result NOT IN ('succeeded', 'denied', 'failed', 'no_change')) OR
    (p_event IS NOT NULL AND length(btrim(p_event)) NOT BETWEEN 1 AND 120)
  THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  v_offset := (p_page::bigint - 1) * p_page_size;

  -- 计数与当前页共享同一语句快照；先分页再关联身份和生成脱敏 JSON。
  -- 每个来源最多取 offset + pageSize 条候选，合并后按完整公开 ID 稳定排序。
  WITH events AS NOT MATERIALIZED (
    SELECT 'event:' || a.id::text AS id, a.occurred_at, a.organization_id, a.scope,
      a.event_code, a.actor_type, a.actor_id, a.resource_type, a.resource_id, a.result,
      '{}'::jsonb AS metadata
    FROM public.audit_events a
    WHERE ((a.scope = 'platform' AND a.event_code = ANY(public.platform_audit_event_codes('platform'))) OR
        (a.scope = 'tenant' AND a.event_code = ANY(public.platform_audit_event_codes('tenant'))))
      AND a.occurred_at BETWEEN p_from AND p_to
      AND (p_organization IS NULL OR a.organization_id = p_organization)
      AND (p_filter_actor IS NULL OR a.actor_id = p_filter_actor)
      AND (p_event IS NULL OR a.event_code = p_event)
      AND (p_result IS NULL OR a.result = p_result)
  ), assignments AS NOT MATERIALIZED (
    SELECT 'assignment:' || a.id::text AS id, a.created_at AS occurred_at,
      NULL::uuid AS organization_id, 'platform'::text AS scope,
      CASE a.action WHEN 'grant' THEN 'platform.role_granted' ELSE 'platform.role_revoked' END AS event_code,
      'deployment_operator'::text AS actor_type, NULL::uuid AS actor_id,
      'user'::text AS resource_type, a.user_id AS resource_id,
      CASE a.result WHEN 'changed' THEN 'succeeded' ELSE 'no_change' END AS result,
      jsonb_build_object('previousRole', a.previous_role, 'nextRole', a.next_role) AS metadata
    FROM public.platform_assignment_audit a
    WHERE p_organization IS NULL AND p_filter_actor IS NULL
      AND a.created_at BETWEEN p_from AND p_to
      AND (p_event IS NULL OR CASE a.action WHEN 'grant' THEN 'platform.role_granted' ELSE 'platform.role_revoked' END = p_event)
      AND (p_result IS NULL OR CASE a.result WHEN 'changed' THEN 'succeeded' ELSE 'no_change' END = p_result)
  ), candidates AS MATERIALIZED (
    (SELECT * FROM events ORDER BY occurred_at DESC, id DESC LIMIT v_offset + p_page_size)
    UNION ALL
    (SELECT * FROM assignments ORDER BY occurred_at DESC, id DESC LIMIT v_offset + p_page_size)
  ), page AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY occurred_at DESC, id DESC LIMIT p_page_size OFFSET v_offset
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', page.id, 'occurredAt', page.occurred_at, 'scope', page.scope,
    'targetOrganization', CASE WHEN page.organization_id IS NULL THEN NULL ELSE
      jsonb_build_object('organizationId', page.organization_id, 'name', o.name) END,
    'eventCode', page.event_code, 'actorType', page.actor_type, 'actorId', page.actor_id,
    'actorMaskedEmail', CASE WHEN u.email IS NULL THEN NULL ELSE left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2) END,
    'resourceType', page.resource_type, 'resourceId', page.resource_id, 'result', page.result,
    'metadata', page.metadata
  ) ORDER BY page.occurred_at DESC, page.id DESC), '[]'::jsonb),
    (SELECT count(*) FROM events) + (SELECT count(*) FROM assignments)
  INTO v_items, v_total FROM page
  LEFT JOIN public.organization o ON o.id = page.organization_id
  LEFT JOIN public."user" u ON u.id = page.actor_id;

  BEGIN
    -- 读取事实发生在查询完成之后，不能使用事务开始时间落入本次冻结窗口。
    INSERT INTO public.audit_events(scope, event_code, actor_id, result, reason, request_id, occurred_at, fields)
    VALUES ('platform', 'platform.audit_queried', p_actor, 'succeeded', NULL, p_request, clock_timestamp(),
      jsonb_build_object('from', p_from, 'to', p_to, 'organizationId', p_organization,
        'actorId', p_filter_actor, 'eventCode', p_event, 'result', p_result,
        'page', p_page, 'pageSize', p_page_size));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN jsonb_build_object('items', v_items, 'page', p_page, 'pageSize', p_page_size, 'total', v_total,
    'window', jsonb_build_object('from', p_from, 'to', p_to));
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_platform_audit_event(p_actor uuid, p_session uuid, p_id text, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_event jsonb;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.audit:read');
  IF p_id IS NULL OR p_id !~ '^(event|assignment):[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  SELECT event INTO v_event FROM public.platform_audit_projection WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, result, reason, request_id, fields)
    VALUES ('platform', 'platform.audit_viewed', p_actor, 'audit_event', 'succeeded', NULL, p_request, jsonb_build_object('eventId', p_id));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_event;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_platform_settings(p_actor uuid, p_session uuid, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.settings:read');
  SELECT jsonb_build_object('platformDefaultLocale', default_locale, 'version', version)
    INTO v_result FROM public.platform_settings WHERE singleton = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, result, request_id, tenant_visible, fields)
      VALUES ('platform', 'platform.settings_viewed', p_actor, 'platform_settings', 'succeeded', p_request, false, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.update_platform_settings(p_actor uuid, p_session uuid, p_locale text,
  p_reason text, p_expected integer, p_key text, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_locale text; v_version integer; v_changed boolean; v_result jsonb;
  v_hash text; v_receipt record; v_operation uuid;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.settings:update');
  IF p_locale IS NULL OR p_locale NOT IN ('zh-CN', 'en-US', 'ar') OR p_reason IS NULL
    OR length(btrim(p_reason)) NOT BETWEEN 10 AND 500 OR p_expected IS NULL OR p_expected < 1
    OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 128 OR p_key !~ '^[A-Za-z0-9:_-]+$' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  SELECT default_locale, version INTO v_locale, v_version FROM public.platform_settings WHERE singleton = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  -- 等待单例写锁期间权限可能变化；旧收据也必须通过当前权限和近期 MFA。
  PERFORM public.require_platform_action(p_actor,p_session,'platform.settings:update');
  v_hash := encode(sha256(convert_to(jsonb_build_object('platformDefaultLocale', p_locale,
    'reason', p_reason, 'expectedVersion', p_expected)::text, 'UTF8')), 'hex');
  DELETE FROM public.operation_receipts WHERE actor_id = p_actor AND scope_key = 'platform:settings' AND expires_at <= clock_timestamp();
  SELECT request_hash, safe_result INTO v_receipt FROM public.operation_receipts
    WHERE actor_id = p_actor AND scope_key = 'platform:settings' AND action = 'updateLocale' AND idempotency_key = p_key;
  IF FOUND THEN
    IF v_receipt.request_hash <> v_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    RETURN v_receipt.safe_result;
  END IF;
  IF v_version <> p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  v_changed := v_locale <> p_locale;
  v_operation := gen_random_uuid();
  IF v_changed THEN
    UPDATE public.platform_settings SET default_locale = p_locale, version = version + 1 WHERE singleton = true RETURNING version INTO v_version;
  END IF;
  v_result := jsonb_build_object('platformDefaultLocale', p_locale, 'version', v_version,
    'changed', v_changed, 'result', CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END, 'operationId', v_operation);
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, result, reason, request_id, operation_id, tenant_visible, fields)
      VALUES ('platform', 'platform.settings_updated', p_actor, 'platform_settings',
        CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END, p_reason, p_request, v_operation::text, false,
        jsonb_build_object('previousDefaultLocale', v_locale, 'platformDefaultLocale', p_locale, 'version', v_version));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  INSERT INTO public.operation_receipts(actor_id, scope_key, action, idempotency_key, request_hash, operation_id, safe_result, expires_at)
    VALUES(p_actor, 'platform:settings', 'updateLocale', p_key, v_hash, v_operation, v_result, clock_timestamp() + interval '24 hours');
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_platform_storage_policy(p_actor uuid, p_session uuid, p_organization uuid, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.settings:read');
  IF NOT EXISTS (SELECT 1 FROM public.organization WHERE id = p_organization) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM set_config('app.platform_storage_organization_id', p_organization::text, true);
  INSERT INTO public.file_storage_usage (organization_id) VALUES (p_organization) ON CONFLICT DO NOTHING;
  -- 初始化或冲突等待后，实际读取摘要前重新验证当前 Session 和平台任职。
  PERFORM public.require_platform_action(p_actor,p_session,'platform.settings:read');
  SELECT jsonb_build_object('organizationId', organization_id, 'quotaBytes', quota_bytes,
    'usedBytes', used_bytes, 'reservedBytes', reserved_bytes, 'transientBytes', transient_bytes,
    'trashDays', trash_days, 'historyDays', history_days, 'version', policy_revision,
    'overQuota', used_bytes + reserved_bytes > quota_bytes)
  INTO v_result FROM public.file_storage_usage WHERE organization_id = p_organization;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  -- 平台只读取容量与策略，访问审计失败不能返回刚查询的摘要。
  BEGIN
    INSERT INTO public.audit_events (organization_id, scope, event_code, actor_id, resource_type,
      resource_id, result, request_id, tenant_visible, fields)
    VALUES (p_organization, 'platform', 'platform.storage_policy_viewed', p_actor, 'file_storage_policy',
      p_organization, 'succeeded', p_request, false, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.update_platform_storage_policy(p_actor uuid, p_session uuid, p_organization uuid,
  p_quota bigint, p_trash_days integer, p_history_days integer, p_reason text, p_expected integer,
  p_key text, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_usage public.file_storage_usage%ROWTYPE; v_previous jsonb; v_changed boolean; v_result jsonb;
  v_hash text; v_receipt record; v_operation uuid;
  v_scope text := 'platform:storage:' || p_organization::text;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.settings:update');
  IF p_quota IS NULL OR p_quota NOT BETWEEN 0 AND 9007199254740991 OR p_trash_days IS NULL OR p_trash_days < 1
    OR p_history_days IS NULL OR p_history_days < 1 OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 500
    OR p_expected IS NULL OR p_expected < 1 OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 128
    OR p_key !~ '^[A-Za-z0-9:_-]+$' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization WHERE id = p_organization) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM set_config('app.platform_storage_organization_id', p_organization::text, true);
  INSERT INTO public.file_storage_usage (organization_id) VALUES (p_organization) ON CONFLICT DO NOTHING;
  -- 与租户上传预留共用同一行锁；降低配额不删已有对象，只阻止后续新增容量。
  SELECT * INTO v_usage FROM public.file_storage_usage WHERE organization_id = p_organization FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  PERFORM public.require_platform_action(p_actor,p_session,'platform.settings:update');
  v_hash := encode(sha256(convert_to(jsonb_build_object('quotaBytes', p_quota, 'trashDays', p_trash_days,
    'historyDays', p_history_days, 'reason', p_reason, 'expectedVersion', p_expected)::text, 'UTF8')), 'hex');
  DELETE FROM public.operation_receipts WHERE actor_id = p_actor AND scope_key = v_scope AND expires_at <= clock_timestamp();
  SELECT request_hash, safe_result INTO v_receipt FROM public.operation_receipts
    WHERE actor_id = p_actor AND scope_key = v_scope AND action = 'updateStoragePolicy' AND idempotency_key = p_key;
  IF FOUND THEN
    IF v_receipt.request_hash <> v_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    RETURN v_receipt.safe_result;
  END IF;
  IF v_usage.policy_revision <> p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  v_previous := jsonb_build_object('quotaBytes', v_usage.quota_bytes, 'trashDays', v_usage.trash_days, 'historyDays', v_usage.history_days);
  v_changed := (v_usage.quota_bytes, v_usage.trash_days, v_usage.history_days) IS DISTINCT FROM (p_quota, p_trash_days, p_history_days);
  v_operation := gen_random_uuid();
  IF v_changed THEN
    UPDATE public.file_storage_usage SET quota_bytes = p_quota, trash_days = p_trash_days,
      history_days = p_history_days, policy_revision = policy_revision + 1 WHERE organization_id = p_organization RETURNING * INTO v_usage;
  END IF;
  v_result := jsonb_build_object('organizationId', p_organization, 'quotaBytes', v_usage.quota_bytes,
    'usedBytes', v_usage.used_bytes, 'reservedBytes', v_usage.reserved_bytes, 'transientBytes', v_usage.transient_bytes,
    'trashDays', v_usage.trash_days, 'historyDays', v_usage.history_days, 'version', v_usage.policy_revision,
    'overQuota', v_usage.used_bytes + v_usage.reserved_bytes > v_usage.quota_bytes,
    'changed', v_changed, 'result', CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END, 'operationId', v_operation);
  BEGIN
    INSERT INTO public.audit_events (organization_id, scope, event_code, actor_id, resource_type, resource_id,
      result, reason, request_id, operation_id, tenant_visible, fields)
    VALUES (p_organization, 'platform', 'platform.storage_policy_updated', p_actor, 'file_storage_policy', p_organization,
      CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END, p_reason, p_request, v_operation::text, false,
      jsonb_build_object('previous', v_previous, 'quotaBytes', p_quota, 'trashDays', p_trash_days,
        'historyDays', p_history_days, 'version', v_usage.policy_revision));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  -- 已记录的版本/回收期限不被追溯改写；策略、收据与成功审计同时提交。
  INSERT INTO public.operation_receipts (actor_id, scope_key, action, idempotency_key, request_hash, operation_id, safe_result, expires_at)
  VALUES (p_actor, v_scope, 'updateStoragePolicy', p_key, v_hash, v_operation, v_result, clock_timestamp() + interval '24 hours');
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.create_platform_user(p_actor uuid, p_session uuid, p_name text, p_email text, p_password_hash text, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_user uuid := gen_random_uuid(); v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.user:create');
  IF p_name IS NULL OR length(btrim(p_name)) = 0 OR p_email IS NULL OR length(btrim(p_email)) = 0
    OR p_password_hash IS NULL OR length(p_password_hash) = 0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF EXISTS (SELECT 1 FROM public."user" WHERE lower(email) = lower(btrim(p_email)))
    THEN RAISE EXCEPTION 'EMAIL_ALREADY_EXISTS'; END IF;
  INSERT INTO public."user"(id, name, email, email_verified, created_at, updated_at)
  VALUES (v_user, btrim(p_name), lower(btrim(p_email)), true, v_now AT TIME ZONE 'UTC', v_now AT TIME ZONE 'UTC');
  INSERT INTO public.account(id, account_id, provider_id, user_id, password, created_at, updated_at)
  VALUES (gen_random_uuid(), v_user::text, 'credential', v_user, p_password_hash,
    v_now AT TIME ZONE 'UTC', v_now AT TIME ZONE 'UTC');
  -- 网页创建只产生普通身份，不写平台任职或组织成员关系。
  PERFORM public.append_platform_identity_audit(p_actor, 'platform.user_created', v_user, 'succeeded', p_request, NULL);
  RETURN jsonb_build_object('userId',v_user,'name',btrim(p_name),'maskedEmail',left(split_part(lower(btrim(p_email)),'@',1),1)||'***@'||split_part(lower(btrim(p_email)),'@',2),'emailVerified',true,'createdAt',v_now,'organizationCount',0,'status','active','version',1,'twoFactorEnabled',false,'organizations','[]'::jsonb,'lockedUntil',NULL);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'EMAIL_ALREADY_EXISTS';
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.update_platform_user(p_actor uuid, p_session uuid, p_user uuid, p_name text, p_expected integer, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_state public.user_account_status%ROWTYPE; v_name text; v_changed boolean;
BEGIN
  -- 原生姓名写先锁 user 再由版本触发器锁 status；平台写遵循同一顺序。
  PERFORM id FROM public."user" WHERE id = p_user FOR UPDATE;
  PERFORM user_id FROM public.user_account_status WHERE user_id IN (p_actor, p_user) ORDER BY user_id FOR UPDATE;
  PERFORM public.require_platform_action(p_actor,p_session,'platform.user:update');
  SELECT * INTO v_state FROM public.user_account_status WHERE user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 OR p_expected IS NULL OR p_expected < 1
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF v_state.version <> p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  SELECT name INTO v_name FROM public."user" WHERE id = p_user;
  v_changed := v_name IS DISTINCT FROM btrim(p_name);
  IF v_changed THEN
    UPDATE public."user" SET name = btrim(p_name), updated_at = clock_timestamp() AT TIME ZONE 'UTC' WHERE id = p_user;
  END IF;
  SELECT * INTO v_state FROM public.user_account_status WHERE user_id = p_user;
  PERFORM public.append_platform_identity_audit(p_actor, 'platform.user_updated', p_user,
    CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END, p_request, NULL);
  RETURN jsonb_build_object('userId', p_user, 'name', btrim(p_name), 'status', v_state.status,
    'version', v_state.version, 'changed', v_changed);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_platform_user_status(p_actor uuid, p_session uuid, p_user uuid, p_status text, p_expected integer, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_state public.user_account_status%ROWTYPE; v_name text; v_changed boolean;
BEGIN
  PERFORM public.lock_platform_authorization();
  PERFORM user_id FROM public.user_account_status WHERE user_id IN (p_actor, p_user) ORDER BY user_id FOR UPDATE;
  PERFORM public.require_platform_action(p_actor,p_session,'platform.user:suspend');
  SELECT * INTO v_state FROM public.user_account_status WHERE user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'suspended') OR p_expected IS NULL OR p_expected < 1
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF v_state.version <> p_expected THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  v_changed := v_state.status <> p_status;
  IF v_changed THEN
    UPDATE public.user_account_status SET status = p_status, version = version + 1, updated_at = clock_timestamp()
    WHERE user_id = p_user RETURNING * INTO v_state;
    IF p_status = 'suspended' THEN DELETE FROM public.session WHERE user_id = p_user; END IF;
  END IF;
  SELECT name INTO v_name FROM public."user" WHERE id = p_user;
  PERFORM public.append_platform_identity_audit(p_actor,
    CASE p_status WHEN 'suspended' THEN 'platform.user_suspended' ELSE 'platform.user_resumed' END, p_user,
    CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END, p_request, NULL);
  RETURN jsonb_build_object('userId', p_user, 'name', v_name, 'status', v_state.status,
    'version', v_state.version, 'changed', v_changed);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prepare_platform_password_reset(p_actor uuid, p_session uuid, p_user uuid, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_email text;
BEGIN
  PERFORM user_id FROM public.user_account_status WHERE user_id IN (p_actor, p_user) ORDER BY user_id FOR SHARE;
  PERFORM public.require_platform_action(p_actor,p_session,'platform.user:resetPassword');
  IF NOT EXISTS (SELECT 1 FROM public."user" WHERE id = p_user) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM public.require_active_account(p_user);
  SELECT email INTO v_email FROM public."user" WHERE id = p_user;
  -- 邮箱只供服务端调用原生重置流程；准备读取不能提前声称邮件已发送。
  RETURN jsonb_build_object('userId', p_user, 'email', v_email);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_platform_password_reset_requested(p_actor uuid, p_session uuid, p_user uuid, p_request text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.user:resetPassword');
  PERFORM public.append_platform_identity_audit(p_actor, 'platform.user_password_reset_requested', p_user, 'succeeded', p_request, NULL);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_platform_login_logs(p_actor uuid, p_session uuid, p_q text, p_user uuid, p_result text, p_method text, p_from timestamptz, p_to timestamptz, p_page integer, p_size integer, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.login:read');
  v_result := public.read_login_events_page(p_q, p_user, p_result, p_method, p_from, p_to, p_page, p_size);
  PERFORM public.append_platform_identity_audit(p_actor, 'platform.login_logs_queried', p_user, 'succeeded', p_request, NULL);
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_platform_sessions(p_actor uuid, p_session uuid, p_q text, p_user uuid, p_page integer, p_size integer, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.session:read');
  IF p_page IS NULL OR p_page < 1 OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 100 OR length(p_q) > 200
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  WITH directory AS (
    SELECT s.id AS session_id, s.user_id, u.name,
      left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2) AS masked_email,
      s.created_at AT TIME ZONE 'UTC' AS created_at, s.updated_at AT TIME ZONE 'UTC' AS updated_at,
      s.expires_at AT TIME ZONE 'UTC' AS expires_at, s.ip_address, s.user_agent
    FROM public.session s JOIN public."user" u ON u.id = s.user_id
    WHERE s.expires_at > clock_timestamp() AND (p_user IS NULL OR s.user_id = p_user)
  ), filtered AS (
    SELECT * FROM directory WHERE p_q IS NULL OR strpos(lower(name), lower(p_q)) > 0
      OR strpos(lower(masked_email), lower(p_q)) > 0 OR user_id::text = p_q
      OR strpos(COALESCE(ip_address, ''), p_q) > 0
  ), page AS (
    SELECT * FROM filtered ORDER BY created_at DESC, session_id DESC LIMIT p_size OFFSET ((p_page::bigint - 1) * p_size)
  ) SELECT jsonb_build_object('items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'sessionId', session_id, 'userId', user_id, 'name', name, 'maskedEmail', masked_email,
    'createdAt', created_at, 'updatedAt', updated_at, 'expiresAt', expires_at,
    'ipAddress', ip_address, 'userAgent', user_agent) ORDER BY created_at DESC, session_id DESC) FROM page), '[]'::jsonb),
    'page', p_page, 'pageSize', p_size, 'total', (SELECT count(*) FROM filtered)) INTO v_result;
  PERFORM public.append_platform_identity_audit(p_actor, 'platform.sessions_queried', p_user, 'succeeded', p_request, NULL);
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.revoke_platform_session(p_actor uuid, p_session uuid, p_target_session uuid, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_user uuid; v_revoked boolean;
BEGIN
  SELECT user_id INTO v_user FROM public.session WHERE id = p_target_session;
  PERFORM user_id FROM public.user_account_status WHERE user_id IN (p_actor, v_user) ORDER BY user_id FOR SHARE;
  PERFORM public.require_platform_action(p_actor,p_session,'platform.session:revoke');
  DELETE FROM public.session WHERE id = p_target_session;
  v_revoked := FOUND;
  PERFORM public.append_platform_identity_audit(p_actor, 'platform.session_revoked', p_target_session,
    CASE WHEN v_revoked THEN 'succeeded' ELSE 'no_change' END, p_request, NULL);
  RETURN jsonb_build_object('sessionId', p_target_session, 'revoked', v_revoked);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_platform_identity_failure(p_actor uuid, p_session uuid, p_event text, p_target uuid, p_request text, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.read_platform_access(p_actor,p_session)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_event IS NULL OR p_event NOT IN ('platform.user_created', 'platform.user_updated', 'platform.user_suspended', 'platform.user_resumed', 'platform.user_password_reset_requested', 'platform.session_revoked','platform.user_password_login_unlocked') OR
    p_error IS NULL OR p_error NOT IN ('FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR', 'VERSION_CONFLICT',
      'LAST_PLATFORM_SUPERADMIN','BUILT_IN_ROLE_IMMUTABLE','EMAIL_ALREADY_EXISTS', 'ACCOUNT_SUSPENDED', 'AUTHORIZATION_UNAVAILABLE', 'AUDIT_UNAVAILABLE', 'INTERNAL_ERROR')
  THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  PERFORM public.append_platform_identity_audit(p_actor, p_event, p_target,
    CASE WHEN p_error = 'FORBIDDEN' THEN 'denied' ELSE 'failed' END, p_request, p_error);
END;
$function$;
--> statement-breakpoint
DROP FUNCTION public.require_platform_user_access(uuid,uuid,boolean);
DROP FUNCTION public.require_platform_organization_access(uuid,uuid,boolean);
DROP FUNCTION public.precheck_platform_identity_write(uuid,uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.create_platform_admin(p_email text, p_name text, p_password_hash text, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
BEGIN
  -- UUID 由函数生成，四项事实原子提交；不能借此修改已有身份。
  INSERT INTO public."user" (id, name, email, email_verified, created_at, updated_at)
  VALUES (v_user_id, p_name, lower(p_email), true, v_now AT TIME ZONE 'UTC', v_now AT TIME ZONE 'UTC');

  INSERT INTO public.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
  VALUES (gen_random_uuid(), v_user_id::text, 'credential', v_user_id, p_password_hash,
    v_now AT TIME ZONE 'UTC', v_now AT TIME ZONE 'UTC');

  INSERT INTO public.platform_assignment (user_id, status, version, granted_at, granted_by, grant_reason)
  VALUES (v_user_id, 'active', 1, v_now, session_user, p_reason);

  INSERT INTO public.platform_assignment_role(user_id,role_id) SELECT v_user_id,id FROM public.platform_role WHERE key='platform_admin';

  INSERT INTO public.platform_assignment_audit (user_id, action, previous_role, next_role, result, reason, actor, created_at)
  VALUES (v_user_id, 'grant', NULL, 'platform_admin', 'changed', p_reason, session_user, v_now);
  RETURN v_user_id;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_login_event(p_user uuid, p_email text, p_method text, p_result text, p_reason text, p_ip text, p_user_agent text, p_request text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_id uuid := gen_random_uuid(); v_user uuid := p_user; v_name text; v_email text; v_masked text;
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('email', 'github', 'totp') OR p_result IS NULL
    OR p_result NOT IN ('succeeded', 'failed') OR (p_result = 'succeeded' AND (p_user IS NULL OR p_reason IS NOT NULL))
    OR (p_reason IS NOT NULL AND p_reason NOT IN ('PASSWORD_LOGIN_LOCKED', 'INVALID_CREDENTIALS', 'EMAIL_NOT_VERIFIED', 'INVALID_OTP', 'ACCOUNT_SUSPENDED', 'AUTHORIZATION_UNAVAILABLE', 'AUTHENTICATION_FAILED'))
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF p_user IS NOT NULL THEN
    SELECT name, email INTO v_name, v_email FROM public."user" WHERE id = p_user;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF p_result = 'succeeded' THEN PERFORM public.require_active_account(p_user); END IF;
  ELSE
    -- 失败认证尚无会话身份；仅按输入邮箱精确关联，未知邮箱不虚构用户。
    SELECT id, name, email INTO v_user, v_name, v_email FROM public."user"
    WHERE email = lower(btrim(p_email));
    IF NOT FOUND THEN v_email := lower(btrim(p_email)); END IF;
  END IF;
  IF v_email ~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    v_masked := left(split_part(v_email, '@', 1), 1) || '***@' || split_part(v_email, '@', 2);
  END IF;
  INSERT INTO public.login_events(id, user_id, name, masked_email, method, result, reason_code, ip_address, user_agent, request_id)
  VALUES (v_id, v_user, v_name, v_masked, p_method, p_result, p_reason, p_ip, p_user_agent, p_request);
  RETURN v_id;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_audit_event_codes(p_scope text)
RETURNS text[] LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $function$
  SELECT CASE p_scope
    WHEN 'platform' THEN ARRAY['platform.access_denied', 'platform.mfa_verified', 'platform.organizations_queried',
      'platform.organization_viewed', 'platform.users_queried', 'platform.user_viewed',
      'platform.user_sensitive_viewed', 'platform.organization_suspended', 'platform.organization_resumed',
      'platform.audit_queried', 'platform.audit_viewed', 'platform.settings_viewed', 'platform.settings_updated',
      'platform.storage_policy_viewed', 'platform.storage_policy_updated',
      'platform.employee_created','platform.user_password_login_unlocked','platform.user_created', 'platform.user_updated', 'platform.user_suspended', 'platform.user_resumed', 'platform.user_password_reset_requested', 'platform.session_revoked', 'platform.sessions_queried', 'platform.login_logs_queried']
    WHEN 'tenant' THEN ARRAY['member.invited', 'invitation.resent', 'invitation.accepted', 'invitation.rejected',
      'invitation.canceled', 'member.role_changed', 'member.removed', 'member.left',
      'role.created', 'role.updated', 'role.deleted', 'organization.settings_updated',
      'invitation.delivery_smtp_accepted', 'invitation.delivery_failed', 'invitation.delivery_unknown']
    ELSE ARRAY[]::text[]
  END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.manage_platform_assignment(p_action text,p_user uuid,p_role text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE v_role uuid; v_changed boolean:=false; v_assignment_changed boolean:=false;
BEGIN
 PERFORM public.lock_platform_authorization();
 IF p_action NOT IN ('grant','revoke') OR p_reason IS NULL OR length(btrim(p_reason))=0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."user" WHERE id=p_user) THEN RAISE EXCEPTION 'PLATFORM_USER_NOT_FOUND'; END IF;
 IF p_action='grant' AND NOT EXISTS(SELECT 1 FROM public."user" WHERE id=p_user AND email_verified) THEN RAISE EXCEPTION 'PLATFORM_EMAIL_UNVERIFIED'; END IF;
 SELECT id INTO v_role FROM public.platform_role WHERE key=p_role AND (p_action='revoke' OR status='active');
 IF NOT FOUND THEN RAISE EXCEPTION 'PLATFORM_ROLE_NOT_FOUND'; END IF;
 IF p_action='grant' THEN
   INSERT INTO public.platform_assignment(user_id,status,version,granted_at,granted_by,grant_reason)
   VALUES(p_user,'active',1,clock_timestamp(),session_user,p_reason)
   ON CONFLICT(user_id) DO UPDATE SET status='active',version=platform_assignment.version+1,
   granted_at=clock_timestamp(),granted_by=session_user,grant_reason=p_reason,revoked_at=NULL,revoked_by=NULL,revoke_reason=NULL WHERE platform_assignment.status<>'active';
   v_assignment_changed:=FOUND;
   INSERT INTO public.platform_assignment_role(user_id,role_id) VALUES(p_user,v_role) ON CONFLICT DO NOTHING;
   v_changed:=FOUND;
   IF v_changed AND NOT v_assignment_changed THEN UPDATE public.platform_assignment SET version=version+1 WHERE user_id=p_user; END IF;
 ELSE
   DELETE FROM public.platform_assignment_role WHERE user_id=p_user AND role_id=v_role;
   v_changed:=FOUND;
   IF v_changed AND NOT EXISTS(SELECT 1 FROM public.platform_assignment_role WHERE user_id=p_user) THEN
    UPDATE public.platform_assignment SET status='revoked',version=version+1,revoked_at=clock_timestamp(),revoked_by=session_user,revoke_reason=p_reason WHERE user_id=p_user;
   ELSIF v_changed THEN UPDATE public.platform_assignment SET version=version+1 WHERE user_id=p_user;
   END IF;
 END IF;
 INSERT INTO public.platform_assignment_audit(user_id,action,previous_role,next_role,result,reason,actor,created_at)
 VALUES(p_user,p_action,CASE WHEN p_action='revoke' AND v_changed THEN p_role END,CASE WHEN p_action='grant' THEN p_role END,
 CASE WHEN v_changed THEN 'changed' ELSE 'no_change' END,p_reason,session_user,clock_timestamp());
END; $function$;
--> statement-breakpoint
ALTER TABLE public.platform_assignment_audit DROP CONSTRAINT platform_assignment_audit_previous_role_check;
ALTER TABLE public.platform_assignment_audit DROP CONSTRAINT platform_assignment_audit_next_role_check;
CREATE FUNCTION public.create_platform_employee(p_actor uuid,p_session uuid,p_email text,p_name text,p_password_hash text,p_roles uuid[],p_reason text,p_request text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE v_user uuid:=gen_random_uuid(); v_now timestamptz:=clock_timestamp();
BEGIN
 PERFORM public.lock_platform_authorization();
 PERFORM public.require_platform_action(p_actor,p_session,'platform.authorization:manage');
 IF p_name IS NULL OR length(btrim(p_name))=0 OR p_email IS NULL OR length(btrim(p_email))=0 OR p_password_hash IS NULL OR length(p_password_hash)=0
 OR p_roles IS NULL OR p_reason IS NULL OR length(btrim(p_reason))=0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_roles) role_id WHERE NOT EXISTS(SELECT 1 FROM public.platform_role r WHERE r.id=role_id AND r.status='active')) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 INSERT INTO public."user"(id,name,email,email_verified,created_at,updated_at) VALUES(v_user,btrim(p_name),lower(btrim(p_email)),true,v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');
 INSERT INTO public.account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(gen_random_uuid(),v_user::text,'credential',v_user,p_password_hash,v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');
 INSERT INTO public.platform_assignment(user_id,status,version,granted_at,granted_by,grant_reason) VALUES(v_user,'active',1,v_now,p_actor::text,p_reason);
 INSERT INTO public.platform_assignment_role(user_id,role_id) SELECT v_user,role_id FROM unnest(p_roles) role_id;
 PERFORM public.append_platform_identity_audit(p_actor,'platform.employee_created',v_user,'succeeded',p_request,NULL);
 RETURN v_user;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'EMAIL_ALREADY_EXISTS';
END; $function$;
--> statement-breakpoint
CREATE FUNCTION public.begin_password_login(p_email text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE v_user uuid; v_until timestamptz;
BEGIN
 SELECT id INTO v_user FROM public."user" WHERE email=lower(p_email);
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO public.password_login_lock(user_id) VALUES(v_user) ON CONFLICT DO NOTHING;
 SELECT locked_until INTO v_until FROM public.password_login_lock WHERE user_id=v_user FOR UPDATE;
 IF v_until>clock_timestamp() THEN RAISE EXCEPTION 'PASSWORD_LOGIN_LOCKED'; END IF;
 IF v_until IS NOT NULL THEN UPDATE public.password_login_lock SET failure_times='{}',locked_until=NULL WHERE user_id=v_user; END IF;
 RETURN v_user;
END; $function$;
--> statement-breakpoint
CREATE FUNCTION public.finish_password_login(p_user uuid,p_success boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE v_times timestamptz[]; v_now timestamptz:=clock_timestamp();
BEGIN
 IF p_success THEN UPDATE public.password_login_lock SET failure_times='{}',locked_until=NULL WHERE user_id=p_user;
 ELSE
  SELECT ARRAY(SELECT failed_at FROM unnest(failure_times) failed_at WHERE failed_at>v_now-interval '15 minutes')||v_now
  INTO v_times FROM public.password_login_lock WHERE user_id=p_user FOR UPDATE;
  UPDATE public.password_login_lock SET failure_times=v_times,locked_until=CASE WHEN cardinality(v_times)>=5 THEN v_now+interval '15 minutes' END WHERE user_id=p_user;
 END IF;
END; $function$;
--> statement-breakpoint
CREATE FUNCTION public.unlock_platform_password_login(p_actor uuid,p_session uuid,p_user uuid,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE v_changed boolean;
BEGIN
 -- 解锁可能等待验密行锁；先与授权变更串行，避免等待结束后使用已撤销权限。
 PERFORM public.lock_platform_authorization();
 PERFORM public.require_platform_action(p_actor,p_session,'platform.user:unlock');
 IF NOT EXISTS(SELECT 1 FROM public."user" WHERE id=p_user) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 UPDATE public.password_login_lock SET failure_times='{}',locked_until=NULL WHERE user_id=p_user AND (cardinality(failure_times)>0 OR locked_until IS NOT NULL);
 v_changed:=FOUND;
 PERFORM public.append_platform_identity_audit(p_actor,'platform.user_password_login_unlocked',p_user,CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END,p_request,NULL);
 RETURN jsonb_build_object('userId',p_user,'changed',v_changed,'lockedUntil',NULL);
END; $function$;
CREATE POLICY audit_events_platform_authorization_insert ON public.audit_events FOR INSERT TO platform_executor
WITH CHECK(scope='platform' AND organization_id IS NULL AND NOT tenant_visible AND event_code IN ('platform.employee_created','platform.user_password_login_unlocked'));

--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.platform_permission_catalog() OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.platform_permission_catalog() FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
ALTER FUNCTION public.read_platform_access(uuid,uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.read_platform_access(uuid,uuid) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.read_platform_access(uuid,uuid) TO app_runtime;
ALTER FUNCTION public.require_platform_action(uuid,uuid,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.require_platform_action(uuid,uuid,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
ALTER FUNCTION public.lock_platform_authorization() OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.lock_platform_authorization() FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
ALTER FUNCTION public.lock_platform_authorization_change() OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.lock_platform_authorization_change() FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
ALTER FUNCTION public.guard_platform_role() OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.guard_platform_role() FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
ALTER FUNCTION public.clear_inactive_platform_roles() OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.clear_inactive_platform_roles() FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
ALTER FUNCTION public.guard_last_platform_superadmin() OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.guard_last_platform_superadmin() FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
ALTER FUNCTION public.manage_platform_assignment(text,uuid,text,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.manage_platform_assignment(text,uuid,text,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.manage_platform_assignment(text,uuid,text,text) TO platform_deployer;
ALTER FUNCTION public.create_platform_employee(uuid,uuid,text,text,text,uuid[],text,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.create_platform_employee(uuid,uuid,text,text,text,uuid[],text,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.create_platform_employee(uuid,uuid,text,text,text,uuid[],text,text) TO app_runtime;
ALTER FUNCTION public.begin_password_login(text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.begin_password_login(text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.begin_password_login(text) TO app_runtime;
ALTER FUNCTION public.finish_password_login(uuid,boolean) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.finish_password_login(uuid,boolean) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.finish_password_login(uuid,boolean) TO app_runtime;
ALTER FUNCTION public.unlock_platform_password_login(uuid,uuid,uuid,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.unlock_platform_password_login(uuid,uuid,uuid,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.unlock_platform_password_login(uuid,uuid,uuid,text) TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM platform_executor;

GRANT EXECUTE ON FUNCTION public.platform_permission_catalog() TO app_runtime;
