CREATE OR REPLACE FUNCTION public.guard_organization_management_write()
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
  v_recipient_rejection boolean := false;
BEGIN
  v_organization_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;

  -- 父组织级联删除时不再执行子资源的常规写入校验。
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.organization WHERE id = v_organization_id
  ) THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'invitation' AND TG_OP = 'UPDATE' THEN
    v_recipient_rejection := OLD.status = 'pending' AND NEW.status = 'rejected'
      AND pg_catalog.current_setting('app.auth_organization_operation', true) = '/organization/reject-invitation';
  END IF;
  IF v_recipient_rejection THEN
    -- 停用组织只允许接收者结束自己的待处理邀请，不授予组织访问。
    PERFORM 1 FROM public.organization_status WHERE organization_id = v_organization_id FOR UPDATE;
  ELSE
    PERFORM public.require_active_organization(v_organization_id);
  END IF;

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
        -- 等待组织锁可能跨过到期时间；有效引用按执行删除时的时钟判断。
        AND expires_at > pg_catalog.clock_timestamp()
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
    IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'terminal invitation cannot change state' USING ERRCODE = 'ORG08';
    END IF;
    IF OLD.expires_at <= pg_catalog.clock_timestamp() AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'expired invitation cannot change state' USING ERRCODE = 'ORG08';
    END IF;
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
