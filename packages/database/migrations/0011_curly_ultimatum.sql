ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_organization_id_organization_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX member_organization_user_unique
ON public.member (organization_id, user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX organization_role_organization_role_unique
ON public.organization_role (organization_id, role);
--> statement-breakpoint
CREATE FUNCTION public.guard_organization_management_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_organization_id uuid;
  v_role text;
  v_status text;
  v_email text;
  v_expires_at timestamptz;
  v_current_version integer;
  v_expected_version_text text;
  v_bumped_organization_id text;
BEGIN
  v_organization_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;

  -- 父组织级联删除时不再执行子资源的常规写入校验。
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.organization WHERE id = v_organization_id
  ) THEN
    RETURN OLD;
  END IF;

  PERFORM public.require_active_organization(v_organization_id);

  IF TG_TABLE_NAME = 'member' THEN
    v_role := CASE WHEN TG_OP = 'DELETE' THEN OLD.role ELSE NEW.role END;
  ELSIF TG_TABLE_NAME = 'invitation' THEN
    v_role := CASE WHEN TG_OP = 'DELETE' THEN OLD.role ELSE NEW.role END;
    v_status := CASE WHEN TG_OP = 'DELETE' THEN OLD.status ELSE NEW.status END;
    v_email := CASE WHEN TG_OP = 'DELETE' THEN OLD.email ELSE NEW.email END;
    v_expires_at := CASE WHEN TG_OP = 'DELETE' THEN OLD.expires_at ELSE NEW.expires_at END;
  ELSIF TG_TABLE_NAME = 'organization_role' THEN
    v_role := CASE WHEN TG_OP = 'DELETE' THEN OLD.role ELSE NEW.role END;
  END IF;

  IF v_role IS NOT NULL AND pg_catalog.strpos(v_role, ',') > 0 THEN
    RAISE EXCEPTION 'organization roles must be single-valued'
      USING ERRCODE = 'ORG01';
  END IF;

  IF TG_TABLE_NAME IN ('member', 'invitation')
     AND v_role IS NOT NULL
     AND v_role NOT IN ('owner', 'admin', 'member')
     AND NOT EXISTS (
       SELECT 1
       FROM public.organization_role
       WHERE organization_id = v_organization_id AND role = v_role
     ) THEN
    RAISE EXCEPTION 'organization role does not exist'
      USING ERRCODE = 'ORG02';
  END IF;

  IF TG_TABLE_NAME = 'organization_role'
     AND TG_OP <> 'DELETE'
     AND v_role IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'built-in organization roles cannot be redefined'
      USING ERRCODE = 'ORG03';
  END IF;

  IF TG_TABLE_NAME = 'organization_role' AND TG_OP = 'DELETE' AND (
    EXISTS (
      SELECT 1 FROM public.member
      WHERE organization_id = v_organization_id AND role = OLD.role
    ) OR EXISTS (
      SELECT 1 FROM public.invitation
      WHERE organization_id = v_organization_id
        AND role = OLD.role
        AND status = 'pending'
        AND expires_at > pg_catalog.now()
    )
  ) THEN
    RAISE EXCEPTION 'organization role is still referenced'
      USING ERRCODE = 'ORG04';
  END IF;

  IF TG_TABLE_NAME = 'invitation'
     AND TG_OP = 'INSERT'
     AND v_status = 'pending'
     AND v_expires_at > pg_catalog.now()
     AND EXISTS (
       SELECT 1 FROM public.invitation
       WHERE organization_id = v_organization_id
         AND pg_catalog.lower(email) = pg_catalog.lower(v_email)
         AND status = 'pending'
         AND expires_at > pg_catalog.now()
     ) THEN
    RAISE EXCEPTION 'an active invitation already exists for this email'
      USING ERRCODE = 'ORG05';
  END IF;

  IF TG_TABLE_NAME = 'invitation' AND TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'accepted' AND NEW.status = 'accepted' THEN
      IF OLD.status <> 'pending' OR OLD.expires_at <= pg_catalog.now() THEN
        RAISE EXCEPTION 'invitation is not active'
          USING ERRCODE = 'ORG08';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public."user"
        WHERE id = pg_catalog.current_setting('app.auth_actor_id', true)::uuid
          AND email_verified
          AND pg_catalog.lower(email) = pg_catalog.lower(NEW.email)
      ) THEN
        RAISE EXCEPTION 'verified invitation email does not match actor'
          USING ERRCODE = 'ORG09';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.member inviter
        LEFT JOIN public.organization_role dynamic_role
          ON dynamic_role.organization_id = inviter.organization_id
         AND dynamic_role.role = inviter.role
        WHERE inviter.organization_id = v_organization_id
          AND inviter.user_id = NEW.inviter_id
          AND (
            inviter.role IN ('owner', 'admin')
            OR dynamic_role.permission::jsonb @> '{"invitation":["create"]}'::jsonb
          )
      ) THEN
        RAISE EXCEPTION 'inviter is no longer allowed to invite members'
          USING ERRCODE = 'ORG10';
      END IF;
    END IF;
  END IF;

  v_bumped_organization_id := pg_catalog.current_setting(
    'app.authorization_version_bumped_organization_id', true
  );
  IF v_bumped_organization_id IS NULL OR v_bumped_organization_id = '' THEN
    SELECT authorization_version INTO v_current_version
    FROM public.organization_status
    WHERE organization_id = v_organization_id;
    v_expected_version_text := pg_catalog.current_setting(
      'app.expected_authorization_version', true
    );
    IF v_expected_version_text IS NOT NULL
       AND v_expected_version_text <> ''
       AND v_expected_version_text::integer <> v_current_version THEN
      RAISE EXCEPTION 'authorization version conflict'
        USING ERRCODE = '40001';
    END IF;
    UPDATE public.organization_status
    SET authorization_version = authorization_version + 1
    WHERE organization_id = v_organization_id;
    PERFORM pg_catalog.set_config(
      'app.authorization_version_bumped_organization_id',
      v_organization_id::text,
      true
    );
  ELSIF v_bumped_organization_id <> v_organization_id::text THEN
    RAISE EXCEPTION 'one organization management action cannot mutate multiple organizations'
      USING ERRCODE = 'ORG06';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.guard_organization_row_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF SESSION_USER <> 'app_runtime' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  PERFORM public.require_active_organization(OLD.id);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organization_management_guard
BEFORE UPDATE OR DELETE ON public.organization
FOR EACH ROW EXECUTE FUNCTION public.guard_organization_row_write();
--> statement-breakpoint
CREATE TRIGGER member_management_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.member
FOR EACH ROW EXECUTE FUNCTION public.guard_organization_management_write();
--> statement-breakpoint
CREATE TRIGGER invitation_management_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.invitation
FOR EACH ROW EXECUTE FUNCTION public.guard_organization_management_write();
--> statement-breakpoint
CREATE TRIGGER organization_role_management_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.organization_role
FOR EACH ROW EXECUTE FUNCTION public.guard_organization_management_write();
--> statement-breakpoint
CREATE FUNCTION public.require_organization_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_organization_id uuid;
BEGIN
  v_organization_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF EXISTS (SELECT 1 FROM public.organization WHERE id = v_organization_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.member
       WHERE organization_id = v_organization_id AND role = 'owner'
     ) THEN
    RAISE EXCEPTION 'organization must retain an owner'
      USING ERRCODE = 'ORG07';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.organization_id <> NEW.organization_id
     AND EXISTS (SELECT 1 FROM public.organization WHERE id = OLD.organization_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.member
       WHERE organization_id = OLD.organization_id AND role = 'owner'
     ) THEN
    RAISE EXCEPTION 'organization must retain an owner'
      USING ERRCODE = 'ORG07';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER member_requires_owner
AFTER INSERT OR UPDATE OR DELETE ON public.member
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.require_organization_owner();
--> statement-breakpoint
CREATE FUNCTION public.audit_organization_management_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor_id uuid;
  v_request_id text;
  v_organization_id uuid;
  v_resource_id uuid;
  v_event_code text;
  v_fields jsonb;
BEGIN
  v_actor_id := nullif(
    pg_catalog.current_setting('app.auth_actor_id', true), ''
  )::uuid;
  v_request_id := nullif(
    pg_catalog.current_setting('app.auth_request_id', true), ''
  );
  IF v_actor_id IS NULL OR v_request_id IS NULL THEN
    -- 迁移身份可执行显式维护；运行时身份的每次管理写必须具备可信上下文。
    IF SESSION_USER <> 'app_runtime' THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    RAISE EXCEPTION 'trusted audit context is required'
      USING ERRCODE = 'AUA01';
  END IF;

  IF TG_TABLE_NAME = 'organization' THEN
    v_organization_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    v_resource_id := v_organization_id;
    v_fields := pg_catalog.jsonb_build_object(
      'name', CASE WHEN TG_OP = 'DELETE' THEN OLD.name ELSE NEW.name END,
      'slug', CASE WHEN TG_OP = 'DELETE' THEN OLD.slug ELSE NEW.slug END
    );
  ELSE
    v_organization_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
    v_resource_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    IF TG_TABLE_NAME IN ('member', 'organization_role') THEN
      v_fields := pg_catalog.jsonb_build_object(
        'role', CASE WHEN TG_OP = 'DELETE' THEN OLD.role ELSE NEW.role END
      );
    ELSE
      v_fields := pg_catalog.jsonb_build_object(
        'role', CASE WHEN TG_OP = 'DELETE' THEN OLD.role ELSE NEW.role END,
        'status', CASE WHEN TG_OP = 'DELETE' THEN OLD.status ELSE NEW.status END
      );
    END IF;
  END IF;

  v_event_code := 'organization.' || TG_TABLE_NAME || '.' || pg_catalog.lower(TG_OP);
  PERFORM pg_catalog.set_config(
    'app.organization_id',
    v_organization_id::text,
    true
  );
  INSERT INTO public.audit_events (
    organization_id,
    event_code,
    actor_id,
    resource_id,
    request_id,
    fields
  ) VALUES (
    v_organization_id,
    v_event_code,
    v_actor_id,
    v_resource_id,
    v_request_id,
    v_fields
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organization_management_audit
AFTER INSERT OR UPDATE OR DELETE ON public.organization
FOR EACH ROW EXECUTE FUNCTION public.audit_organization_management_write();
--> statement-breakpoint
CREATE TRIGGER member_management_audit
AFTER INSERT OR UPDATE OR DELETE ON public.member
FOR EACH ROW EXECUTE FUNCTION public.audit_organization_management_write();
--> statement-breakpoint
CREATE TRIGGER invitation_management_audit
AFTER INSERT OR UPDATE OR DELETE ON public.invitation
FOR EACH ROW EXECUTE FUNCTION public.audit_organization_management_write();
--> statement-breakpoint
CREATE TRIGGER organization_role_management_audit
AFTER INSERT OR UPDATE OR DELETE ON public.organization_role
FOR EACH ROW EXECUTE FUNCTION public.audit_organization_management_write();
--> statement-breakpoint
CREATE POLICY audit_events_management_trigger ON public.audit_events
TO app_migrator
USING (
  organization_id = nullif(
    pg_catalog.current_setting('app.organization_id', true), ''
  )::uuid
)
WITH CHECK (
  organization_id = nullif(
    pg_catalog.current_setting('app.organization_id', true), ''
  )::uuid
);
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_organization_management_write() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_organization_row_write() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.require_organization_owner() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.audit_organization_management_write() FROM PUBLIC;
