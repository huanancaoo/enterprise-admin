ALTER TABLE "audit_events" ALTER COLUMN "tenant_visible" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_platform_summary_check" CHECK ("audit_events"."scope" <> 'platform' OR NOT "audit_events"."tenant_visible" OR ("audit_events"."public_summary" IS NOT NULL AND length(btrim("audit_events"."public_summary")) > 0));--> statement-breakpoint
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
  v_operation := pg_catalog.current_setting('app.auth_organization_operation', true);
  -- 同一 member DELETE 可来自退出、管理员移除或组织级联删除；事件由可信原生操作决定。
  IF TG_TABLE_NAME = 'member' AND TG_OP = 'UPDATE'
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
  -- 这些事件归属当前组织；平台事件采用私有默认值，故此处必须显式标记租户可见。
  INSERT INTO public.audit_events (
    organization_id,
    scope,
    event_code,
    actor_id,
    resource_id,
    request_id,
    tenant_visible,
    fields
  ) VALUES (
    v_organization_id,
    'tenant',
    v_event_code,
    v_actor_id,
    v_resource_id,
    v_request_id,
    true,
    v_fields
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
