CREATE TABLE "platform_settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"default_locale" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "platform_settings_singleton_check" CHECK ("platform_settings"."singleton"),
	CONSTRAINT "platform_settings_locale_check" CHECK ("platform_settings"."default_locale" IN ('zh-CN', 'en-US', 'ar')),
	CONSTRAINT "platform_settings_version_check" CHECK ("platform_settings"."version" >= 1)
);
--> statement-breakpoint
-- 平台语言是单例事实；沿用现有初始值，不改写个人或组织偏好。
INSERT INTO public.platform_settings (singleton, default_locale, version) VALUES (true, 'zh-CN', 1);
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings FORCE ROW LEVEL SECURITY;
GRANT SELECT (singleton, default_locale) ON public.platform_settings TO app_runtime;
CREATE POLICY platform_locale_runtime_read ON public.platform_settings FOR SELECT TO app_runtime USING (singleton);
GRANT SELECT ON public.platform_settings TO platform_executor;
GRANT UPDATE (default_locale, version) ON public.platform_settings TO platform_executor;
CREATE POLICY platform_settings_executor_read ON public.platform_settings FOR SELECT TO platform_executor USING (singleton);
CREATE POLICY platform_settings_executor_update ON public.platform_settings FOR UPDATE TO platform_executor USING (singleton) WITH CHECK (singleton);
CREATE POLICY audit_events_platform_settings_insert ON public.audit_events FOR INSERT TO platform_executor WITH CHECK (
  scope = 'platform' AND organization_id IS NULL AND NOT tenant_visible
  AND event_code IN ('platform.settings_viewed', 'platform.settings_updated')
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.is_platform_audit_event(p_scope text, p_code text)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $function$
  SELECT (p_scope = 'platform' AND p_code IN (
    'platform.access_denied', 'platform.mfa_verified', 'platform.organizations_queried',
    'platform.organization_viewed', 'platform.users_queried', 'platform.user_viewed',
    'platform.user_sensitive_viewed', 'platform.organization_suspended',
    'platform.organization_resumed', 'platform.audit_queried', 'platform.audit_viewed',
    'platform.settings_viewed', 'platform.settings_updated'
  )) OR (p_scope = 'tenant' AND p_code IN (
    'member.invited', 'invitation.resent', 'invitation.accepted', 'invitation.rejected',
    'invitation.canceled', 'member.role_changed', 'member.removed', 'member.left',
    'role.created', 'role.updated', 'role.deleted', 'organization.settings_updated',
    'invitation.delivery_smtp_accepted', 'invitation.delivery_failed', 'invitation.delivery_unknown'
  ));
$function$;
--> statement-breakpoint
CREATE FUNCTION public.get_platform_settings(p_actor uuid, p_session uuid, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_organization_access(p_actor, p_session, false);
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
CREATE FUNCTION public.update_platform_settings(p_actor uuid, p_session uuid, p_locale text,
  p_reason text, p_expected integer, p_key text, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_locale text; v_version integer; v_changed boolean; v_result jsonb;
  v_hash text; v_receipt record; v_operation uuid;
BEGIN
  PERFORM public.require_platform_organization_access(p_actor, p_session, true);
  IF p_locale IS NULL OR p_locale NOT IN ('zh-CN', 'en-US', 'ar') OR p_reason IS NULL
    OR length(btrim(p_reason)) NOT BETWEEN 10 AND 500 OR p_expected IS NULL OR p_expected < 1
    OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 128 OR p_key !~ '^[A-Za-z0-9:_-]+$' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;
  SELECT default_locale, version INTO v_locale, v_version FROM public.platform_settings WHERE singleton = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE'; END IF;
  -- 等待单例写锁期间权限可能变化；旧收据也必须通过当前权限和近期 MFA。
  PERFORM public.require_platform_organization_access(p_actor, p_session, true);
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
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.get_platform_settings(uuid, uuid, text) OWNER TO platform_executor;
ALTER FUNCTION public.update_platform_settings(uuid, uuid, text, text, integer, text, text) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.get_platform_settings(uuid, uuid, text) FROM PUBLIC, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.update_platform_settings(uuid, uuid, text, text, integer, text, text) FROM PUBLIC, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.get_platform_settings(uuid, uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.update_platform_settings(uuid, uuid, text, text, integer, text, text) TO app_runtime;
