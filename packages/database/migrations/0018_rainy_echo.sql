CREATE TABLE public.two_factor (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  secret text NOT NULL,
  backup_codes text NOT NULL,
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  verified boolean DEFAULT true,
  failed_verification_count integer DEFAULT 0,
  locked_until timestamp
);
CREATE INDEX "twoFactor_secret_idx" ON public.two_factor USING btree (secret);
CREATE INDEX "twoFactor_userId_idx" ON public.two_factor USING btree (user_id);

ALTER TABLE public."user" ADD COLUMN two_factor_enabled boolean DEFAULT false;

CREATE TABLE public.platform_assignment_audit (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('grant', 'revoke')),
  previous_role text CHECK (previous_role IN ('platform_admin', 'platform_auditor')),
  next_role text CHECK (next_role IN ('platform_admin', 'platform_auditor')),
  result text NOT NULL CHECK (result IN ('changed', 'no_change')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  actor text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE public.platform_session_assurance (
  session_id uuid PRIMARY KEY REFERENCES public.session(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL,
  method text NOT NULL CHECK (method = 'totp')
);

ALTER TABLE public.platform_assignment ALTER COLUMN granted_at DROP DEFAULT;
ALTER TABLE public.platform_assignment
  ADD COLUMN role text,
  ADD COLUMN status text,
  ADD COLUMN version integer DEFAULT 1,
  ADD COLUMN granted_by text,
  ADD COLUMN grant_reason text,
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN revoked_by text,
  ADD COLUMN revoke_reason text;

UPDATE public.platform_assignment
SET role = 'platform_admin',
    status = 'active',
    version = 1,
    granted_by = 'migration:0018',
    grant_reason = 'Preserved legacy platform assignment; original actor and reason were not recorded';

INSERT INTO public.platform_assignment_audit
  (user_id, action, previous_role, next_role, result, reason, actor, created_at)
SELECT user_id, 'grant', NULL, 'platform_admin', 'changed',
       'Preserved legacy platform assignment; original actor and reason were not recorded',
       'migration:0018', clock_timestamp()
FROM public.platform_assignment;

ALTER TABLE public.platform_assignment
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN version SET NOT NULL,
  ALTER COLUMN granted_by SET NOT NULL,
  ALTER COLUMN grant_reason SET NOT NULL,
  ADD CONSTRAINT platform_assignment_role_check
    CHECK (role IN ('platform_admin', 'platform_auditor')),
  ADD CONSTRAINT platform_assignment_status_check
    CHECK (status IN ('active', 'revoked')),
  ADD CONSTRAINT platform_assignment_version_check CHECK (version > 0),
  ADD CONSTRAINT platform_assignment_revocation_fields_check
    CHECK ((status = 'active' AND revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
        OR (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL));

GRANT USAGE ON SCHEMA public TO platform_executor, platform_deployer;
GRANT SELECT (id, two_factor_enabled) ON public."user" TO platform_executor;
GRANT SELECT (id, user_id, expires_at) ON public.session TO platform_executor;
GRANT SELECT (user_id, role, status) ON public.platform_assignment TO platform_executor;
GRANT SELECT (user_id, verified) ON public.two_factor TO platform_executor;
GRANT SELECT (session_id, user_id, verified_at, method) ON public.platform_session_assurance TO platform_executor;
GRANT INSERT (session_id, user_id, verified_at, method),
  UPDATE (user_id, verified_at, method) ON public.platform_session_assurance TO platform_executor;

CREATE FUNCTION public.read_platform_access(p_user_id uuid, p_session_id uuid)
RETURNS TABLE (role text, two_factor_enabled boolean, mfa_verified_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = on
AS $function$
  SELECT assignment.role, account.two_factor_enabled, assurance.verified_at
  FROM public.platform_assignment AS assignment
  JOIN public."user" AS account ON account.id = assignment.user_id
  JOIN public.session AS active_session
    ON active_session.id = p_session_id
   AND active_session.user_id = p_user_id
   AND active_session.expires_at > clock_timestamp()
  LEFT JOIN public.platform_session_assurance AS assurance
    ON assurance.session_id = active_session.id
   AND assurance.user_id = active_session.user_id
  WHERE assignment.user_id = p_user_id
    AND assignment.status = 'active';
$function$;
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.read_platform_access(uuid, uuid) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.read_platform_access(uuid, uuid) FROM PUBLIC, app_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.read_platform_access(uuid, uuid) TO platform_runtime;

CREATE FUNCTION public.record_platform_session_assurance(p_session_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = on
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.session AS active_session
    JOIN public."user" AS account ON account.id = active_session.user_id
    JOIN public.two_factor AS factor ON factor.user_id = account.id
    WHERE active_session.id = p_session_id
      AND active_session.user_id = p_user_id
      AND active_session.expires_at > clock_timestamp()
      AND account.two_factor_enabled IS TRUE
      AND factor.verified IS TRUE
  ) THEN
    RAISE EXCEPTION 'No verified TOTP session for platform assurance'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.platform_session_assurance (session_id, user_id, verified_at, method)
  VALUES (p_session_id, p_user_id, clock_timestamp(), 'totp')
  ON CONFLICT (session_id) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        verified_at = EXCLUDED.verified_at,
        method = EXCLUDED.method;
END;
$function$;
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.record_platform_session_assurance(uuid, uuid) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.record_platform_session_assurance(uuid, uuid) FROM PUBLIC, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.record_platform_session_assurance(uuid, uuid) TO app_runtime;

-- 移除 0001/0005/0013 遗留的直接授权；平台运行时只能调用固定访问函数。
REVOKE SELECT (id, name, email, email_verified, image, created_at, updated_at)
  ON public."user" FROM platform_runtime;
REVOKE SELECT (id, name, slug, logo, created_at)
  ON public.organization FROM platform_runtime;
REVOKE SELECT (id, organization_id, user_id, role, created_at)
  ON public.member FROM platform_runtime;
REVOKE SELECT, INSERT ON public.platform_assignment FROM app_runtime;

DO $grant$
BEGIN
  EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO platform_deployer', pg_catalog.current_database());
END;
$grant$;
GRANT USAGE ON SCHEMA public TO platform_deployer;
GRANT SELECT (id, email_verified) ON public."user" TO platform_deployer;
GRANT SELECT (user_id, role, status, version) ON public.platform_assignment TO platform_deployer;
GRANT INSERT (user_id, role, status, version, granted_at, granted_by, grant_reason)
  ON public.platform_assignment TO platform_deployer;
GRANT UPDATE (role, status, version, granted_at, granted_by, grant_reason, revoked_at, revoked_by, revoke_reason)
  ON public.platform_assignment TO platform_deployer;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.two_factor TO app_runtime;
REVOKE ALL ON public.platform_assignment_audit, public.platform_session_assurance FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT INSERT ON public.platform_assignment_audit TO platform_deployer;
