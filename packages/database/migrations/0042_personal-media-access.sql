ALTER TABLE public.personal_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_media FORCE ROW LEVEL SECURITY;
ALTER TABLE public.personal_media_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_media_operations FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.personal_media, public.personal_media_operations TO platform_executor;
CREATE POLICY personal_media_executor ON public.personal_media TO platform_executor
USING (user_id = NULLIF(current_setting('app.personal_media_user_id', true), '')::uuid OR id = NULLIF(current_setting('app.personal_media_id', true), '')::uuid)
WITH CHECK (user_id = NULLIF(current_setting('app.personal_media_user_id', true), '')::uuid);
CREATE POLICY personal_media_operations_executor ON public.personal_media_operations TO platform_executor
USING (user_id = NULLIF(current_setting('app.personal_media_user_id', true), '')::uuid)
WITH CHECK (user_id = NULLIF(current_setting('app.personal_media_user_id', true), '')::uuid);
GRANT SELECT (image) ON public."user" TO platform_executor;
GRANT UPDATE (image, updated_at) ON public."user" TO platform_executor;
GRANT SELECT (organization_id, role, permission) ON public.organization_role TO platform_executor;
CREATE POLICY audit_events_personal_media_insert ON public.audit_events FOR INSERT TO platform_executor
WITH CHECK (organization_id IS NULL AND scope = 'user' AND NOT tenant_visible
  AND event_code IN ('personal_media.uploaded', 'user.avatar_updated', 'personal_media.purged'));
--> statement-breakpoint
CREATE FUNCTION public.require_personal_media_session(p_actor uuid, p_session uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.session WHERE id = p_session AND user_id = p_actor AND expires_at > clock_timestamp())
    THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.protect_personal_media_content() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog AS $function$
BEGIN
  IF (NEW.id, NEW.user_id, NEW.operation_id, NEW.bytes, NEW.sha256, NEW.content_type, NEW.storage_path, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.operation_id, OLD.bytes, OLD.sha256, OLD.content_type, OLD.storage_path, OLD.created_at)
    THEN RAISE EXCEPTION 'personal media content is immutable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER personal_media_immutable BEFORE UPDATE ON public.personal_media FOR EACH ROW EXECUTE FUNCTION public.protect_personal_media_content();
--> statement-breakpoint
CREATE FUNCTION public.protect_personal_avatar_reference() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog SET row_security = on AS $function$
BEGIN
  IF NEW.image IS NOT DISTINCT FROM OLD.image THEN RETURN NEW; END IF;
  IF CURRENT_USER <> 'platform_executor' THEN RAISE EXCEPTION 'personal avatar requires controlled media update' USING ERRCODE = '42501'; END IF;
  IF NEW.image IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.personal_media
    WHERE user_id = NEW.id AND NEW.image = '/api/v1/personal-media/' || id::text || '/content'
      AND purged_at IS NULL AND (expires_at IS NULL OR expires_at > clock_timestamp()))
    THEN RAISE EXCEPTION 'PERSONAL_MEDIA_NOT_FOUND'; END IF;
  RETURN NEW;
END;
$function$;
-- 只约束实际image变化；OAuth初次资料由身份创建hook处理，不阻断既有昵称/语言更新。
CREATE TRIGGER user_controlled_avatar BEFORE UPDATE OF image ON public."user" FOR EACH ROW EXECUTE FUNCTION public.protect_personal_avatar_reference();
--> statement-breakpoint
CREATE FUNCTION public.begin_personal_media_upload(p_actor uuid, p_session uuid, p_operation uuid,
  p_hash text, p_bytes bigint, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_operation public.personal_media_operations%ROWTYPE;
BEGIN
  PERFORM public.require_personal_media_session(p_actor, p_session);
  IF p_operation IS NULL OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 5242880
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  PERFORM set_config('app.personal_media_user_id', p_actor::text, true);
  PERFORM 1 FROM public."user" WHERE id = p_actor FOR UPDATE;
  PERFORM public.require_personal_media_session(p_actor, p_session);
  SELECT * INTO v_operation FROM public.personal_media_operations WHERE user_id = p_actor AND id = p_operation FOR UPDATE;
  IF FOUND THEN
    IF v_operation.request_hash <> p_hash OR v_operation.declared_bytes <> p_bytes THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    RETURN jsonb_build_object('operation', to_jsonb(v_operation), 'reused', true);
  END IF;
  INSERT INTO public.personal_media_operations (id, user_id, media_id, request_hash, request_id, declared_bytes, expires_at)
    VALUES (p_operation, p_actor, gen_random_uuid(), p_hash, p_request, p_bytes, clock_timestamp() + interval '24 hours') RETURNING * INTO v_operation;
  RETURN jsonb_build_object('operation', to_jsonb(v_operation), 'reused', false);
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.claim_personal_media_upload(p_actor uuid, p_session uuid, p_operation uuid, p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_operation public.personal_media_operations%ROWTYPE;
BEGIN
  PERFORM public.require_personal_media_session(p_actor, p_session);
  PERFORM set_config('app.personal_media_user_id', p_actor::text, true);
  SELECT * INTO v_operation FROM public.personal_media_operations WHERE user_id = p_actor AND id = p_operation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERSONAL_MEDIA_OPERATION_NOT_FOUND'; END IF;
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
CREATE FUNCTION public.publish_personal_media_upload(p_actor uuid, p_session uuid, p_operation uuid,
  p_lease uuid, p_bytes bigint, p_sha text, p_type text, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_operation public.personal_media_operations%ROWTYPE; v_media public.personal_media%ROWTYPE; v_now timestamptz;
BEGIN
  PERFORM public.require_personal_media_session(p_actor, p_session);
  PERFORM set_config('app.personal_media_user_id', p_actor::text, true);
  SELECT * INTO v_operation FROM public.personal_media_operations WHERE user_id = p_actor AND id = p_operation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERSONAL_MEDIA_OPERATION_NOT_FOUND'; END IF;
  v_now := clock_timestamp();
  IF p_bytes IS NULL OR p_bytes <> v_operation.declared_bytes OR p_sha IS NULL OR p_sha !~ '^[0-9a-f]{64}$'
    OR p_type IS NULL OR p_type NOT IN ('image/jpeg','image/png','image/webp','image/gif') THEN RAISE EXCEPTION 'PERSONAL_MEDIA_CONTENT_MISMATCH'; END IF;
  IF v_operation.committed_at IS NOT NULL THEN
    IF (v_operation.actual_bytes, v_operation.actual_sha256, v_operation.content_type) IS DISTINCT FROM (p_bytes, p_sha, p_type)
      THEN RAISE EXCEPTION 'PERSONAL_MEDIA_CONTENT_MISMATCH'; END IF;
    SELECT * INTO v_media FROM public.personal_media WHERE user_id = p_actor AND id = v_operation.media_id;
    RETURN to_jsonb(v_media);
  END IF;
  IF v_operation.phase = 'failed' OR v_operation.expires_at <= v_now THEN RAISE EXCEPTION 'PERSONAL_MEDIA_OPERATION_EXPIRED'; END IF;
  IF p_lease IS NULL OR v_operation.lease_id IS DISTINCT FROM p_lease OR v_operation.lease_expires_at <= v_now
    THEN RAISE EXCEPTION 'FILE_OPERATION_LEASE_CONFLICT'; END IF;
  PERFORM public.require_personal_media_session(p_actor, p_session);
  INSERT INTO public.personal_media (id, user_id, operation_id, bytes, sha256, content_type, storage_path, expires_at)
    VALUES (v_operation.media_id, p_actor, p_operation, p_bytes, p_sha, p_type, ARRAY[v_operation.media_id::text], v_now + interval '24 hours') RETURNING * INTO v_media;
  UPDATE public.personal_media_operations SET actual_bytes = p_bytes, actual_sha256 = p_sha, content_type = p_type,
    phase = 'completed', committed_at = v_now, completed_at = v_now, updated_at = v_now, lease_id = NULL, lease_expires_at = NULL, error_code = NULL
    WHERE user_id = p_actor AND id = p_operation;
  BEGIN
    INSERT INTO public.audit_events (scope, event_code, actor_id, resource_type, resource_id, result, request_id, operation_id, tenant_visible, fields)
      VALUES ('user', 'personal_media.uploaded', p_actor, 'personal_media', v_media.id, 'succeeded', p_request, p_operation::text, false, jsonb_build_object('bytes', p_bytes));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  RETURN to_jsonb(v_media);
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.get_personal_media_operation(p_actor uuid, p_session uuid, p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_personal_media_session(p_actor, p_session);
  PERFORM set_config('app.personal_media_user_id', p_actor::text, true);
  SELECT to_jsonb(o) INTO v_result FROM public.personal_media_operations o WHERE user_id = p_actor AND id = p_operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERSONAL_MEDIA_OPERATION_NOT_FOUND'; END IF;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.fail_personal_media_upload(p_actor uuid, p_session uuid, p_operation uuid,
  p_lease uuid, p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_operation public.personal_media_operations%ROWTYPE;
BEGIN
  PERFORM public.require_personal_media_session(p_actor, p_session);
  PERFORM set_config('app.personal_media_user_id', p_actor::text, true);
  SELECT * INTO v_operation FROM public.personal_media_operations WHERE user_id = p_actor AND id = p_operation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERSONAL_MEDIA_OPERATION_NOT_FOUND'; END IF;
  IF v_operation.phase = 'failed' THEN RETURN; END IF;
  IF v_operation.committed_at IS NOT NULL THEN RAISE EXCEPTION 'FILE_OPERATION_NOT_READY'; END IF;
  IF p_lease IS NULL OR v_operation.lease_id IS DISTINCT FROM p_lease OR v_operation.lease_expires_at <= clock_timestamp()
    THEN RAISE EXCEPTION 'FILE_OPERATION_LEASE_CONFLICT'; END IF;
  IF p_code IS NULL OR p_code !~ '^[A-Z][A-Z0-9_]{0,99}$' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  -- 调用只发生在服务端确认该操作固定mediaId目标已删除之后。
  UPDATE public.personal_media_operations SET phase = 'failed', cleaned_at = clock_timestamp(), error_code = p_code,
    updated_at = clock_timestamp(), lease_id = NULL, lease_expires_at = NULL WHERE user_id = p_actor AND id = p_operation;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.set_personal_avatar(p_actor uuid, p_session uuid, p_media uuid, p_expected_image text,
  p_key text, p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_previous text; v_image text; v_media public.personal_media%ROWTYPE;
  v_hash text; v_receipt record; v_operation uuid; v_changed boolean; v_result jsonb;
  v_scope text := 'user:avatar';
BEGIN
  PERFORM public.require_personal_media_session(p_actor, p_session);
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 128 OR p_key !~ '^[A-Za-z0-9:_-]+$'
    OR length(p_expected_image) > 512 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  PERFORM set_config('app.personal_media_user_id', p_actor::text, true);
  SELECT image INTO v_previous FROM public."user" WHERE id = p_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  PERFORM public.require_personal_media_session(p_actor, p_session);
  v_hash := encode(sha256(convert_to(jsonb_build_object('mediaId', p_media, 'expectedImage', p_expected_image)::text, 'UTF8')), 'hex');
  DELETE FROM public.operation_receipts WHERE actor_id = p_actor AND scope_key = v_scope AND expires_at <= clock_timestamp();
  SELECT request_hash, safe_result INTO v_receipt FROM public.operation_receipts
    WHERE actor_id = p_actor AND scope_key = v_scope AND action = 'setAvatar' AND idempotency_key = p_key;
  IF FOUND THEN
    IF v_receipt.request_hash <> v_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    RETURN v_receipt.safe_result;
  END IF;
  IF v_previous IS DISTINCT FROM p_expected_image THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF p_media IS NOT NULL THEN
    SELECT * INTO v_media FROM public.personal_media WHERE user_id = p_actor AND id = p_media
      AND purged_at IS NULL AND (expires_at IS NULL OR expires_at > clock_timestamp()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PERSONAL_MEDIA_NOT_FOUND'; END IF;
    v_image := '/api/v1/personal-media/' || p_media::text || '/content';
  END IF;
  PERFORM public.require_personal_media_session(p_actor, p_session);
  v_changed := v_previous IS DISTINCT FROM v_image;
  v_operation := gen_random_uuid();
  IF v_changed THEN
    UPDATE public.personal_media SET expires_at = clock_timestamp() + interval '24 hours'
      WHERE user_id = p_actor AND '/api/v1/personal-media/' || id::text || '/content' = v_previous AND id IS DISTINCT FROM p_media;
    IF p_media IS NOT NULL THEN UPDATE public.personal_media SET expires_at = NULL WHERE user_id = p_actor AND id = p_media; END IF;
    UPDATE public."user" SET image = v_image, updated_at = clock_timestamp() WHERE id = p_actor;
  END IF;
  v_result := jsonb_build_object('image', v_image, 'changed', v_changed,
    'result', CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END, 'operationId', v_operation);
  BEGIN
    INSERT INTO public.audit_events (scope, event_code, actor_id, resource_type, resource_id, result, request_id, operation_id, tenant_visible, fields)
      VALUES ('user', 'user.avatar_updated', p_actor, 'user', p_actor, CASE WHEN v_changed THEN 'succeeded' ELSE 'no_change' END,
        p_request, v_operation::text, false, jsonb_build_object('mediaId', p_media));
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END;
  INSERT INTO public.operation_receipts (actor_id, scope_key, action, idempotency_key, request_hash, operation_id, safe_result, expires_at)
    VALUES (p_actor, v_scope, 'setAvatar', p_key, v_hash, v_operation, v_result, clock_timestamp() + interval '24 hours');
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION public.get_personal_media_content(p_actor uuid, p_session uuid, p_media uuid, p_organization uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET row_security = on AS $function$
DECLARE v_media public.personal_media%ROWTYPE;
BEGIN
  PERFORM public.require_personal_media_session(p_actor, p_session);
  PERFORM set_config('app.personal_media_id', p_media::text, true);
  SELECT * INTO v_media FROM public.personal_media WHERE id = p_media AND purged_at IS NULL
    AND (expires_at IS NULL OR expires_at > clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERSONAL_MEDIA_NOT_FOUND'; END IF;
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
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.require_personal_media_session(uuid, uuid) OWNER TO platform_executor;
ALTER FUNCTION public.begin_personal_media_upload(uuid, uuid, uuid, text, bigint, text) OWNER TO platform_executor;
ALTER FUNCTION public.claim_personal_media_upload(uuid, uuid, uuid, uuid) OWNER TO platform_executor;
ALTER FUNCTION public.publish_personal_media_upload(uuid, uuid, uuid, uuid, bigint, text, text, text) OWNER TO platform_executor;
ALTER FUNCTION public.get_personal_media_operation(uuid, uuid, uuid) OWNER TO platform_executor;
ALTER FUNCTION public.fail_personal_media_upload(uuid, uuid, uuid, uuid, text) OWNER TO platform_executor;
ALTER FUNCTION public.set_personal_avatar(uuid, uuid, uuid, text, text, text) OWNER TO platform_executor;
ALTER FUNCTION public.get_personal_media_content(uuid, uuid, uuid, uuid) OWNER TO platform_executor;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
REVOKE ALL ON FUNCTION public.require_personal_media_session(uuid, uuid), public.protect_personal_media_content(), public.protect_personal_avatar_reference() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_personal_media_upload(uuid, uuid, uuid, text, bigint, text),
  public.claim_personal_media_upload(uuid, uuid, uuid, uuid), public.publish_personal_media_upload(uuid, uuid, uuid, uuid, bigint, text, text, text),
  public.get_personal_media_operation(uuid, uuid, uuid), public.fail_personal_media_upload(uuid, uuid, uuid, uuid, text),
  public.set_personal_avatar(uuid, uuid, uuid, text, text, text), public.get_personal_media_content(uuid, uuid, uuid, uuid)
FROM PUBLIC, platform_runtime, platform_deployer;
GRANT EXECUTE ON FUNCTION public.begin_personal_media_upload(uuid, uuid, uuid, text, bigint, text),
  public.claim_personal_media_upload(uuid, uuid, uuid, uuid), public.publish_personal_media_upload(uuid, uuid, uuid, uuid, bigint, text, text, text),
  public.get_personal_media_operation(uuid, uuid, uuid), public.fail_personal_media_upload(uuid, uuid, uuid, uuid, text),
  public.set_personal_avatar(uuid, uuid, uuid, text, text, text), public.get_personal_media_content(uuid, uuid, uuid, uuid)
TO app_runtime;
