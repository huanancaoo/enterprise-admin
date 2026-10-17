-- 任务提交使用任务读取权和原业务动作；代码权限目录不定义额外的任务创建动作。
CREATE OR REPLACE FUNCTION public.platform_task_command(p_actor uuid,p_session uuid,p_operation text,p_id uuid,p_input jsonb,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE
  v_task public.platform_tasks%ROWTYPE; v_existing public.platform_tasks%ROWTYPE;
  v_kind text; v_resource text; v_action text; v_key text; v_fingerprint text; v_input jsonb;
  v_page integer; v_size integer; v_result jsonb; v_resource_id uuid; v_status text; v_error text;
BEGIN
  IF p_actor IS NULL OR p_session IS NULL OR p_operation IS NULL OR
    p_operation NOT IN ('submit','find','list','get','download','claim','queued','complete','fail') OR
    p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR p_request IS NULL OR length(btrim(p_request))=0
  THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF p_operation='submit' THEN
    v_kind:=p_input->>'kind'; v_resource:=p_input->>'resource';
    v_action:=public.platform_task_action(v_kind,v_resource);
    v_key:=p_input->>'idempotencyKey'; v_fingerprint:=p_input->>'intentFingerprint'; v_input:=p_input->'input';
    IF v_key IS NULL OR length(btrim(v_key)) NOT BETWEEN 1 AND 200 OR v_fingerprint IS NULL OR
      v_fingerprint !~ '^[0-9a-f]{64}$'
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    PERFORM public.lock_platform_authorization();
    PERFORM public.require_platform_action(p_actor,p_session,'platform.task:read');
    PERFORM public.require_platform_action(p_actor,p_session,v_action);
    SELECT * INTO v_existing FROM public.platform_tasks WHERE actor_id=p_actor AND idempotency_key=v_key FOR UPDATE;
    IF FOUND THEN
      IF v_existing.intent_fingerprint<>v_fingerprint OR v_existing.kind<>v_kind OR v_existing.resource<>v_resource
      THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
      RETURN public.platform_task_projection(v_existing);
    END IF;
    IF v_input IS NULL OR jsonb_typeof(v_input)<>'object' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF v_kind='export' THEN
      IF v_input-'filters'<>'{}'::jsonb OR jsonb_typeof(v_input->'filters') IS DISTINCT FROM 'object'
        OR p_input->>'credentialCiphertext' IS NOT NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_input->'filters') k WHERE k NOT IN
        ('q','status','departmentId','roleId','dictionaryId','parentId','sortBy','sortOrder','method','result','userId','actorId','eventCode','organizationId','from','to'))
      THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    ELSE
      IF v_input-'inputResourceId'-'updateExisting'<>'{}'::jsonb OR NOT(v_input ? 'inputResourceId') OR
        jsonb_typeof(v_input->'updateExisting') IS DISTINCT FROM 'boolean' OR
        p_input->>'credentialCiphertext' IS NULL OR length(p_input->>'credentialCiphertext')=0
      THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
      v_resource_id:=(v_input->>'inputResourceId')::uuid;
      IF NOT EXISTS(SELECT 1 FROM public.platform_resources WHERE id=v_resource_id AND uploaded_by=p_actor AND purpose='task-input')
      THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    END IF;
    INSERT INTO public.platform_tasks(id,actor_id,session_id,kind,resource,idempotency_key,intent_fingerprint,input,credential_ciphertext,request_id)
    VALUES(COALESCE(p_id,gen_random_uuid()),p_actor,p_session,v_kind,v_resource,v_key,v_fingerprint,v_input,p_input->>'credentialCiphertext',p_request)
    RETURNING * INTO v_task;
    PERFORM public.append_platform_task_audit(p_actor,v_task.id,'submitted',p_request);
    RETURN public.platform_task_projection(v_task);
  END IF;
  IF p_operation='find' THEN
    PERFORM public.require_platform_action(p_actor,p_session,'platform.task:read');
    v_key:=p_input->>'idempotencyKey';
    IF v_key IS NULL OR length(btrim(v_key)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    SELECT * INTO v_task FROM public.platform_tasks WHERE actor_id=p_actor AND idempotency_key=v_key;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN public.platform_task_projection(v_task);
  END IF;
  IF p_operation='list' THEN
    PERFORM public.require_platform_action(p_actor,p_session,'platform.task:read');
    v_page:=COALESCE((p_input->>'page')::integer,1);v_size:=COALESCE((p_input->>'pageSize')::integer,20);
    IF v_page<1 OR v_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    WITH owned AS(SELECT * FROM public.platform_tasks WHERE actor_id=p_actor),
    selected AS(SELECT * FROM owned ORDER BY created_at DESC,id DESC LIMIT v_size OFFSET(v_page::bigint-1)*v_size)
    SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.platform_task_projection(s::public.platform_tasks) ORDER BY s.created_at DESC,s.id DESC) FROM selected s),'[]'::jsonb),
      'page',v_page,'pageSize',v_size,'total',(SELECT count(*) FROM owned)) INTO v_result;
    RETURN v_result;
  END IF;
  IF p_id IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF p_operation IN ('get','download') THEN
    PERFORM public.require_platform_action(p_actor,p_session,'platform.task:read');
    SELECT * INTO v_task FROM public.platform_tasks WHERE id=p_id AND actor_id=p_actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF p_operation='get' THEN RETURN public.platform_task_projection(v_task); END IF;
    PERFORM public.require_platform_action(p_actor,p_session,'platform.task:download');
    PERFORM public.require_platform_action(p_actor,p_session,public.platform_task_action(v_task.kind,v_task.resource));
    IF v_task.status<>'completed' OR v_task.result_resource_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    RETURN jsonb_build_object('resultResourceId',v_task.result_resource_id);
  END IF;
  -- 与幂等提交共用授权锁→任务行锁顺序，避免重复提交和 Worker 结算互相等待。
  IF p_operation<>'fail' THEN PERFORM public.lock_platform_authorization(); END IF;
  -- 队列结算只接受任务最初绑定的身份和会话，不能用另一个有效会话接管任务。
  SELECT * INTO v_task FROM public.platform_tasks WHERE id=p_id AND actor_id=p_actor AND session_id=p_session FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_operation='fail' THEN
    v_status:=p_input->>'status';v_error:=p_input->>'errorCode';
    IF v_status IS NULL OR v_status NOT IN ('failed','rejected') OR v_error IS NULL OR v_error !~ '^[A-Z_]{1,100}$'
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF v_task.status IN ('completed','failed','rejected') THEN RETURN public.platform_task_projection(v_task); END IF;
    -- 撤权后必须仍能结算原绑定任务，否则临时凭据会因鉴权失败永久保留。
    UPDATE public.platform_tasks SET status=v_status,error_code=v_error,credential_ciphertext=NULL,
      result_resource_id=NULL,result=NULL,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_task;
    PERFORM public.append_platform_task_audit(p_actor,p_id,v_status,p_request);
    RETURN public.platform_task_projection(v_task);
  END IF;
  PERFORM public.require_platform_action(p_actor,p_session,'platform.task:read');
  PERFORM public.require_platform_action(p_actor,p_session,public.platform_task_action(v_task.kind,v_task.resource));
  IF v_task.status IN ('completed','failed','rejected') THEN RETURN public.platform_task_projection(v_task); END IF;
  IF p_operation='claim' THEN
    UPDATE public.platform_tasks SET status='running',updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_task;
    RETURN public.platform_task_projection(v_task)||jsonb_build_object('input',v_task.input,
      'credentialCiphertext',v_task.credential_ciphertext,'sessionId',v_task.session_id);
  END IF;
  IF p_operation='queued' THEN
    IF v_task.status='pending' THEN
      UPDATE public.platform_tasks SET status='queued',updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_task;
    END IF;
    RETURN public.platform_task_projection(v_task);
  END IF;
  IF v_task.status<>'running' THEN RAISE EXCEPTION 'TASK_NOT_RUNNING'; END IF;
  v_resource_id:=(p_input->>'resultResourceId')::uuid;
  IF v_resource_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.platform_resources WHERE id=v_resource_id AND uploaded_by=p_actor AND purpose='task-output')
  THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_result:=NULLIF(p_input->'result','null'::jsonb);
  IF v_result IS NOT NULL THEN
    IF jsonb_typeof(v_result)<>'object' OR v_result-'total'-'created'-'updated'-'granted'-'skipped'-'failed'-'issues'<>'{}'::jsonb OR
      NOT(v_result ?& ARRAY['total','created','updated','granted','skipped','failed','issues']) OR jsonb_typeof(v_result->'issues')<>'array'
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_each(v_result-'issues') e WHERE jsonb_typeof(e.value)<>'number' OR (e.value#>>'{}') !~ '^[0-9]+$') OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(v_result->'issues') i WHERE
        jsonb_typeof(i)<>'object' OR i-'rowNumber'-'code'<>'{}'::jsonb OR NOT(i ?& ARRAY['rowNumber','code']) OR
        jsonb_typeof(i->'rowNumber')<>'number' OR i->>'rowNumber' !~ '^[1-9][0-9]*$' OR
        jsonb_typeof(i->'code')<>'string' OR i->>'code' !~ '^[A-Z_]{1,100}$')
    THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  END IF;
  UPDATE public.platform_tasks SET status='completed',result_resource_id=v_resource_id,result=v_result,
    credential_ciphertext=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_task;
  PERFORM public.append_platform_task_audit(p_actor,p_id,'completed',p_request);
  RETURN public.platform_task_projection(v_task);
END;
$f$;
