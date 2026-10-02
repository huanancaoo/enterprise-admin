-- 最终 Session 校验失败不能伪造身份，也不能删除可能已经发布的对象。
CREATE FUNCTION public.handoff_personal_media_upload_failure(p_user uuid, p_operation uuid, p_lease uuid, p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_operation public.personal_media_operations%ROWTYPE;
BEGIN
  PERFORM set_config('app.personal_media_user_id', p_user::text, true);
  SELECT * INTO v_operation FROM public.personal_media_operations WHERE user_id = p_user AND id = p_operation FOR UPDATE;
  IF NOT FOUND OR p_lease IS NULL OR v_operation.lease_id IS DISTINCT FROM p_lease
    OR v_operation.committed_at IS NOT NULL OR v_operation.phase IN ('completed','failed') THEN RAISE EXCEPTION 'FILE_OPERATION_LEASE_CONFLICT'; END IF;
  IF p_code IS NULL OR p_code !~ '^[A-Z][A-Z0-9_]{0,99}$' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  -- 到期但尚未被接管的 token 只能移交错误；新的系统 claim 才能执行物理删除。
  UPDATE public.personal_media_operations SET error_code = p_code, lease_expires_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE user_id = p_user AND id = p_operation;
END;
$function$;
--> statement-breakpoint
ALTER POLICY personal_media_operations_maintenance_candidates ON public.personal_media_operations
USING (phase IN ('pending','preparing') AND (expires_at <= clock_timestamp() OR error_code IS NOT NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_personal_media_maintenance_candidates(p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('userId', user_id, 'kind', kind, 'id', id) ORDER BY due, id), '[]'::jsonb)
    INTO v_result FROM (
      SELECT * FROM (
        SELECT user_id, 'upload'::text kind, id, expires_at due FROM public.personal_media_operations
          WHERE phase IN ('pending','preparing') AND (expires_at <= clock_timestamp() OR error_code IS NOT NULL) AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
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
CREATE OR REPLACE FUNCTION public.claim_personal_media_maintenance(p_user uuid, p_kind text, p_id uuid, p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_operation public.personal_media_operations%ROWTYPE; v_media public.personal_media%ROWTYPE; v_now timestamptz;
BEGIN
  IF p_user IS NULL OR p_id IS NULL OR p_lease IS NULL OR p_kind IS NULL OR p_kind NOT IN ('upload','media') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  PERFORM set_config('app.personal_media_user_id', p_user::text, true);
  v_now := clock_timestamp();
  IF p_kind = 'upload' THEN
    SELECT * INTO v_operation FROM public.personal_media_operations WHERE user_id = p_user AND id = p_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR v_operation.phase NOT IN ('pending','preparing') OR (v_operation.expires_at > v_now AND v_operation.error_code IS NULL)
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
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.handoff_personal_media_upload_failure(uuid, uuid, uuid, text) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.handoff_personal_media_upload_failure(uuid, uuid, uuid, text) FROM PUBLIC, app_runtime, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.handoff_personal_media_upload_failure(uuid, uuid, uuid, text) TO app_runtime;
