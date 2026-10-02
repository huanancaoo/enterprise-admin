-- 组织文件业务只通过 TenantTx；个人媒体和平台策略使用独立受控通道。
ALTER TABLE public.file_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY file_entries_tenant ON public.file_entries TO app_runtime
USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE public.file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY file_versions_tenant ON public.file_versions TO app_runtime
USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE public.file_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_references FORCE ROW LEVEL SECURITY;
CREATE POLICY file_references_tenant ON public.file_references TO app_runtime
USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE public.file_storage_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_storage_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY file_storage_usage_tenant ON public.file_storage_usage TO app_runtime
USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE public.file_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY file_operations_tenant ON public.file_operations TO app_runtime
USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE public.file_operation_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_operation_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY file_operation_objects_tenant ON public.file_operation_objects TO app_runtime
USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE public.file_namespace_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_namespace_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY file_namespace_reservations_tenant ON public.file_namespace_reservations TO app_runtime
USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE public.project_file_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_file_contents FORCE ROW LEVEL SECURITY;
CREATE POLICY project_file_contents_tenant ON public.project_file_contents TO app_runtime
USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.file_entries, public.file_operations, public.file_operation_objects TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.file_references, public.file_namespace_reservations, public.project_file_contents TO app_runtime;
GRANT SELECT, INSERT ON public.file_versions TO app_runtime;
GRANT UPDATE (storage_area, storage_path, archived_path, retired_at, expires_at, purged_at) ON public.file_versions TO app_runtime;
GRANT SELECT ON public.file_storage_usage TO app_runtime;
GRANT INSERT (organization_id) ON public.file_storage_usage TO app_runtime;
GRANT UPDATE (used_bytes, reserved_bytes, transient_bytes) ON public.file_storage_usage TO app_runtime;
-- 组织成员不能经租户 Repository 增加配额或缩短已记录的保留期限。
--> statement-breakpoint
ALTER TABLE public.file_entries ADD CONSTRAINT file_entries_current_version_fk
FOREIGN KEY (organization_id, id, current_version_id)
REFERENCES public.file_versions (organization_id, file_id, id)
DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION public.protect_file_version_content() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  IF (NEW.id, NEW.organization_id, NEW.file_id, NEW.bytes, NEW.sha256, NEW.content_type, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM
    (OLD.id, OLD.organization_id, OLD.file_id, OLD.bytes, OLD.sha256, OLD.content_type, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'file version content is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.retired_at IS NOT NULL AND (NEW.retired_at, NEW.expires_at) IS DISTINCT FROM (OLD.retired_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'file version retention deadline is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER file_versions_immutable BEFORE UPDATE ON public.file_versions
FOR EACH ROW EXECUTE FUNCTION public.protect_file_version_content();
--> statement-breakpoint
CREATE FUNCTION public.protect_file_root() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  IF OLD.parent_id IS NULL AND (TG_OP = 'DELETE' OR
    (NEW.id, NEW.organization_id, NEW.parent_id, NEW.kind, NEW.name, NEW.path, NEW.state)
      IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.parent_id, OLD.kind, OLD.name, OLD.path, OLD.state)) THEN
    RAISE EXCEPTION 'file root is fixed' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
CREATE TRIGGER file_entries_fixed_root BEFORE UPDATE OR DELETE ON public.file_entries
FOR EACH ROW EXECUTE FUNCTION public.protect_file_root();
--> statement-breakpoint
-- 子树发布允许事务内按顺序改动；提交时每项仍须对应当前有效父目录和版本。
CREATE FUNCTION public.validate_file_entry_publication() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE v_entry public.file_entries%ROWTYPE; v_parent public.file_entries%ROWTYPE;
BEGIN
  SELECT * INTO v_entry FROM public.file_entries WHERE organization_id = NEW.organization_id AND id = NEW.id;
  IF NOT FOUND OR v_entry.state <> 'active' THEN RETURN NULL; END IF;
  IF v_entry.parent_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.file_entries WHERE organization_id = v_entry.organization_id AND id = v_entry.parent_id;
    IF NOT FOUND OR v_parent.kind <> 'folder' OR v_parent.state <> 'active'
      OR v_entry.path IS DISTINCT FROM array_append(v_parent.path, v_entry.name) THEN
      RAISE EXCEPTION 'file parent and path are inconsistent' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF v_entry.kind = 'file' AND (v_entry.current_version_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.file_versions WHERE organization_id = v_entry.organization_id
      AND file_id = v_entry.id AND id = v_entry.current_version_id AND purged_at IS NULL
      AND storage_area = 'files' AND storage_path = v_entry.path
  )) THEN
    RAISE EXCEPTION 'current file version is not published at its active path' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;
CREATE CONSTRAINT TRIGGER file_entries_publication AFTER INSERT OR UPDATE ON public.file_entries
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_file_entry_publication();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_file_version_content(), public.protect_file_root(), public.validate_file_entry_publication() FROM PUBLIC;
