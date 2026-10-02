-- 维护只取得候选标识及完成既有事实所需列，运行账号仍无跨租户表访问资格。
GRANT SELECT (id, organization_id, kind, parent_id, revision, state, current_version_id, busy_operation_id, trash_root_id, deleted_at, expires_at) ON public.file_entries TO platform_executor;
GRANT UPDATE (state, revision, busy_operation_id, trash_root_id, deleted_at, expires_at, updated_at) ON public.file_entries TO platform_executor;
GRANT SELECT (id, organization_id, file_id, bytes, sha256, storage_area, storage_path, retired_at, expires_at, purged_at) ON public.file_versions TO platform_executor;
GRANT UPDATE (purged_at) ON public.file_versions TO platform_executor;
GRANT SELECT (organization_id, file_id, version_id) ON public.file_references TO platform_executor;
GRANT SELECT, INSERT, UPDATE ON public.file_operations, public.file_operation_objects TO platform_executor;
GRANT SELECT (organization_id, operation_id), DELETE ON public.file_namespace_reservations TO platform_executor;
GRANT UPDATE (used_bytes, reserved_bytes, transient_bytes) ON public.file_storage_usage TO platform_executor;
CREATE POLICY file_entries_maintenance ON public.file_entries TO platform_executor
USING (organization_id = NULLIF(current_setting('app.file_maintenance_organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.file_maintenance_organization_id', true), '')::uuid);
CREATE POLICY file_entries_maintenance_candidates ON public.file_entries FOR SELECT TO platform_executor
USING ((state = 'trashed' AND expires_at <= clock_timestamp()) OR EXISTS (
  SELECT 1 FROM public.file_versions v WHERE v.organization_id = file_entries.organization_id AND v.file_id = file_entries.id
    AND v.storage_area = 'history' AND v.retired_at IS NOT NULL AND v.purged_at IS NULL AND v.expires_at <= clock_timestamp()));
CREATE POLICY file_versions_maintenance ON public.file_versions TO platform_executor
USING (organization_id = NULLIF(current_setting('app.file_maintenance_organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.file_maintenance_organization_id', true), '')::uuid);
CREATE POLICY file_versions_maintenance_candidates ON public.file_versions FOR SELECT TO platform_executor
USING (storage_area = 'history' AND retired_at IS NOT NULL AND purged_at IS NULL AND expires_at <= clock_timestamp());
-- 引用仅授予三个历史标识列，用于排除清理对象；不授予业务名称、项目或引用键。
CREATE POLICY file_references_maintenance ON public.file_references FOR SELECT TO platform_executor USING (true);
CREATE POLICY file_operations_maintenance ON public.file_operations TO platform_executor
USING (organization_id = NULLIF(current_setting('app.file_maintenance_organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.file_maintenance_organization_id', true), '')::uuid);
CREATE POLICY file_operations_maintenance_candidates ON public.file_operations FOR SELECT TO platform_executor
USING (completed_at IS NULL AND phase <> 'failed' AND
  (committed_at IS NOT NULL OR error_code IS NOT NULL OR (action = 'purge' AND jsonb_array_length(plans) > 0) OR expires_at <= clock_timestamp()));
CREATE POLICY file_operation_objects_maintenance ON public.file_operation_objects TO platform_executor
USING (organization_id = NULLIF(current_setting('app.file_maintenance_organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.file_maintenance_organization_id', true), '')::uuid);
CREATE POLICY file_namespace_reservations_maintenance ON public.file_namespace_reservations TO platform_executor
USING (organization_id = NULLIF(current_setting('app.file_maintenance_organization_id', true), '')::uuid);
CREATE POLICY file_storage_usage_maintenance ON public.file_storage_usage TO platform_executor
USING (organization_id = NULLIF(current_setting('app.file_maintenance_organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.file_maintenance_organization_id', true), '')::uuid);
CREATE POLICY audit_events_files_maintenance_insert ON public.audit_events FOR INSERT TO platform_executor
WITH CHECK (scope = 'tenant' AND actor_type = 'system' AND actor_id IS NULL
  AND organization_id = NULLIF(current_setting('app.file_maintenance_organization_id', true), '')::uuid
  AND event_code IN ('file.purged','folder.purged','file.history_purged','file.operation_cleaned'));
--> statement-breakpoint
CREATE FUNCTION public.file_maintenance_job(p_organization uuid, p_operation uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
  SELECT jsonb_build_object('organizationId', o.organization_id, 'operationId', o.id,
    'mode', CASE WHEN o.committed_at IS NOT NULL THEN 'finish_commit'
      WHEN o.maintenance_kind IS NOT NULL THEN o.maintenance_kind
      WHEN o.action = 'purge' AND jsonb_array_length(o.plans) > 0 THEN 'finish_purge'
      ELSE 'abort_uncommitted' END,
    'operation', to_jsonb(o) - ARRAY['input','plans','request_hash','actor_id','request_id'],
    'objects', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.file_operation_objects x
      WHERE x.organization_id = p_organization AND x.operation_id = p_operation), '[]'::jsonb))
  FROM public.file_operations o WHERE o.organization_id = p_organization AND o.id = p_operation;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.get_file_maintenance_candidates(p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('organizationId', organization_id, 'kind', kind, 'id', id) ORDER BY due, id), '[]'::jsonb)
    INTO v_result FROM (
      SELECT * FROM (
        SELECT organization_id, 'operation'::text kind, id, updated_at due FROM public.file_operations
          WHERE completed_at IS NULL AND phase <> 'failed' AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
            AND (committed_at IS NOT NULL OR error_code IS NOT NULL OR (action = 'purge' AND jsonb_array_length(plans) > 0) OR expires_at <= clock_timestamp())
        UNION ALL
        SELECT v.organization_id, 'history', v.id, v.expires_at FROM public.file_versions v
          JOIN public.file_entries e ON e.organization_id = v.organization_id AND e.id = v.file_id
          WHERE e.busy_operation_id IS NULL AND e.state <> 'purged' AND e.current_version_id IS DISTINCT FROM v.id AND v.storage_area = 'history' AND v.retired_at IS NOT NULL AND v.purged_at IS NULL AND v.expires_at <= clock_timestamp()
            AND NOT EXISTS (SELECT 1 FROM public.file_references r WHERE r.organization_id = v.organization_id AND r.version_id = v.id)
        UNION ALL
        SELECT e.organization_id, 'trash', e.id, e.expires_at FROM public.file_entries e
          WHERE e.state = 'trashed' AND e.id = e.trash_root_id AND e.expires_at <= clock_timestamp() AND e.busy_operation_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM public.file_references r WHERE r.organization_id = e.organization_id AND r.file_id = e.id)
            AND NOT EXISTS (SELECT 1 FROM public.file_entries child WHERE child.organization_id = e.organization_id AND child.trash_root_id = e.id AND child.state = 'trashed' AND child.busy_operation_id IS NOT NULL)
      ) candidates ORDER BY due, id LIMIT p_limit
    ) bounded;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
-- 调用者先取得同 owner 的 session advisory 物理锁，再认领；锁覆盖 I/O、记录和结算。
CREATE FUNCTION public.claim_file_maintenance(p_organization uuid, p_kind text, p_id uuid, p_lease uuid, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_operation public.file_operations%ROWTYPE; v_entry record; v_version record;
  v_ids uuid[]; v_operation_id uuid; v_now timestamptz; v_busy boolean;
BEGIN
  IF p_organization IS NULL OR p_id IS NULL OR p_lease IS NULL OR p_kind NOT IN ('operation','history','trash') OR p_kind IS NULL
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  PERFORM set_config('app.file_maintenance_organization_id', p_organization::text, true);
  -- 与 TenantTx 一致先锁容量行；禁止 operation -> usage 的反向锁序。
  PERFORM 1 FROM public.file_storage_usage WHERE organization_id = p_organization FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_now := clock_timestamp();
  IF p_kind = 'operation' THEN
    SELECT * INTO v_operation FROM public.file_operations WHERE organization_id = p_organization AND id = p_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR v_operation.completed_at IS NOT NULL OR v_operation.phase = 'failed'
      OR (v_operation.lease_expires_at IS NOT NULL AND v_operation.lease_expires_at > v_now)
      OR NOT (v_operation.committed_at IS NOT NULL OR v_operation.error_code IS NOT NULL OR (v_operation.action = 'purge' AND jsonb_array_length(v_operation.plans) > 0) OR v_operation.expires_at <= v_now)
      THEN RETURN NULL; END IF;
    UPDATE public.file_operations SET lease_id = p_lease, lease_expires_at = v_now + interval '2 minutes',
      phase = CASE WHEN committed_at IS NULL THEN 'preparing' ELSE 'cleaning' END, updated_at = v_now
      WHERE organization_id = p_organization AND id = p_id;
    RETURN public.file_maintenance_job(p_organization, p_id);
  END IF;
  v_operation_id := gen_random_uuid();
  IF p_kind = 'history' THEN
    SELECT id, file_id, bytes, sha256, storage_area, storage_path, retired_at, expires_at, purged_at
      INTO v_version FROM public.file_versions WHERE organization_id = p_organization AND id = p_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT id, state, current_version_id, busy_operation_id INTO v_entry FROM public.file_entries
      WHERE organization_id = p_organization AND id = v_version.file_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR v_entry.state = 'purged' OR v_entry.busy_operation_id IS NOT NULL OR v_entry.current_version_id = p_id THEN RETURN NULL; END IF;
    SELECT id, file_id, bytes, sha256, storage_area, storage_path, retired_at, expires_at, purged_at
      INTO v_version FROM public.file_versions WHERE organization_id = p_organization AND id = p_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR v_version.purged_at IS NOT NULL OR v_version.storage_area <> 'history' OR v_version.retired_at IS NULL
      OR v_version.expires_at IS NULL OR v_version.expires_at > v_now
      OR EXISTS (SELECT 1 FROM public.file_references WHERE organization_id = p_organization AND version_id = p_id)
      THEN RETURN NULL; END IF;
    INSERT INTO public.file_operations (id, organization_id, actor_type, action, maintenance_kind, request_hash, request_id, input, phase, lease_id, lease_expires_at, expires_at)
      VALUES (v_operation_id, p_organization, 'system', 'purge', 'history_purge', encode(sha256(convert_to('history:' || p_id::text, 'UTF8')), 'hex'), p_request,
        jsonb_build_object('entryId', v_entry.id, 'versionId', p_id), 'preparing', p_lease, v_now + interval '2 minutes', v_now);
    INSERT INTO public.file_operation_objects (organization_id, operation_id, entry_id, version_id, directory, source_area, source_path, expected_bytes, expected_sha256)
      VALUES (p_organization, v_operation_id, v_entry.id, p_id, false, v_version.storage_area, v_version.storage_path, v_version.bytes, v_version.sha256);
    UPDATE public.file_entries SET busy_operation_id = v_operation_id WHERE organization_id = p_organization AND id = v_entry.id;
  ELSE
    SELECT id, kind, revision, state, trash_root_id, expires_at, busy_operation_id INTO v_entry FROM public.file_entries
      WHERE organization_id = p_organization AND id = p_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR v_entry.state <> 'trashed' OR v_entry.id <> v_entry.trash_root_id OR v_entry.expires_at > v_now OR v_entry.busy_operation_id IS NOT NULL
      THEN RETURN NULL; END IF;
    SELECT array_agg(id), bool_or(busy_operation_id IS NOT NULL) INTO v_ids, v_busy FROM public.file_entries
      WHERE organization_id = p_organization AND state = 'trashed' AND trash_root_id = p_id;
    IF v_busy OR EXISTS (SELECT 1 FROM public.file_references WHERE organization_id = p_organization AND file_id = ANY(v_ids)) THEN RETURN NULL; END IF;
    PERFORM 1 FROM public.file_entries WHERE organization_id = p_organization AND id = ANY(v_ids) ORDER BY id FOR UPDATE;
    INSERT INTO public.file_operations (id, organization_id, actor_type, action, maintenance_kind, request_hash, request_id, input, phase, lease_id, lease_expires_at, expires_at)
      VALUES (v_operation_id, p_organization, 'system', 'purge', 'trash_purge', encode(sha256(convert_to('trash:' || p_id::text, 'UTF8')), 'hex'), p_request,
        jsonb_build_object('entryId', p_id, 'entryIds', to_jsonb(v_ids)), 'preparing', p_lease, v_now + interval '2 minutes', v_now);
    INSERT INTO public.file_operation_objects (organization_id, operation_id, entry_id, directory, source_area, source_path, expected_bytes)
      SELECT p_organization, v_operation_id, id, true, 'trash', CASE WHEN id = p_id THEN ARRAY[id::text] ELSE ARRAY[p_id::text,id::text] END, 0
      FROM public.file_entries WHERE organization_id = p_organization AND id = ANY(v_ids) AND kind = 'folder';
    INSERT INTO public.file_operation_objects (organization_id, operation_id, entry_id, version_id, directory, source_area, source_path, expected_bytes, expected_sha256)
      SELECT p_organization, v_operation_id, file_id, id, false, storage_area, storage_path, bytes, sha256 FROM public.file_versions
      WHERE organization_id = p_organization AND file_id = ANY(v_ids) AND purged_at IS NULL;
    IF v_entry.kind = 'file' THEN
      INSERT INTO public.file_operation_objects (organization_id, operation_id, entry_id, directory, source_area, source_path, expected_bytes)
        VALUES (p_organization, v_operation_id, NULL, true, 'trash', ARRAY[p_id::text], 0);
    END IF;
    UPDATE public.file_entries SET busy_operation_id = v_operation_id WHERE organization_id = p_organization AND id = ANY(v_ids);
  END IF;
  RETURN public.file_maintenance_job(p_organization, v_operation_id);
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.require_file_maintenance_lease(p_organization uuid, p_operation uuid, p_lease uuid, p_terminal boolean DEFAULT false)
RETURNS public.file_operations LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_operation public.file_operations%ROWTYPE;
BEGIN
  PERFORM set_config('app.file_maintenance_organization_id', p_organization::text, true);
  PERFORM 1 FROM public.file_storage_usage WHERE organization_id = p_organization FOR UPDATE;
  SELECT * INTO v_operation FROM public.file_operations WHERE organization_id = p_organization AND id = p_operation FOR UPDATE;
  IF NOT FOUND OR p_lease IS NULL OR v_operation.lease_id IS DISTINCT FROM p_lease
    OR (NOT p_terminal AND (v_operation.completed_at IS NOT NULL OR v_operation.phase = 'failed'))
    OR ((v_operation.completed_at IS NULL AND v_operation.phase <> 'failed') AND
      (v_operation.lease_expires_at IS NULL OR v_operation.lease_expires_at <= clock_timestamp()))
    THEN RAISE EXCEPTION 'FILE_OPERATION_LEASE_CONFLICT'; END IF;
  RETURN v_operation;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.renew_file_maintenance(p_organization uuid, p_operation uuid, p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  PERFORM public.require_file_maintenance_lease(p_organization, p_operation, p_lease);
  UPDATE public.file_operations SET lease_expires_at = clock_timestamp() + interval '2 minutes', updated_at = clock_timestamp()
    WHERE organization_id = p_organization AND id = p_operation;
  RETURN public.file_maintenance_job(p_organization, p_operation);
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.record_file_maintenance_object(p_organization uuid, p_operation uuid, p_lease uuid, p_object uuid, p_fact text, p_bytes bigint DEFAULT NULL, p_sha text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_operation public.file_operations%ROWTYPE; v_object public.file_operation_objects%ROWTYPE; v_delta bigint;
BEGIN
  v_operation := public.require_file_maintenance_lease(p_organization, p_operation, p_lease);
  SELECT * INTO v_object FROM public.file_operation_objects WHERE organization_id = p_organization AND operation_id = p_operation AND id = p_object FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FILE_OPERATION_NOT_FOUND'; END IF;
  IF p_fact = 'source_deleted' THEN
    IF v_object.source_area IS NULL OR (v_operation.committed_at IS NULL AND v_operation.action <> 'purge') THEN RAISE EXCEPTION 'FILE_OPERATION_NOT_READY'; END IF;
    IF v_object.source_deleted_at IS NOT NULL THEN RETURN; END IF;
    UPDATE public.file_operation_objects SET source_deleted_at = clock_timestamp(), transient_bytes = 0 WHERE id = p_object AND organization_id = p_organization;
    v_delta := -v_object.transient_bytes;
  ELSIF p_fact = 'target_deleted' THEN
    IF v_object.target_area IS NULL OR (v_operation.committed_at IS NOT NULL AND v_object.target_area <> 'staging') THEN RAISE EXCEPTION 'FILE_OPERATION_NOT_READY'; END IF;
    IF v_object.target_deleted_at IS NOT NULL THEN RETURN; END IF;
    UPDATE public.file_operation_objects SET target_deleted_at = clock_timestamp(), transient_bytes = 0 WHERE id = p_object AND organization_id = p_organization;
    v_delta := -v_object.transient_bytes;
  ELSIF p_fact = 'source_restored' THEN
    IF v_operation.committed_at IS NOT NULL OR v_operation.action = 'purge' OR v_object.source_deleted_at IS NULL THEN RAISE EXCEPTION 'FILE_OPERATION_NOT_READY'; END IF;
    IF p_bytes IS DISTINCT FROM v_object.expected_bytes OR (v_object.expected_sha256 IS NOT NULL AND p_sha IS DISTINCT FROM v_object.expected_sha256)
      THEN RAISE EXCEPTION 'FILE_CONTENT_MISMATCH'; END IF;
    IF v_object.source_restored_at IS NOT NULL THEN RETURN; END IF;
    v_delta := CASE WHEN v_object.target_deleted_at IS NULL THEN p_bytes ELSE 0 END;
    UPDATE public.file_operation_objects SET source_restored_at = clock_timestamp(), transient_bytes = v_delta WHERE id = p_object AND organization_id = p_organization;
  ELSE RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  UPDATE public.file_storage_usage SET transient_bytes = transient_bytes + v_delta WHERE organization_id = p_organization;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.record_file_maintenance_error(p_organization uuid, p_operation uuid, p_lease uuid, p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  PERFORM public.require_file_maintenance_lease(p_organization, p_operation, p_lease);
  IF p_code IS NULL OR p_code !~ '^[A-Z][A-Z0-9_]{0,99}$' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  UPDATE public.file_operations SET error_code = p_code, lease_expires_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE organization_id = p_organization AND id = p_operation;
END;
$function$;
--> statement-breakpoint
-- 正式请求最终授权失效仍须移交已知失败，不伪造成员上下文，也不等待未发布期限。
CREATE FUNCTION public.handoff_file_operation_failure(p_organization uuid, p_operation uuid, p_lease uuid, p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_operation public.file_operations%ROWTYPE;
BEGIN
  PERFORM set_config('app.file_maintenance_organization_id', p_organization::text, true);
  PERFORM 1 FROM public.file_storage_usage WHERE organization_id = p_organization FOR UPDATE;
  SELECT * INTO v_operation FROM public.file_operations WHERE organization_id = p_organization AND id = p_operation FOR UPDATE;
  IF NOT FOUND OR p_lease IS NULL OR v_operation.lease_id IS DISTINCT FROM p_lease
    OR v_operation.completed_at IS NOT NULL OR v_operation.phase = 'failed' THEN RAISE EXCEPTION 'FILE_OPERATION_LEASE_CONFLICT'; END IF;
  IF p_code IS NULL OR p_code !~ '^[A-Z][A-Z0-9_]{0,99}$' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  -- 已过期但尚未被新 token 接管的执行者只能移交失败事实，不能借此恢复 I/O 资格。
  UPDATE public.file_operations SET error_code = p_code, lease_expires_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE organization_id = p_organization AND id = p_operation;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.finish_file_maintenance(p_organization uuid, p_operation uuid, p_lease uuid, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_operation public.file_operations%ROWTYPE; v_ids uuid[]; v_root uuid; v_kind text; v_revision integer;
  v_bytes bigint; v_count integer; v_now timestamptz; v_event text; v_visible boolean := false;
BEGIN
  v_operation := public.require_file_maintenance_lease(p_organization, p_operation, p_lease, true);
  IF v_operation.completed_at IS NOT NULL OR v_operation.phase = 'failed' THEN RETURN public.file_maintenance_job(p_organization, p_operation); END IF;
  v_now := clock_timestamp();
  IF v_operation.committed_at IS NULL AND (v_operation.maintenance_kind IS NOT NULL OR (v_operation.action = 'purge' AND jsonb_array_length(v_operation.plans) > 0)) THEN
    -- 永久删除没有可恢复目标；物理删除后审计失败时仍保留 busy 和正式容量，重跑继续该意图。
    IF EXISTS (SELECT 1 FROM public.file_operation_objects WHERE organization_id = p_organization AND operation_id = p_operation
      AND source_area IS NOT NULL AND source_deleted_at IS NULL) THEN RAISE EXCEPTION 'FILE_OPERATION_NOT_READY'; END IF;
    IF v_operation.maintenance_kind = 'history_purge' THEN
      IF NOT EXISTS (SELECT 1 FROM public.file_entries WHERE organization_id = p_organization
        AND id = (v_operation.input->>'entryId')::uuid AND busy_operation_id = p_operation
        AND state <> 'purged' AND current_version_id IS DISTINCT FROM (v_operation.input->>'versionId')::uuid)
        THEN RAISE EXCEPTION 'FILE_OPERATION_NOT_READY'; END IF;
      v_root := (v_operation.input->>'entryId')::uuid;
      IF EXISTS (SELECT 1 FROM public.file_references WHERE organization_id = p_organization AND version_id = (v_operation.input->>'versionId')::uuid)
        THEN RAISE EXCEPTION 'FILE_REFERENCED'; END IF;
      v_event := 'file.history_purged';
    ELSE
      IF v_operation.maintenance_kind = 'trash_purge' THEN
        SELECT array_agg(value::uuid) INTO v_ids FROM jsonb_array_elements_text(v_operation.input->'entryIds');
        v_root := (v_operation.input->>'entryId')::uuid;
      ELSE
        SELECT array_agg((plan->>'id')::uuid) INTO v_ids FROM jsonb_array_elements(v_operation.plans) plan;
        v_root := (v_operation.plans->0->>'id')::uuid;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_operation.plans) plan JOIN public.file_entries e
          ON e.organization_id = p_organization AND e.id = (plan->>'id')::uuid
          WHERE e.revision <> (plan->>'expectedRevision')::integer OR e.busy_operation_id IS DISTINCT FROM p_operation OR e.state <> 'trashed')
          THEN RAISE EXCEPTION 'FILE_OPERATION_NOT_READY'; END IF;
      END IF;
      IF EXISTS (SELECT 1 FROM public.file_references WHERE organization_id = p_organization AND file_id = ANY(v_ids)) THEN RAISE EXCEPTION 'FILE_REFERENCED'; END IF;
      UPDATE public.file_entries SET state = 'purged', revision = revision + 1, trash_root_id = NULL, deleted_at = NULL, expires_at = NULL, updated_at = v_now
        WHERE organization_id = p_organization AND id = ANY(v_ids) AND state = 'trashed' AND busy_operation_id = p_operation;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count <> cardinality(v_ids) THEN RAISE EXCEPTION 'FILE_OPERATION_NOT_READY'; END IF;
      SELECT kind INTO v_kind FROM public.file_entries WHERE organization_id = p_organization AND id = v_root;
      v_event := v_kind || '.purged';
    END IF;
    SELECT COALESCE(sum(v.bytes),0) INTO v_bytes FROM public.file_versions v WHERE v.organization_id = p_organization AND v.purged_at IS NULL
      AND EXISTS (SELECT 1 FROM public.file_operation_objects x WHERE x.organization_id = p_organization AND x.operation_id = p_operation AND x.version_id = v.id);
    UPDATE public.file_versions v SET purged_at = v_now WHERE v.organization_id = p_organization AND v.purged_at IS NULL
      AND EXISTS (SELECT 1 FROM public.file_operation_objects x WHERE x.organization_id = p_organization AND x.operation_id = p_operation AND x.version_id = v.id);
    UPDATE public.file_storage_usage SET used_bytes = used_bytes - v_bytes WHERE organization_id = p_organization;
    SELECT revision INTO v_revision FROM public.file_entries WHERE organization_id = p_organization AND id = v_root;
    UPDATE public.file_operations SET committed_at = v_now, phase = 'committed', result = jsonb_build_object('entryId', v_root, 'revision', v_revision,
      'affectedEntries', CASE WHEN v_ids IS NULL THEN 1 ELSE cardinality(v_ids) END)
      || CASE WHEN v_operation.maintenance_kind = 'history_purge' THEN jsonb_build_object('versionId', v_operation.input->>'versionId') ELSE '{}'::jsonb END WHERE organization_id = p_organization AND id = p_operation;
    v_visible := true;
  ELSIF v_operation.committed_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.file_operation_objects WHERE organization_id = p_organization AND operation_id = p_operation
      AND ((target_area IS NOT NULL AND target_deleted_at IS NULL) OR (source_deleted_at IS NOT NULL AND source_restored_at IS NULL)))
      THEN RAISE EXCEPTION 'FILE_OPERATION_NOT_READY'; END IF;
    UPDATE public.file_storage_usage SET reserved_bytes = reserved_bytes - v_operation.reserved_bytes WHERE organization_id = p_organization;
    UPDATE public.file_operations SET reserved_bytes = 0, phase = 'failed', error_code = COALESCE(error_code, 'FILE_OPERATION_EXPIRED'), updated_at = v_now,
      lease_expires_at = NULL WHERE organization_id = p_organization AND id = p_operation;
    v_event := 'file.operation_cleaned';
  ELSE
    IF EXISTS (SELECT 1 FROM public.file_operation_objects WHERE organization_id = p_organization AND operation_id = p_operation
      AND ((source_area IS NOT NULL AND source_deleted_at IS NULL) OR (target_area = 'staging' AND target_deleted_at IS NULL)))
      THEN RAISE EXCEPTION 'FILE_OPERATION_NOT_READY'; END IF;
    v_event := 'file.operation_cleaned';
  END IF;
  BEGIN
    INSERT INTO public.audit_events (organization_id, scope, event_code, actor_type, actor_id, resource_type, resource_id, result, request_id, operation_id, tenant_visible, fields)
      VALUES (p_organization, 'tenant', v_event, 'system', NULL, CASE WHEN v_visible THEN COALESCE(v_kind,'file') ELSE 'file_operation' END,
        COALESCE(v_root,p_operation), 'succeeded', p_request, p_operation::text, v_visible,
        jsonb_build_object('bytes', COALESCE(v_bytes,0), 'initiatedBy', v_operation.actor_id));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  DELETE FROM public.file_namespace_reservations WHERE organization_id = p_organization AND operation_id = p_operation;
  UPDATE public.file_entries SET busy_operation_id = NULL WHERE organization_id = p_organization AND busy_operation_id = p_operation;
  UPDATE public.file_operations SET phase = CASE WHEN phase = 'failed' THEN 'failed' ELSE 'completed' END,
    completed_at = CASE WHEN phase = 'failed' THEN NULL ELSE v_now END, updated_at = v_now, lease_expires_at = NULL,
    error_code = CASE WHEN phase = 'failed' THEN error_code ELSE NULL END WHERE organization_id = p_organization AND id = p_operation;
  RETURN public.file_maintenance_job(p_organization, p_operation);
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.renew_personal_media_upload(p_actor uuid, p_session uuid, p_operation uuid, p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_operation public.personal_media_operations%ROWTYPE;
BEGIN
  PERFORM public.require_personal_media_session(p_actor, p_session);
  PERFORM set_config('app.personal_media_user_id', p_actor::text, true);
  SELECT * INTO v_operation FROM public.personal_media_operations WHERE user_id = p_actor AND id = p_operation FOR UPDATE;
  PERFORM public.require_personal_media_session(p_actor, p_session);
  IF v_operation.id IS NULL OR p_lease IS NULL OR v_operation.phase IN ('completed','failed')
    OR v_operation.lease_id IS DISTINCT FROM p_lease OR v_operation.lease_expires_at IS NULL OR v_operation.lease_expires_at <= clock_timestamp()
    THEN RAISE EXCEPTION 'FILE_OPERATION_LEASE_CONFLICT'; END IF;
  UPDATE public.personal_media_operations SET lease_expires_at = clock_timestamp() + interval '2 minutes', updated_at = clock_timestamp()
    WHERE user_id = p_actor AND id = p_operation RETURNING * INTO v_operation;
  RETURN to_jsonb(v_operation);
END;
$function$;
--> statement-breakpoint
CREATE POLICY personal_media_maintenance_candidates ON public.personal_media FOR SELECT TO platform_executor
USING (purged_at IS NULL AND expires_at <= clock_timestamp());
CREATE POLICY personal_media_operations_maintenance_candidates ON public.personal_media_operations FOR SELECT TO platform_executor
USING (phase IN ('pending','preparing') AND expires_at <= clock_timestamp());
CREATE FUNCTION public.get_personal_media_maintenance_candidates(p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('userId', user_id, 'kind', kind, 'id', id) ORDER BY due, id), '[]'::jsonb)
    INTO v_result FROM (
      SELECT * FROM (
        SELECT user_id, 'upload'::text kind, id, expires_at due FROM public.personal_media_operations
          WHERE phase IN ('pending','preparing') AND expires_at <= clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
        UNION ALL
        SELECT m.user_id, 'media', m.id, m.expires_at FROM public.personal_media m
          WHERE m.purged_at IS NULL AND m.expires_at <= clock_timestamp() AND (m.purge_lease_expires_at IS NULL OR m.purge_lease_expires_at <= clock_timestamp())
            AND NOT EXISTS (SELECT 1 FROM public."user" u WHERE u.id = m.user_id AND u.image = '/api/v1/personal-media/' || m.id::text || '/content')
      ) candidates ORDER BY due, id LIMIT p_limit
    ) bounded;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.personal_media_maintenance_job(p_user uuid, p_kind text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_kind = 'upload' THEN
    SELECT jsonb_build_object('userId', user_id, 'kind', p_kind, 'id', id, 'mediaId', media_id, 'operationId', id,
      'leaseId', lease_id, 'leaseExpiresAt', lease_expires_at, 'storagePath', ARRAY[media_id::text], 'phase', phase,
      'cleanedAt', cleaned_at, 'errorCode', error_code) INTO v_result FROM public.personal_media_operations WHERE user_id = p_user AND id = p_id;
  ELSE
    SELECT jsonb_build_object('userId', user_id, 'kind', p_kind, 'id', id, 'mediaId', id, 'operationId', purge_operation_id,
      'leaseId', purge_lease_id, 'leaseExpiresAt', purge_lease_expires_at, 'storagePath', storage_path, 'bytes', bytes, 'sha256', sha256,
      'purgedAt', purged_at, 'errorCode', purge_error_code) INTO v_result FROM public.personal_media WHERE user_id = p_user AND id = p_id;
  END IF;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.claim_personal_media_maintenance(p_user uuid, p_kind text, p_id uuid, p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_operation public.personal_media_operations%ROWTYPE; v_media public.personal_media%ROWTYPE; v_now timestamptz;
BEGIN
  IF p_user IS NULL OR p_id IS NULL OR p_lease IS NULL OR p_kind IS NULL OR p_kind NOT IN ('upload','media') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  PERFORM set_config('app.personal_media_user_id', p_user::text, true);
  v_now := clock_timestamp();
  IF p_kind = 'upload' THEN
    SELECT * INTO v_operation FROM public.personal_media_operations WHERE user_id = p_user AND id = p_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR v_operation.phase NOT IN ('pending','preparing') OR v_operation.expires_at > v_now
      OR (v_operation.lease_expires_at IS NOT NULL AND v_operation.lease_expires_at > v_now) THEN RETURN NULL; END IF;
    UPDATE public.personal_media_operations SET phase = 'preparing', lease_id = p_lease, lease_expires_at = v_now + interval '2 minutes', updated_at = v_now
      WHERE user_id = p_user AND id = p_id;
  ELSE
    SELECT * INTO v_media FROM public.personal_media WHERE user_id = p_user AND id = p_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR v_media.purged_at IS NOT NULL OR v_media.expires_at IS NULL OR v_media.expires_at > v_now
      OR (v_media.purge_lease_expires_at IS NOT NULL AND v_media.purge_lease_expires_at > v_now)
      OR EXISTS (SELECT 1 FROM public."user" WHERE id = p_user AND image = '/api/v1/personal-media/' || p_id::text || '/content') THEN RETURN NULL; END IF;
    UPDATE public.personal_media SET purge_operation_id = COALESCE(purge_operation_id, gen_random_uuid()),
      purge_lease_id = p_lease, purge_lease_expires_at = v_now + interval '2 minutes' WHERE user_id = p_user AND id = p_id;
  END IF;
  RETURN public.personal_media_maintenance_job(p_user, p_kind, p_id);
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.require_personal_media_maintenance_lease(p_user uuid, p_kind text, p_id uuid, p_lease uuid, p_terminal boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_lease uuid; v_expiry timestamptz; v_terminal boolean;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('upload','media') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  PERFORM set_config('app.personal_media_user_id', p_user::text, true);
  IF p_kind = 'upload' THEN
    SELECT lease_id, lease_expires_at, phase = 'failed' AND cleaned_at IS NOT NULL INTO v_lease, v_expiry, v_terminal
      FROM public.personal_media_operations WHERE user_id = p_user AND id = p_id FOR UPDATE;
  ELSE
    SELECT purge_lease_id, purge_lease_expires_at, purged_at IS NOT NULL INTO v_lease, v_expiry, v_terminal
      FROM public.personal_media WHERE user_id = p_user AND id = p_id FOR UPDATE;
  END IF;
  IF NOT FOUND OR p_lease IS NULL OR v_lease IS DISTINCT FROM p_lease OR (v_terminal AND NOT p_terminal)
    OR (NOT v_terminal AND (v_expiry IS NULL OR v_expiry <= clock_timestamp())) THEN RAISE EXCEPTION 'FILE_OPERATION_LEASE_CONFLICT'; END IF;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.renew_personal_media_maintenance(p_user uuid, p_kind text, p_id uuid, p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  PERFORM public.require_personal_media_maintenance_lease(p_user, p_kind, p_id, p_lease);
  IF p_kind = 'upload' THEN
    UPDATE public.personal_media_operations SET lease_expires_at = clock_timestamp() + interval '2 minutes', updated_at = clock_timestamp() WHERE user_id = p_user AND id = p_id;
  ELSE
    UPDATE public.personal_media SET purge_lease_expires_at = clock_timestamp() + interval '2 minutes' WHERE user_id = p_user AND id = p_id;
  END IF;
  RETURN public.personal_media_maintenance_job(p_user, p_kind, p_id);
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.record_personal_media_maintenance_error(p_user uuid, p_kind text, p_id uuid, p_lease uuid, p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  PERFORM public.require_personal_media_maintenance_lease(p_user, p_kind, p_id, p_lease);
  IF p_code IS NULL OR p_code !~ '^[A-Z][A-Z0-9_]{0,99}$' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF p_kind = 'upload' THEN
    UPDATE public.personal_media_operations SET error_code = p_code, lease_expires_at = clock_timestamp(), updated_at = clock_timestamp() WHERE user_id = p_user AND id = p_id;
  ELSE
    UPDATE public.personal_media SET purge_error_code = p_code, purge_lease_expires_at = clock_timestamp() WHERE user_id = p_user AND id = p_id;
  END IF;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.finish_personal_media_maintenance(p_user uuid, p_kind text, p_id uuid, p_lease uuid, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_job jsonb;
BEGIN
  PERFORM public.require_personal_media_maintenance_lease(p_user, p_kind, p_id, p_lease, true);
  v_job := public.personal_media_maintenance_job(p_user, p_kind, p_id);
  IF v_job->>'cleanedAt' IS NOT NULL OR v_job->>'purgedAt' IS NOT NULL THEN RETURN v_job; END IF;
  -- 调用者已经在 owner 物理锁内确认固定 mediaId 对象删除；当前头像引用永不作为清理对象。
  IF p_kind = 'upload' THEN
    UPDATE public.personal_media_operations SET phase = 'failed', cleaned_at = clock_timestamp(), updated_at = clock_timestamp(),
      lease_expires_at = NULL, error_code = COALESCE(error_code,'PERSONAL_MEDIA_OPERATION_EXPIRED') WHERE user_id = p_user AND id = p_id;
  ELSE
    IF EXISTS (SELECT 1 FROM public."user" WHERE id = p_user AND image = '/api/v1/personal-media/' || p_id::text || '/content')
      THEN RAISE EXCEPTION 'FILE_OPERATION_NOT_READY'; END IF;
    UPDATE public.personal_media SET purged_at = clock_timestamp(), purge_lease_expires_at = NULL, purge_error_code = NULL WHERE user_id = p_user AND id = p_id;
  END IF;
  BEGIN
    INSERT INTO public.audit_events (scope, event_code, actor_type, actor_id, resource_type, resource_id, result, request_id, operation_id, tenant_visible, fields)
      VALUES ('user','personal_media.purged','system',NULL,'personal_media',(v_job->>'mediaId')::uuid,'succeeded',p_request,v_job->>'operationId',false,
        jsonb_build_object('userId',p_user,'unpublished',p_kind='upload'));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN public.personal_media_maintenance_job(p_user, p_kind, p_id);
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_personal_media_content(p_actor uuid, p_session uuid, p_media uuid, p_organization uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_media public.personal_media%ROWTYPE;
BEGIN
  PERFORM public.require_personal_media_session(p_actor, p_session);
  PERFORM set_config('app.personal_media_id', p_media::text, true);
  SELECT * INTO v_media FROM public.personal_media WHERE id = p_media AND purged_at IS NULL
    AND (expires_at IS NULL OR expires_at > clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERSONAL_MEDIA_NOT_FOUND'; END IF;
  -- 等待媒体共享锁期间 Session 可能失效，实际打开对象前重新核实身份。
  PERFORM public.require_personal_media_session(p_actor, p_session);
  IF v_media.user_id <> p_actor AND NOT EXISTS (
    SELECT 1 FROM public.organization_status status
    JOIN public.member viewer ON viewer.organization_id = status.organization_id AND viewer.user_id = p_actor
    JOIN public.member subject ON subject.organization_id = status.organization_id AND subject.user_id = v_media.user_id
    WHERE status.organization_id = p_organization AND status.status = 'ACTIVE'
      AND EXISTS (SELECT 1 FROM unnest(string_to_array(viewer.role, ',')) role_key
        LEFT JOIN public.organization_role custom ON custom.organization_id = p_organization AND custom.role = role_key
        WHERE role_key IN ('owner','admin','member') OR custom.permission::jsonb @> '{"member":["read"]}'::jsonb)
  ) THEN RAISE EXCEPTION 'PERSONAL_MEDIA_NOT_FOUND'; END IF;
  -- 其他成员只能读取User.image当前引用的头像，未保存个人媒体只对本人开放。
  IF v_media.user_id <> p_actor AND NOT EXISTS (SELECT 1 FROM public."user"
    WHERE id = v_media.user_id AND image = '/api/v1/personal-media/' || p_media::text || '/content')
    THEN RAISE EXCEPTION 'PERSONAL_MEDIA_NOT_FOUND'; END IF;
  RETURN to_jsonb(v_media);
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.claim_personal_media_upload(p_actor uuid, p_session uuid, p_operation uuid, p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_operation public.personal_media_operations%ROWTYPE;
BEGIN
  PERFORM public.require_personal_media_session(p_actor, p_session);
  PERFORM set_config('app.personal_media_user_id', p_actor::text, true);
  SELECT * INTO v_operation FROM public.personal_media_operations WHERE user_id = p_actor AND id = p_operation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERSONAL_MEDIA_OPERATION_NOT_FOUND'; END IF;
  PERFORM public.require_personal_media_session(p_actor, p_session);
  IF v_operation.phase IN ('completed', 'failed') THEN RETURN NULL; END IF;
  IF p_lease IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF v_operation.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'PERSONAL_MEDIA_OPERATION_EXPIRED'; END IF;
  IF v_operation.lease_id IS NOT NULL AND v_operation.lease_id <> p_lease AND v_operation.lease_expires_at > clock_timestamp() THEN RETURN NULL; END IF;
  UPDATE public.personal_media_operations SET lease_id = p_lease, lease_expires_at = clock_timestamp() + interval '2 minutes',
    phase = 'preparing', updated_at = clock_timestamp() WHERE user_id = p_actor AND id = p_operation RETURNING * INTO v_operation;
  RETURN to_jsonb(v_operation);
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_file_entry_publication() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE v_entry public.file_entries%ROWTYPE; v_parent public.file_entries%ROWTYPE;
BEGIN
  -- busy/修订变化不会发布新路径；维护无需为这种更新取得名称和正文读取列。
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.organization_id, NEW.kind, NEW.parent_id, NEW.name, NEW.path, NEW.state, NEW.current_version_id)
    IS NOT DISTINCT FROM (OLD.id, OLD.organization_id, OLD.kind, OLD.parent_id, OLD.name, OLD.path, OLD.state, OLD.current_version_id) THEN RETURN NULL; END IF;
  IF NEW.state <> 'active' THEN RETURN NULL; END IF;
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

--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.file_maintenance_job(uuid, uuid) OWNER TO platform_executor;
ALTER FUNCTION public.require_file_maintenance_lease(uuid, uuid, uuid, boolean) OWNER TO platform_executor;
ALTER FUNCTION public.personal_media_maintenance_job(uuid, text, uuid) OWNER TO platform_executor;
ALTER FUNCTION public.require_personal_media_maintenance_lease(uuid, text, uuid, uuid, boolean) OWNER TO platform_executor;
ALTER FUNCTION public.get_file_maintenance_candidates(integer) OWNER TO platform_executor;
ALTER FUNCTION public.claim_file_maintenance(uuid, text, uuid, uuid, text) OWNER TO platform_executor;
ALTER FUNCTION public.renew_file_maintenance(uuid, uuid, uuid) OWNER TO platform_executor;
ALTER FUNCTION public.record_file_maintenance_object(uuid, uuid, uuid, uuid, text, bigint, text) OWNER TO platform_executor;
ALTER FUNCTION public.record_file_maintenance_error(uuid, uuid, uuid, text) OWNER TO platform_executor;
ALTER FUNCTION public.finish_file_maintenance(uuid, uuid, uuid, text) OWNER TO platform_executor;
ALTER FUNCTION public.renew_personal_media_upload(uuid, uuid, uuid, uuid) OWNER TO platform_executor;
ALTER FUNCTION public.get_personal_media_maintenance_candidates(integer) OWNER TO platform_executor;
ALTER FUNCTION public.claim_personal_media_maintenance(uuid, text, uuid, uuid) OWNER TO platform_executor;
ALTER FUNCTION public.renew_personal_media_maintenance(uuid, text, uuid, uuid) OWNER TO platform_executor;
ALTER FUNCTION public.record_personal_media_maintenance_error(uuid, text, uuid, uuid, text) OWNER TO platform_executor;
ALTER FUNCTION public.finish_personal_media_maintenance(uuid, text, uuid, uuid, text) OWNER TO platform_executor;
ALTER FUNCTION public.handoff_file_operation_failure(uuid, uuid, uuid, text) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.file_maintenance_job(uuid, uuid) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.require_file_maintenance_lease(uuid, uuid, uuid, boolean) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.personal_media_maintenance_job(uuid, text, uuid) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.require_personal_media_maintenance_lease(uuid, text, uuid, uuid, boolean) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.get_file_maintenance_candidates(integer) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.claim_file_maintenance(uuid, text, uuid, uuid, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.renew_file_maintenance(uuid, uuid, uuid) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.record_file_maintenance_object(uuid, uuid, uuid, uuid, text, bigint, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.record_file_maintenance_error(uuid, uuid, uuid, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.finish_file_maintenance(uuid, uuid, uuid, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.renew_personal_media_upload(uuid, uuid, uuid, uuid) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.get_personal_media_maintenance_candidates(integer) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.claim_personal_media_maintenance(uuid, text, uuid, uuid) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.renew_personal_media_maintenance(uuid, text, uuid, uuid) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.record_personal_media_maintenance_error(uuid, text, uuid, uuid, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
REVOKE ALL ON FUNCTION public.finish_personal_media_maintenance(uuid, text, uuid, uuid, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.get_file_maintenance_candidates(integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.claim_file_maintenance(uuid, text, uuid, uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.renew_file_maintenance(uuid, uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.record_file_maintenance_object(uuid, uuid, uuid, uuid, text, bigint, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.record_file_maintenance_error(uuid, uuid, uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.finish_file_maintenance(uuid, uuid, uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.renew_personal_media_upload(uuid, uuid, uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.get_personal_media_maintenance_candidates(integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.claim_personal_media_maintenance(uuid, text, uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.renew_personal_media_maintenance(uuid, text, uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.record_personal_media_maintenance_error(uuid, text, uuid, uuid, text) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.finish_personal_media_maintenance(uuid, text, uuid, uuid, text) TO app_runtime;
REVOKE ALL ON FUNCTION public.handoff_file_operation_failure(uuid, uuid, uuid, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.handoff_file_operation_failure(uuid, uuid, uuid, text) TO app_runtime;
