GRANT CREATE ON SCHEMA public TO platform_executor;
--> statement-breakpoint
CREATE FUNCTION public.is_platform_audit_event(p_scope text, p_code text)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $function$
  SELECT (p_scope = 'platform' AND p_code IN (
    'platform.access_denied', 'platform.mfa_verified', 'platform.organizations_queried',
    'platform.organization_viewed', 'platform.users_queried', 'platform.user_viewed',
    'platform.user_sensitive_viewed', 'platform.organization_suspended',
    'platform.organization_resumed', 'platform.audit_queried', 'platform.audit_viewed',
    'platform.settings_updated'
  )) OR (p_scope = 'tenant' AND p_code IN (
    'member.invited', 'invitation.resent', 'invitation.accepted', 'invitation.rejected',
    'invitation.canceled', 'member.role_changed', 'member.removed', 'member.left',
    'role.created', 'role.updated', 'role.deleted', 'organization.settings_updated',
    'invitation.delivery_smtp_accepted', 'invitation.delivery_failed', 'invitation.delivery_unknown'
  ));
$function$;
ALTER FUNCTION public.is_platform_audit_event(text, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.is_platform_audit_event(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT (actor_type, resource_type, resource_id) ON public.audit_events TO platform_executor;
GRANT SELECT (id, user_id, action, previous_role, next_role, result, created_at)
  ON public.platform_assignment_audit TO platform_executor;
CREATE POLICY audit_events_platform_operations_select ON public.audit_events
FOR SELECT TO platform_executor USING (public.is_platform_audit_event(scope, event_code));
CREATE POLICY audit_events_platform_audit_insert ON public.audit_events
FOR INSERT TO platform_executor WITH CHECK (
  scope = 'platform' AND NOT tenant_visible AND event_code IN (
    'platform.audit_queried', 'platform.audit_viewed', 'platform.mfa_verified'
  )
);
--> statement-breakpoint
-- 仅投影已批准的运营事实；内部目的、部署操作者字符串和任意 metadata 不进入读取接口。
CREATE VIEW public.platform_audit_projection WITH (security_invoker = true) AS
SELECT 'event:' || a.id::text AS id, a.occurred_at, a.organization_id, a.actor_id, a.event_code, a.result,
  jsonb_build_object(
    'id', 'event:' || a.id::text, 'occurredAt', a.occurred_at, 'scope', a.scope,
    'targetOrganization', CASE WHEN a.organization_id IS NULL THEN NULL ELSE
      jsonb_build_object('organizationId', a.organization_id, 'name', o.name) END,
    'eventCode', a.event_code, 'actorType', a.actor_type, 'actorId', a.actor_id,
    'actorMaskedEmail', CASE WHEN u.email IS NULL THEN NULL ELSE left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2) END,
    'resourceType', a.resource_type, 'resourceId', a.resource_id, 'result', a.result,
    'metadata', '{}'::jsonb
  ) AS event
FROM public.audit_events a
LEFT JOIN public.organization o ON o.id = a.organization_id
LEFT JOIN public."user" u ON u.id = a.actor_id
WHERE public.is_platform_audit_event(a.scope, a.event_code)
UNION ALL
SELECT 'assignment:' || a.id::text, a.created_at, NULL::uuid, NULL::uuid,
  CASE a.action WHEN 'grant' THEN 'platform.role_granted' ELSE 'platform.role_revoked' END,
  CASE a.result WHEN 'changed' THEN 'succeeded' ELSE 'no_change' END,
  jsonb_build_object(
    'id', 'assignment:' || a.id::text, 'occurredAt', a.created_at, 'scope', 'platform',
    'targetOrganization', NULL, 'eventCode', CASE a.action WHEN 'grant' THEN 'platform.role_granted' ELSE 'platform.role_revoked' END,
    'actorType', 'deployment_operator', 'actorId', NULL, 'actorMaskedEmail', NULL,
    'resourceType', 'user', 'resourceId', a.user_id,
    'result', CASE a.result WHEN 'changed' THEN 'succeeded' ELSE 'no_change' END,
    'metadata', jsonb_build_object('previousRole', a.previous_role, 'nextRole', a.next_role)
  )
FROM public.platform_assignment_audit a;
ALTER VIEW public.platform_audit_projection OWNER TO platform_executor;
REVOKE ALL ON public.platform_audit_projection FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
--> statement-breakpoint
CREATE FUNCTION public.list_platform_audit_events(
  p_actor uuid, p_session uuid, p_purpose text, p_from timestamptz, p_to timestamptz,
  p_organization uuid, p_filter_actor uuid, p_event text, p_result text,
  p_before_at timestamptz, p_before_id text, p_limit integer, p_request text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_items jsonb; v_next jsonb; v_rows jsonb;
BEGIN
  PERFORM public.require_platform_user_access(p_actor, p_session, false);
  IF p_purpose IS NULL OR length(btrim(p_purpose)) NOT BETWEEN 1 AND 500 OR
    p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to > clock_timestamp() OR
    p_to - p_from > interval '90 days' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR
    (p_result IS NOT NULL AND p_result NOT IN ('succeeded', 'denied', 'failed', 'no_change')) OR
    (p_event IS NOT NULL AND length(btrim(p_event)) NOT BETWEEN 1 AND 120) OR
    ((p_before_at IS NULL) <> (p_before_id IS NULL)) OR
    (p_before_id IS NOT NULL AND p_before_id !~ '^(event|assignment):[0-9a-f-]{36}$')
  THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('at', occurred_at, 'id', id, 'event', event) ORDER BY occurred_at DESC, id DESC), '[]'::jsonb)
  INTO v_rows FROM (
    SELECT * FROM public.platform_audit_projection
    WHERE occurred_at BETWEEN p_from AND p_to
      AND (p_organization IS NULL OR organization_id = p_organization)
      AND (p_filter_actor IS NULL OR actor_id = p_filter_actor)
      AND (p_event IS NULL OR event_code = p_event)
      AND (p_result IS NULL OR result = p_result)
      AND (p_before_at IS NULL OR (occurred_at, id) < (p_before_at, p_before_id))
    ORDER BY occurred_at DESC, id DESC LIMIT p_limit + 1
  ) page;
  SELECT coalesce(jsonb_agg(row.value->'event' ORDER BY row.ordinality), '[]'::jsonb)
    INTO v_items FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS row(value, ordinality)
    WHERE row.ordinality <= p_limit;
  IF jsonb_array_length(v_rows) > p_limit THEN
    v_next := jsonb_build_object('occurredAt', v_rows->(p_limit - 1)->'at', 'id', v_rows->(p_limit - 1)->'id');
  ELSE v_next := NULL; END IF;
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, result, reason, request_id, fields)
    VALUES ('platform', 'platform.audit_queried', p_actor, 'succeeded', btrim(p_purpose), p_request,
      jsonb_build_object('from', p_from, 'to', p_to, 'organizationId', p_organization,
        'actorId', p_filter_actor, 'eventCode', p_event, 'result', p_result, 'limit', p_limit));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN jsonb_build_object('items', v_items, 'next', v_next);
END;
$function$;
ALTER FUNCTION public.list_platform_audit_events(uuid, uuid, text, timestamptz, timestamptz, uuid, uuid, text, text, timestamptz, text, integer, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.list_platform_audit_events(uuid, uuid, text, timestamptz, timestamptz, uuid, uuid, text, text, timestamptz, text, integer, text) FROM PUBLIC, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.list_platform_audit_events(uuid, uuid, text, timestamptz, timestamptz, uuid, uuid, text, text, timestamptz, text, integer, text) TO app_runtime;
--> statement-breakpoint
CREATE FUNCTION public.get_platform_audit_event(p_actor uuid, p_session uuid, p_id text, p_purpose text, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_event jsonb;
BEGIN
  PERFORM public.require_platform_user_access(p_actor, p_session, false);
  IF p_purpose IS NULL OR length(btrim(p_purpose)) NOT BETWEEN 1 AND 500 OR
    p_id IS NULL OR p_id !~ '^(event|assignment):[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  SELECT event INTO v_event FROM public.platform_audit_projection WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  BEGIN
    INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, result, reason, request_id, fields)
    VALUES ('platform', 'platform.audit_viewed', p_actor, 'audit_event', 'succeeded', btrim(p_purpose), p_request, jsonb_build_object('eventId', p_id));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN v_event;
END;
$function$;
ALTER FUNCTION public.get_platform_audit_event(uuid, uuid, text, text, text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.get_platform_audit_event(uuid, uuid, text, text, text) FROM PUBLIC, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.get_platform_audit_event(uuid, uuid, text, text, text) TO app_runtime;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_platform_session_assurance(p_session_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.session s JOIN public."user" u ON u.id = s.user_id
    JOIN public.two_factor f ON f.user_id = u.id
    WHERE s.id = p_session_id AND s.user_id = p_user_id AND s.expires_at > clock_timestamp()
      AND u.two_factor_enabled IS TRUE AND f.verified IS TRUE
  ) THEN RAISE EXCEPTION 'No verified TOTP session for platform assurance' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.platform_session_assurance(session_id, user_id, verified_at, method)
  VALUES (p_session_id, p_user_id, clock_timestamp(), 'totp') ON CONFLICT (session_id) DO UPDATE
    SET user_id = EXCLUDED.user_id, verified_at = EXCLUDED.verified_at, method = EXCLUDED.method;
  -- 成功验证当前 Session 才记事实；普通用户的二次验证不伪装成平台登录。
  IF EXISTS (SELECT 1 FROM public.platform_assignment WHERE user_id = p_user_id AND status = 'active') THEN
    INSERT INTO public.audit_events(scope, event_code, actor_id, resource_type, resource_id, result, request_id, fields)
    VALUES ('platform', 'platform.mfa_verified', p_user_id, 'user', p_user_id, 'succeeded', gen_random_uuid()::text, '{}'::jsonb);
  END IF;
END;
$function$;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
