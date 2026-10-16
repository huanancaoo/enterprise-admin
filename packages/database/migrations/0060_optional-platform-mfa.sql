-- 平台准入只依赖有效会话与任职；账号主动启用的两步验证仍由认证层执行。
CREATE OR REPLACE FUNCTION public.require_platform_organization_access(p_actor uuid, p_session uuid, p_write boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_role text;
BEGIN
  SELECT role INTO v_role FROM public.read_platform_access(p_actor, p_session);
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_write AND v_role <> 'platform_admin' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN v_role;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.require_platform_user_access(p_actor uuid, p_session uuid, p_sensitive boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_role text;
BEGIN
  SELECT role INTO v_role FROM public.read_platform_access(p_actor, p_session);
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_sensitive AND v_role <> 'platform_admin' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
END;
$function$;
