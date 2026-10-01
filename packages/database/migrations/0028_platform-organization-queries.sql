GRANT SELECT (id, name, slug, created_at, default_locale) ON public.organization TO platform_executor;
GRANT SELECT (organization_id, status, status_version, status_changed_at, status_changed_by)
  ON public.organization_status TO platform_executor;
GRANT SELECT (id, organization_id, user_id, role, created_at) ON public.member TO platform_executor;
GRANT INSERT (resource_type, resource_id, operation_id, public_summary) ON public.audit_events TO platform_executor;
--> statement-breakpoint
CREATE POLICY audit_events_platform_organizations_insert ON public.audit_events
FOR INSERT TO platform_executor WITH CHECK (
  scope = 'platform' AND event_code IN (
    'platform.organizations_queried', 'platform.organization_viewed',
    'platform.organization_suspended', 'platform.organization_resumed',
    'platform.organization_transition_attempted'
  ) AND (NOT tenant_visible OR event_code IN (
    'platform.organization_suspended', 'platform.organization_resumed'
  ))
);
--> statement-breakpoint
CREATE FUNCTION public.require_platform_organization_access(p_actor uuid, p_session uuid, p_write boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_access record;
BEGIN
  SELECT role, two_factor_enabled, mfa_verified_at INTO v_access
  FROM public.read_platform_access(p_actor, p_session);
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT v_access.two_factor_enabled OR v_access.mfa_verified_at IS NULL
    OR (p_write AND v_access.mfa_verified_at < clock_timestamp() - interval '15 minutes') THEN
    RAISE EXCEPTION 'PLATFORM_MFA_REQUIRED';
  END IF;
  IF p_write AND v_access.role <> 'platform_admin' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN v_access.role;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.list_platform_organizations(
  p_actor uuid, p_session uuid, p_q text, p_status text,
  p_page integer, p_size integer, p_sort text, p_order text, p_request text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_organization_access(p_actor, p_session, false);
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
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.require_platform_organization_access(uuid, uuid, boolean) OWNER TO platform_executor;
ALTER FUNCTION public.list_platform_organizations(uuid, uuid, text, text, integer, integer, text, text, text) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.require_platform_organization_access(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_platform_organizations(uuid, uuid, text, text, integer, integer, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_platform_organizations(uuid, uuid, text, text, integer, integer, text, text, text) TO app_runtime;
--> statement-breakpoint
GRANT SELECT (id, organization_id, scope, event_code, occurred_at, actor_id, result, operation_id)
  ON public.audit_events TO platform_executor;
CREATE POLICY audit_events_platform_organization_history ON public.audit_events
FOR SELECT TO platform_executor USING (
  scope = 'platform' AND event_code IN ('platform.organization_suspended', 'platform.organization_resumed')
);
--> statement-breakpoint
CREATE FUNCTION public.get_platform_organization(p_actor uuid, p_session uuid, p_organization uuid, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_platform_organization_access(p_actor, p_session, false);
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
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.get_platform_organization(uuid, uuid, uuid, text) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.get_platform_organization(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_organization(uuid, uuid, uuid, text) TO app_runtime;
