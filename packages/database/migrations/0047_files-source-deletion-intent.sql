ALTER TABLE "file_operation_objects" ADD COLUMN "source_deletion_started_at" timestamp with time zone;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_file_maintenance_object(p_organization uuid, p_operation uuid, p_lease uuid, p_object uuid, p_fact text, p_bytes bigint DEFAULT NULL, p_sha text DEFAULT NULL)
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
    IF v_object.source_deletion_started_at IS NOT NULL AND v_object.source_restored_at IS NULL AND v_operation.committed_at IS NULL THEN RAISE EXCEPTION 'FILE_OPERATION_NOT_READY'; END IF;
    IF v_object.target_deleted_at IS NOT NULL THEN RETURN; END IF;
    UPDATE public.file_operation_objects SET target_deleted_at = clock_timestamp(), transient_bytes = 0 WHERE id = p_object AND organization_id = p_organization;
    v_delta := -v_object.transient_bytes;
  ELSIF p_fact = 'source_restored' THEN
    IF v_operation.committed_at IS NOT NULL OR v_operation.action = 'purge' OR (v_object.source_deletion_started_at IS NULL AND v_object.source_deleted_at IS NULL) THEN RAISE EXCEPTION 'FILE_OPERATION_NOT_READY'; END IF;
    IF p_bytes IS DISTINCT FROM v_object.expected_bytes OR (v_object.expected_sha256 IS NOT NULL AND p_sha IS DISTINCT FROM v_object.expected_sha256)
      THEN RAISE EXCEPTION 'FILE_CONTENT_MISMATCH'; END IF;
    IF v_object.source_restored_at IS NOT NULL THEN RETURN; END IF;
    v_delta := (CASE WHEN v_object.target_deleted_at IS NULL THEN p_bytes ELSE 0 END) - v_object.transient_bytes;
    UPDATE public.file_operation_objects SET source_restored_at = clock_timestamp(), transient_bytes = transient_bytes + v_delta WHERE id = p_object AND organization_id = p_organization;
  ELSE RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  UPDATE public.file_storage_usage SET transient_bytes = transient_bytes + v_delta WHERE organization_id = p_organization;
END;
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.finish_file_maintenance(p_organization uuid, p_operation uuid, p_lease uuid, p_request text)
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
      AND ((target_area IS NOT NULL AND target_deleted_at IS NULL) OR ((source_deletion_started_at IS NOT NULL OR source_deleted_at IS NOT NULL) AND source_restored_at IS NULL)))
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
