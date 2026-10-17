-- 状态属于全局身份；认证表继续由 Better Auth 生成，已有身份与新身份使用同一初始化路径。
INSERT INTO public.user_account_status(user_id, status, version, updated_at)
SELECT id, 'active', 1, clock_timestamp() FROM public."user";
ALTER TABLE public.user_account_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_account_status FORCE ROW LEVEL SECURITY;
ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_events FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.user_account_status TO platform_executor;
GRANT UPDATE(status, version, updated_at) ON public.user_account_status TO platform_executor;
GRANT SELECT, INSERT ON public.login_events TO platform_executor;
CREATE POLICY account_status_executor_read ON public.user_account_status FOR SELECT TO platform_executor USING (true);
CREATE POLICY account_status_executor_insert ON public.user_account_status FOR INSERT TO platform_executor WITH CHECK (true);
CREATE POLICY account_status_executor_update ON public.user_account_status FOR UPDATE TO platform_executor USING (true) WITH CHECK (true);
CREATE POLICY login_events_executor_read ON public.login_events FOR SELECT TO platform_executor USING (true);
CREATE POLICY login_events_executor_insert ON public.login_events FOR INSERT TO platform_executor WITH CHECK (true);
GRANT UPDATE(name, updated_at) ON public."user" TO platform_executor;
GRANT SELECT(created_at, updated_at, ip_address, user_agent), DELETE ON public.session TO platform_executor;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.initialize_user_account_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  INSERT INTO public.user_account_status(user_id, status, version, updated_at)
  VALUES (NEW.id, 'active', 1, clock_timestamp());
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE TRIGGER user_initialize_account_status AFTER INSERT ON public."user"
FOR EACH ROW EXECUTE FUNCTION public.initialize_user_account_status();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.advance_user_account_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  -- 原生 updateUser 与平台姓名编辑共享同一版本，不能让直接认证写入绕过并发检查。
  UPDATE public.user_account_status SET version = version + 1, updated_at = clock_timestamp()
  WHERE user_id = NEW.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE TRIGGER user_name_account_version AFTER UPDATE OF name ON public."user"
FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name)
EXECUTE FUNCTION public.advance_user_account_version();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.require_active_account(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_status text;
BEGIN
  -- 授权读锁持续到调用方事务结束；暂停先取得状态写锁，再清除会话。
  SELECT status INTO v_status FROM public.user_account_status WHERE user_id = p_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  IF v_status = 'suspended' THEN RAISE EXCEPTION 'ACCOUNT_SUSPENDED'; END IF;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.read_platform_access(p_user_id uuid, p_session_id uuid)
RETURNS TABLE(role text, two_factor_enabled boolean, mfa_verified_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."user" WHERE id = p_user_id) THEN RETURN; END IF;
  PERFORM public.require_active_account(p_user_id);
  RETURN QUERY SELECT assignment.role, account.two_factor_enabled, assurance.verified_at
  FROM public.platform_assignment AS assignment
  JOIN public."user" AS account ON account.id = assignment.user_id
  JOIN public.session AS active_session ON active_session.id = p_session_id
    AND active_session.user_id = p_user_id AND active_session.expires_at > clock_timestamp()
  LEFT JOIN public.platform_session_assurance AS assurance
    ON assurance.session_id = active_session.id AND assurance.user_id = active_session.user_id
  WHERE assignment.user_id = p_user_id AND assignment.status = 'active';
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.require_identity_session(p_actor uuid, p_session uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  PERFORM public.require_active_account(p_actor);
  IF NOT EXISTS (SELECT 1 FROM public.session WHERE id = p_session AND user_id = p_actor
    AND expires_at > clock_timestamp()) THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
END;
$function$;
--> statement-breakpoint
CREATE POLICY audit_events_platform_identity_insert ON public.audit_events FOR INSERT TO platform_executor
WITH CHECK (scope = 'platform' AND organization_id IS NULL AND NOT tenant_visible
  AND event_code IN ('platform.user_created', 'platform.user_updated', 'platform.user_suspended', 'platform.user_resumed', 'platform.user_password_reset_requested', 'platform.session_revoked', 'platform.sessions_queried', 'platform.login_logs_queried'));
CREATE POLICY audit_events_personal_login_read_insert ON public.audit_events FOR INSERT TO platform_executor
WITH CHECK (scope = 'user' AND organization_id IS NULL AND NOT tenant_visible AND event_code = 'user.login_logs_queried');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.append_platform_identity_audit(p_actor uuid, p_event text, p_target uuid, p_result text, p_request text, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, resource_id, result, request_id, fields)
  VALUES ('platform', p_event, p_actor,
    CASE WHEN p_event = 'platform.session_revoked' THEN 'session' ELSE 'user' END,
    p_target, p_result, p_request,
    CASE WHEN p_error IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('errorCode', p_error) END);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE';
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_platform_identity_failure(p_actor uuid, p_session uuid, p_event text, p_target uuid, p_request text, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  PERFORM public.require_platform_user_access(p_actor, p_session, false);
  IF p_event IS NULL OR p_event NOT IN ('platform.user_created', 'platform.user_updated', 'platform.user_suspended', 'platform.user_resumed', 'platform.user_password_reset_requested', 'platform.session_revoked') OR
    p_error IS NULL OR p_error NOT IN ('FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR', 'VERSION_CONFLICT',
      'EMAIL_ALREADY_EXISTS', 'ACCOUNT_SUSPENDED', 'AUTHORIZATION_UNAVAILABLE', 'AUDIT_UNAVAILABLE', 'INTERNAL_ERROR')
  THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  PERFORM public.append_platform_identity_audit(p_actor, p_event, p_target,
    CASE WHEN p_error = 'FORBIDDEN' THEN 'denied' ELSE 'failed' END, p_request, p_error);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.create_platform_user(p_actor uuid, p_session uuid, p_name text, p_email text, p_password_hash text, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_user uuid := gen_random_uuid(); v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM public.require_platform_user_access(p_actor, p_session, true);
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
  RETURN public.get_platform_user(p_actor, p_session, v_user, p_request);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'EMAIL_ALREADY_EXISTS';
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.update_platform_user(p_actor uuid, p_session uuid, p_user uuid, p_name text, p_expected integer, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_state public.user_account_status%ROWTYPE; v_name text; v_changed boolean;
BEGIN
  PERFORM public.precheck_platform_identity_write(p_actor, p_session);
  -- 原生姓名写先锁 user 再由版本触发器锁 status；平台写遵循同一顺序。
  PERFORM id FROM public."user" WHERE id = p_user FOR UPDATE;
  PERFORM user_id FROM public.user_account_status WHERE user_id IN (p_actor, p_user) ORDER BY user_id FOR UPDATE;
  PERFORM public.require_platform_user_access(p_actor, p_session, true);
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
  PERFORM public.precheck_platform_identity_write(p_actor, p_session);
  PERFORM user_id FROM public.user_account_status WHERE user_id IN (p_actor, p_user) ORDER BY user_id FOR UPDATE;
  PERFORM public.require_platform_user_access(p_actor, p_session, true);
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
  PERFORM public.precheck_platform_identity_write(p_actor, p_session);
  PERFORM user_id FROM public.user_account_status WHERE user_id IN (p_actor, p_user) ORDER BY user_id FOR SHARE;
  PERFORM public.require_platform_user_access(p_actor, p_session, true);
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
  PERFORM public.require_platform_user_access(p_actor, p_session, true);
  PERFORM public.append_platform_identity_audit(p_actor, 'platform.user_password_reset_requested', p_user, 'succeeded', p_request, NULL);
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
    OR (p_reason IS NOT NULL AND p_reason NOT IN ('INVALID_CREDENTIALS', 'EMAIL_NOT_VERIFIED', 'INVALID_OTP', 'ACCOUNT_SUSPENDED', 'AUTHORIZATION_UNAVAILABLE', 'AUTHENTICATION_FAILED'))
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
CREATE OR REPLACE FUNCTION public.read_login_events_page(p_q text, p_user uuid, p_result text, p_method text, p_from timestamptz, p_to timestamptz, p_page integer, p_size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_page IS NULL OR p_page < 1 OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 100
    OR length(p_q) > 200 OR (p_result IS NOT NULL AND p_result NOT IN ('succeeded', 'failed'))
    OR (p_method IS NOT NULL AND p_method NOT IN ('email', 'github', 'totp'))
    OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  WITH filtered AS (
    SELECT * FROM public.login_events e WHERE (p_user IS NULL OR e.user_id = p_user)
      AND (p_result IS NULL OR e.result = p_result) AND (p_method IS NULL OR e.method = p_method)
      AND (p_from IS NULL OR e.occurred_at >= p_from) AND (p_to IS NULL OR e.occurred_at <= p_to)
      AND (p_q IS NULL OR strpos(lower(e.name), lower(p_q)) > 0
        OR strpos(lower(e.masked_email), lower(p_q)) > 0 OR e.user_id::text = p_q)
  ), page AS (
    SELECT * FROM filtered ORDER BY occurred_at DESC, id DESC LIMIT p_size OFFSET ((p_page::bigint - 1) * p_size)
  ) SELECT jsonb_build_object('items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'userId', user_id, 'name', name, 'maskedEmail', masked_email, 'occurredAt', occurred_at,
    'method', method, 'result', result, 'reasonCode', reason_code, 'ipAddress', ip_address, 'userAgent', user_agent)
    ORDER BY occurred_at DESC, id DESC) FROM page), '[]'::jsonb),
    'page', p_page, 'pageSize', p_size, 'total', (SELECT count(*) FROM filtered)) INTO v_result;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_platform_login_logs(p_actor uuid, p_session uuid, p_q text, p_user uuid, p_result text, p_method text, p_from timestamptz, p_to timestamptz, p_page integer, p_size integer, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_user_access(p_actor, p_session, false);
  v_result := public.read_login_events_page(p_q, p_user, p_result, p_method, p_from, p_to, p_page, p_size);
  PERFORM public.append_platform_identity_audit(p_actor, 'platform.login_logs_queried', p_user, 'succeeded', p_request, NULL);
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_personal_login_logs(p_actor uuid, p_session uuid, p_result text, p_method text, p_from timestamptz, p_to timestamptz, p_page integer, p_size integer, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_identity_session(p_actor, p_session);
  v_result := public.read_login_events_page(NULL, p_actor, p_result, p_method, p_from, p_to, p_page, p_size);
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, result, request_id, fields)
    VALUES ('user', 'user.login_logs_queried', p_actor, 'succeeded', p_request, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_platform_sessions(p_actor uuid, p_session uuid, p_q text, p_user uuid, p_page integer, p_size integer, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_user_access(p_actor, p_session, false);
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
  PERFORM public.precheck_platform_identity_write(p_actor, p_session);
  SELECT user_id INTO v_user FROM public.session WHERE id = p_target_session;
  PERFORM user_id FROM public.user_account_status WHERE user_id IN (p_actor, v_user) ORDER BY user_id FOR SHARE;
  PERFORM public.require_platform_user_access(p_actor, p_session, true);
  DELETE FROM public.session WHERE id = p_target_session;
  v_revoked := FOUND;
  PERFORM public.append_platform_identity_audit(p_actor, 'platform.session_revoked', p_target_session,
    CASE WHEN v_revoked THEN 'succeeded' ELSE 'no_change' END, p_request, NULL);
  RETURN jsonb_build_object('sessionId', p_target_session, 'revoked', v_revoked);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_platform_users(p_actor uuid, p_session uuid, p_q text, p_page integer, p_size integer, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_user_access(p_actor, p_session, false);
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
    'userId', id, 'name', name, 'maskedEmail', masked_email, 'emailVerified', email_verified,
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
  PERFORM public.require_platform_user_access(p_actor, p_session, false);
  IF EXISTS (SELECT 1 FROM public.member m LEFT JOIN public.organization_status s ON s.organization_id = m.organization_id
    WHERE m.user_id = p_user AND s.organization_id IS NULL) THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  IF EXISTS (SELECT 1 FROM public."user" u LEFT JOIN public.user_account_status s ON s.user_id = u.id
    WHERE u.id = p_user AND s.user_id IS NULL) THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  SELECT jsonb_build_object('userId', u.id, 'name', u.name,
    'maskedEmail', left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2),
    'emailVerified', u.email_verified, 'createdAt', u.created_at AT TIME ZONE 'UTC',
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
CREATE OR REPLACE FUNCTION public.platform_audit_event_codes(p_scope text)
RETURNS text[] LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $function$
  SELECT CASE p_scope
    WHEN 'platform' THEN ARRAY['platform.access_denied', 'platform.mfa_verified', 'platform.organizations_queried',
      'platform.organization_viewed', 'platform.users_queried', 'platform.user_viewed',
      'platform.user_sensitive_viewed', 'platform.organization_suspended', 'platform.organization_resumed',
      'platform.audit_queried', 'platform.audit_viewed', 'platform.settings_viewed', 'platform.settings_updated',
      'platform.storage_policy_viewed', 'platform.storage_policy_updated',
      'platform.user_created', 'platform.user_updated', 'platform.user_suspended', 'platform.user_resumed', 'platform.user_password_reset_requested', 'platform.session_revoked', 'platform.sessions_queried', 'platform.login_logs_queried']
    WHEN 'tenant' THEN ARRAY['member.invited', 'invitation.resent', 'invitation.accepted', 'invitation.rejected',
      'invitation.canceled', 'member.role_changed', 'member.removed', 'member.left',
      'role.created', 'role.updated', 'role.deleted', 'organization.settings_updated',
      'invitation.delivery_smtp_accepted', 'invitation.delivery_failed', 'invitation.delivery_unknown']
    ELSE ARRAY[]::text[]
  END;
$function$;
--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
--> statement-breakpoint
ALTER FUNCTION public.initialize_user_account_status() OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.initialize_user_account_status() FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
--> statement-breakpoint
ALTER FUNCTION public.advance_user_account_version() OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.advance_user_account_version() FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
--> statement-breakpoint
ALTER FUNCTION public.require_active_account(uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.require_active_account(uuid) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.require_active_account(uuid) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION public.read_platform_access(uuid, uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.read_platform_access(uuid, uuid) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.read_platform_access(uuid, uuid) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION public.require_identity_session(uuid, uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.require_identity_session(uuid, uuid) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
--> statement-breakpoint
ALTER FUNCTION public.append_platform_identity_audit(uuid, text, uuid, text, text, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.append_platform_identity_audit(uuid, text, uuid, text, text, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
--> statement-breakpoint
ALTER FUNCTION public.record_platform_identity_failure(uuid, uuid, text, uuid, text, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.record_platform_identity_failure(uuid, uuid, text, uuid, text, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.record_platform_identity_failure(uuid, uuid, text, uuid, text, text) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION public.create_platform_user(uuid, uuid, text, text, text, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.create_platform_user(uuid, uuid, text, text, text, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.create_platform_user(uuid, uuid, text, text, text, text) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION public.update_platform_user(uuid, uuid, uuid, text, integer, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.update_platform_user(uuid, uuid, uuid, text, integer, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.update_platform_user(uuid, uuid, uuid, text, integer, text) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION public.set_platform_user_status(uuid, uuid, uuid, text, integer, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.set_platform_user_status(uuid, uuid, uuid, text, integer, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.set_platform_user_status(uuid, uuid, uuid, text, integer, text) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION public.prepare_platform_password_reset(uuid, uuid, uuid, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.prepare_platform_password_reset(uuid, uuid, uuid, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.prepare_platform_password_reset(uuid, uuid, uuid, text) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION public.record_platform_password_reset_requested(uuid, uuid, uuid, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.record_platform_password_reset_requested(uuid, uuid, uuid, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.record_platform_password_reset_requested(uuid, uuid, uuid, text) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION public.record_login_event(uuid, text, text, text, text, text, text, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.record_login_event(uuid, text, text, text, text, text, text, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.record_login_event(uuid, text, text, text, text, text, text, text) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION public.read_login_events_page(text, uuid, text, text, timestamptz, timestamptz, integer, integer) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.read_login_events_page(text, uuid, text, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
--> statement-breakpoint
ALTER FUNCTION public.list_platform_login_logs(uuid, uuid, text, uuid, text, text, timestamptz, timestamptz, integer, integer, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.list_platform_login_logs(uuid, uuid, text, uuid, text, text, timestamptz, timestamptz, integer, integer, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.list_platform_login_logs(uuid, uuid, text, uuid, text, text, timestamptz, timestamptz, integer, integer, text) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION public.list_personal_login_logs(uuid, uuid, text, text, timestamptz, timestamptz, integer, integer, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.list_personal_login_logs(uuid, uuid, text, text, timestamptz, timestamptz, integer, integer, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.list_personal_login_logs(uuid, uuid, text, text, timestamptz, timestamptz, integer, integer, text) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION public.list_platform_sessions(uuid, uuid, text, uuid, integer, integer, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.list_platform_sessions(uuid, uuid, text, uuid, integer, integer, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.list_platform_sessions(uuid, uuid, text, uuid, integer, integer, text) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION public.revoke_platform_session(uuid, uuid, uuid, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.revoke_platform_session(uuid, uuid, uuid, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.revoke_platform_session(uuid, uuid, uuid, text) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION public.list_platform_users(uuid, uuid, text, integer, integer, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.list_platform_users(uuid, uuid, text, integer, integer, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.list_platform_users(uuid, uuid, text, integer, integer, text) TO app_runtime;
--> statement-breakpoint
ALTER FUNCTION public.get_platform_user(uuid, uuid, uuid, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.get_platform_user(uuid, uuid, uuid, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.get_platform_user(uuid, uuid, uuid, text) TO app_runtime;
--> statement-breakpoint
CREATE FUNCTION public.precheck_platform_identity_write(p_actor uuid, p_session uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  -- 只检查操作者，不锁目标；真正写入前在既定锁序下重新验证任职。
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_assignment a
    JOIN public.session s ON s.user_id = a.user_id
    JOIN public.user_account_status state ON state.user_id = a.user_id
    WHERE a.user_id = p_actor AND a.role = 'platform_admin' AND a.status = 'active'
      AND s.id = p_session AND s.expires_at > clock_timestamp() AND state.status = 'active'
  ) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
END;
$function$;
--> statement-breakpoint
ALTER FUNCTION public.precheck_platform_identity_write(uuid, uuid) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.precheck_platform_identity_write(uuid, uuid) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
--> statement-breakpoint
CREATE FUNCTION public.guard_native_session_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- 原生钩子在 adapter 事务外；共享锁必须由实际 INSERT 的事务持有。
    PERFORM public.require_active_account(NEW.user_id);
  ELSE
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    -- UPDATE 已持有 session 行锁，不能反向等待状态锁。暂停的 DELETE 等待该更新完成，
    -- 或先删除行使后续 UPDATE 匹配零行；两种次序都不会在恢复时复活旧会话。
    SELECT status INTO v_status FROM public.user_account_status WHERE user_id = NEW.user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
    IF v_status <> 'active' THEN RAISE EXCEPTION 'ACCOUNT_SUSPENDED'; END IF;
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
ALTER FUNCTION public.guard_native_session_account() OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.guard_native_session_account() FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
--> statement-breakpoint
CREATE TRIGGER session_require_active_account BEFORE INSERT OR UPDATE ON public.session
FOR EACH ROW EXECUTE FUNCTION public.guard_native_session_account();
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM platform_executor;
