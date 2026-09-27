CREATE OR REPLACE FUNCTION public.audit_organization_management_write()
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
  v_operation text;
  v_fields jsonb;
BEGIN
  v_actor_id := nullif(
    pg_catalog.current_setting('app.auth_actor_id', true), ''
  )::uuid;
  v_request_id := nullif(
    pg_catalog.current_setting('app.auth_request_id', true), ''
  );
  IF v_actor_id IS NULL OR v_request_id IS NULL THEN
    IF SESSION_USER <> 'app_runtime' THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    RAISE EXCEPTION 'trusted audit context is required'
      USING ERRCODE = 'AUA01';
  END IF;

  IF TG_TABLE_NAME = 'organization' THEN
    v_organization_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    v_resource_id := v_organization_id;
    IF TG_OP = 'UPDATE' AND OLD.default_locale IS DISTINCT FROM NEW.default_locale THEN
      v_event_code := 'organization.settings_updated';
      v_fields := pg_catalog.jsonb_build_object(
        'previousDefaultLocale', OLD.default_locale,
        'defaultLocale', NEW.default_locale
      );
    ELSE
      v_fields := pg_catalog.jsonb_build_object(
        'name', CASE WHEN TG_OP = 'DELETE' THEN OLD.name ELSE NEW.name END,
        'slug', CASE WHEN TG_OP = 'DELETE' THEN OLD.slug ELSE NEW.slug END
      );
    END IF;
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

  IF v_event_code IS NULL THEN
    v_event_code := 'organization.' || TG_TABLE_NAME || '.' || pg_catalog.lower(TG_OP);
  END IF;
  v_operation := pg_catalog.current_setting('app.auth_organization_operation', true);
  IF TG_TABLE_NAME = 'organization_role' THEN
    v_event_code := CASE TG_OP
      WHEN 'INSERT' THEN 'role.created'
      WHEN 'UPDATE' THEN 'role.updated'
      ELSE 'role.deleted'
    END;
    v_fields := pg_catalog.jsonb_build_object(
      'role', CASE WHEN TG_OP = 'DELETE' THEN OLD.role ELSE NEW.role END,
      'permission', CASE WHEN TG_OP = 'DELETE' THEN OLD.permission::jsonb ELSE NEW.permission::jsonb END
    );
  ELSIF TG_TABLE_NAME = 'member' AND TG_OP = 'UPDATE'
     AND v_operation = '/organization/update-member-role' THEN
    v_event_code := 'member.role_changed';
    v_fields := pg_catalog.jsonb_build_object(
      'userId', NEW.user_id, 'previousRole', OLD.role, 'role', NEW.role
    );
  ELSIF TG_TABLE_NAME = 'member' AND TG_OP = 'DELETE'
        AND v_operation IN ('/organization/remove-member', '/organization/leave') THEN
    v_event_code := CASE WHEN v_operation = '/organization/leave'
      THEN 'member.left' ELSE 'member.removed' END;
    v_fields := pg_catalog.jsonb_build_object('userId', OLD.user_id, 'role', OLD.role);
  END IF;
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
