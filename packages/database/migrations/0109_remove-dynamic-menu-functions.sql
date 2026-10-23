-- 平台导航改为代码登记；保留业务页面的动作授权，删除菜单专用协议与授权项。
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_system_catalog(p_actor uuid, p_session uuid, p_resource text, p_operation text, p_id uuid, p_input jsonb, p_request text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET row_security TO 'on'
AS $function$
DECLARE
  v_table text; v_action text; v_namespace text;
  v_old jsonb; v_row jsonb; v_payload jsonb; v_result jsonb; v_fields text[]; v_required text[];
  v_field text; v_column text; v_assignments text; v_sort text; v_order text;
  v_status text; v_q text; v_page integer; v_size integer; v_offset bigint; v_dictionary uuid;
  v_parent uuid; v_parent_row jsonb; v_cycle boolean; v_has_active_children boolean; v_version integer;
BEGIN
  IF p_resource IS NULL OR p_resource NOT IN ('department','post','dictionary','dictionary-item','parameter') OR
    p_operation IS NULL OR p_operation NOT IN ('list','export-page','get','create','update','delete','set-status','refresh','by-key') OR
    p_input IS NULL OR jsonb_typeof(p_input)<>'object' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  v_table:='platform_'||replace(p_resource,'-','_');
  v_namespace:=CASE WHEN p_resource='dictionary-item' THEN 'dictionary' ELSE p_resource END;
  v_action:=CASE p_operation WHEN 'create' THEN 'create' WHEN 'update' THEN 'update' WHEN 'set-status' THEN 'update'
    WHEN 'delete' THEN 'delete' WHEN 'refresh' THEN 'refresh' WHEN 'export-page' THEN 'export' ELSE 'read' END;
  PERFORM public.require_platform_action(p_actor,p_session,'platform.'||v_namespace||':'||v_action);
  -- 导出执行器复用同一受限投影，授权动作独立于页面读取。
  IF p_operation='export-page' THEN p_operation:='list'; END IF;
  IF p_operation IN ('create','update','delete','set-status','refresh') THEN
    -- 同一树的移动/启停必须串行判定，字典条目与字典类型共用缓存写锁。
    PERFORM pg_advisory_xact_lock(hashtextextended('platform-system:'||v_namespace,0));
    PERFORM public.require_platform_action(p_actor,p_session,'platform.'||v_namespace||':'||v_action);
  END IF;
  IF p_operation='refresh' THEN
    IF p_resource NOT IN ('dictionary','parameter') OR p_input<>'{}'::jsonb THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    v_version:=public.rebuild_platform_system_cache(p_resource);
    PERFORM public.append_platform_system_audit(p_actor,p_resource,'cache_refreshed',NULL,p_request);
    RETURN jsonb_build_object('refreshed',true,'version',v_version);
  END IF;
  IF p_operation='by-key' THEN
    IF p_resource NOT IN ('dictionary','parameter') OR NOT(p_input ? 'key') OR p_input-ARRAY['key']<>'{}'::jsonb THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    SELECT payload INTO v_result FROM public.platform_system_cache WHERE resource=p_resource AND key=p_input->>'key';
    IF v_result IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    RETURN v_result;
  END IF;
  IF p_resource='dictionary-item' THEN
    v_dictionary:=(p_input->>'dictionaryId')::uuid;
    IF v_dictionary IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.platform_dictionary WHERE id=v_dictionary) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  IF p_operation='list' THEN
    v_status:=p_input->>'status'; v_q:=nullif(btrim(p_input->>'q'),'');
    IF (v_status IS NOT NULL AND v_status NOT IN ('active','disabled')) OR length(v_q)>200 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    IF p_resource='department' THEN
      IF p_input-ARRAY['parentId','q','status']<>'{}'::jsonb THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
      v_parent:=(p_input->>'parentId')::uuid;
      IF v_parent IS NOT NULL THEN
        EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',v_table) INTO v_parent_row USING v_parent;
        IF v_parent_row IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      END IF;
      EXECUTE format($query$
        WITH RECURSIVE matched AS (
          SELECT id,parent_id FROM public.%1$I WHERE ($1::text IS NULL OR status=$1)
            AND ($2::text IS NULL OR strpos(lower(key),lower($2))>0 OR strpos(lower(name),lower($2))>0)
        ), visible AS (
          SELECT id,parent_id FROM matched UNION
          SELECT p.id,p.parent_id FROM public.%1$I p JOIN visible v ON p.id=v.parent_id
        ), children AS (
          SELECT m.*,EXISTS(SELECT 1 FROM public.%1$I c JOIN visible v ON v.id=c.id WHERE c.parent_id=m.id) AS has_children
          FROM public.%1$I m JOIN visible v ON v.id=m.id WHERE m.parent_id IS NOT DISTINCT FROM $3::uuid
        ), ancestors AS (
          SELECT id,parent_id,1 AS depth FROM public.%1$I WHERE id=$3 UNION ALL
          SELECT m.id,m.parent_id,a.depth+1 FROM public.%1$I m JOIN ancestors a ON m.id=a.parent_id
        ) SELECT jsonb_build_object(
          'items',coalesce((SELECT jsonb_agg(public.platform_system_catalog_projection($4,to_jsonb(c)) ORDER BY sort,id) FROM children c),'[]'::jsonb),
          'ancestors',coalesce((SELECT jsonb_agg(public.platform_system_catalog_projection($4,to_jsonb(m)) ORDER BY a.depth DESC)
            FROM ancestors a JOIN public.%1$I m USING(id)),'[]'::jsonb))
      $query$,v_table) INTO v_result USING v_status,v_q,v_parent,p_resource;
      RETURN v_result;
    END IF;
    IF p_input-ARRAY['q','status','page','pageSize','sortBy','sortOrder','dictionaryId']<>'{}'::jsonb OR
      (p_resource<>'dictionary-item' AND p_input ? 'dictionaryId') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    v_page:=coalesce((p_input->>'page')::integer,1); v_size:=coalesce((p_input->>'pageSize')::integer,20);
    v_sort:=coalesce(p_input->>'sortBy','sort'); v_order:=coalesce(p_input->>'sortOrder','asc');
    IF v_page<1 OR v_size NOT BETWEEN 1 AND 100 OR v_order NOT IN ('asc','desc') OR
      (p_resource='dictionary-item' AND v_sort NOT IN ('sort','value','label','createdAt')) OR
      (p_resource<>'dictionary-item' AND v_sort NOT IN ('sort','key','name','createdAt')) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    v_sort:=CASE WHEN v_sort='createdAt' THEN 'created_at' ELSE v_sort END;
    v_offset:=(v_page::bigint-1)*v_size;
    EXECUTE format($query$
      WITH filtered AS MATERIALIZED (
        SELECT t.* FROM public.%1$I t WHERE ($1::text IS NULL OR status=$1)
          AND ($2::text IS NULL OR strpos(lower(%2$I),lower($2))>0 OR strpos(lower(%3$I),lower($2))>0) %4$s
      ), page AS (SELECT * FROM filtered ORDER BY %5$I %6$s,id %6$s LIMIT $4 OFFSET $5)
      SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(public.platform_system_catalog_projection($6,to_jsonb(p)) ORDER BY %5$I %6$s,id %6$s) FROM page p),'[]'::jsonb),
        'page',$3,'pageSize',$4,'total',(SELECT count(*) FROM filtered))
    $query$,v_table,CASE WHEN p_resource='dictionary-item' THEN 'value' ELSE 'key' END,
      CASE WHEN p_resource='dictionary-item' THEN 'label' ELSE 'name' END,
      CASE WHEN p_resource='dictionary-item' THEN 'AND dictionary_id=$7' ELSE '' END,v_sort,v_order)
      INTO v_result USING v_status,v_q,v_page,v_size,v_offset,p_resource,v_dictionary;
    RETURN v_result;
  END IF;
  IF p_operation<>'create' THEN
    IF p_id IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',v_table) INTO v_old USING p_id;
    IF v_old IS NULL OR (p_resource='dictionary-item' AND (v_old->>'dictionary_id')::uuid<>v_dictionary) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF p_operation='get' THEN
      IF p_input-ARRAY['dictionaryId']<>'{}'::jsonb OR (p_resource<>'dictionary-item' AND p_input<>'{}'::jsonb) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
      RETURN public.platform_system_catalog_projection(p_resource,v_old);
    END IF;
    IF p_operation='delete' THEN
      IF p_input-ARRAY['dictionaryId']<>'{}'::jsonb OR (p_resource<>'dictionary-item' AND p_input<>'{}'::jsonb) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
      EXECUTE format('DELETE FROM public.%I WHERE id=$1',v_table) USING p_id;
      IF v_namespace IN ('dictionary','parameter') THEN PERFORM public.rebuild_platform_system_cache(v_namespace); END IF;
      PERFORM public.append_platform_system_audit(p_actor,p_resource,'deleted',p_id,p_request);
      RETURN jsonb_build_object('id',p_id,'deleted',true);
    END IF;
  END IF;
  v_fields:=CASE p_resource
    WHEN 'department' THEN ARRAY['key','name','status','sort','parentId']
    WHEN 'post' THEN ARRAY['key','name','status','sort']
    WHEN 'dictionary' THEN ARRAY['key','name','status','sort','remark']
    WHEN 'dictionary-item' THEN ARRAY['dictionaryId','value','label','status','sort']
    WHEN 'parameter' THEN ARRAY['key','name','status','sort','value','remark'] END;
  IF p_operation='set-status' THEN
    v_required:=ARRAY['status'];
    IF p_input-(CASE WHEN p_resource='dictionary-item' THEN ARRAY['status','dictionaryId'] ELSE v_required END)<>'{}'::jsonb THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  ELSE
    v_required:=v_fields;
    IF p_input-v_fields<>'{}'::jsonb THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  END IF;
  IF NOT(p_input ?& v_required) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  v_payload:=CASE WHEN p_operation='create' THEN jsonb_build_object('id',gen_random_uuid(),'created_at',clock_timestamp()) ELSE v_old END;
  v_payload:=v_payload||jsonb_build_object('updated_at',clock_timestamp());
  v_assignments:='';
  FOREACH v_field IN ARRAY v_fields LOOP
    v_column:=CASE v_field WHEN 'parentId' THEN 'parent_id'
      WHEN 'dictionaryId' THEN 'dictionary_id' ELSE v_field END;
    IF p_input ? v_field THEN v_payload:=v_payload||jsonb_build_object(v_column,p_input->v_field); END IF;
    v_assignments:=v_assignments||format('%I=r.%I,',v_column,v_column);
  END LOOP;
  v_assignments:=v_assignments||'updated_at=r.updated_at';
  IF p_resource='department' THEN
    v_parent:=(v_payload->>'parent_id')::uuid;
    IF v_parent IS NOT NULL THEN
      EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',v_table) INTO v_parent_row USING v_parent;
      IF v_parent_row IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      EXECUTE format($query$WITH RECURSIVE ancestors AS (
        SELECT id,parent_id FROM public.%1$I WHERE id=$1 UNION ALL
        SELECT p.id,p.parent_id FROM public.%1$I p JOIN ancestors a ON p.id=a.parent_id
      ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=$2)$query$,v_table)
        INTO v_cycle USING v_parent,(v_payload->>'id')::uuid;
      IF v_cycle THEN RAISE EXCEPTION 'TREE_CYCLE'; END IF;
      IF v_parent_row->>'status'<>'active' AND (p_operation='create' OR v_payload->>'status'='active' OR
        v_old->'parent_id' IS DISTINCT FROM v_payload->'parent_id') THEN RAISE EXCEPTION 'PARENT_DISABLED'; END IF;
    END IF;
    IF v_payload->>'status'='disabled' THEN
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE parent_id=$1 AND status=''active'')',v_table)
        INTO v_has_active_children USING (v_payload->>'id')::uuid;
      IF v_has_active_children THEN RAISE EXCEPTION 'RESOURCE_IN_USE'; END IF;
    END IF;
  END IF;
  IF p_operation='create' THEN
    EXECUTE format('INSERT INTO public.%1$I SELECT (jsonb_populate_record(NULL::public.%1$I,$1)).* RETURNING to_jsonb(%1$I.*)',v_table) INTO v_row USING v_payload;
  ELSE
    EXECUTE format('UPDATE public.%1$I t SET %2$s FROM jsonb_populate_record(NULL::public.%1$I,$2) r WHERE t.id=$1 RETURNING to_jsonb(t.*)',v_table,v_assignments)
      INTO v_row USING p_id,v_payload;
  END IF;
  IF v_namespace IN ('dictionary','parameter') THEN PERFORM public.rebuild_platform_system_cache(v_namespace); END IF;
  PERFORM public.append_platform_system_audit(p_actor,p_resource,CASE p_operation WHEN 'create' THEN 'created'
    WHEN 'set-status' THEN 'status_changed' ELSE 'updated' END,(v_row->>'id')::uuid,p_request);
  RETURN public.platform_system_catalog_projection(p_resource,v_row);
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range OR not_null_violation OR check_violation THEN RAISE EXCEPTION 'VALIDATION_ERROR';
  WHEN unique_violation THEN RAISE EXCEPTION 'KEY_ALREADY_EXISTS';
  WHEN foreign_key_violation OR restrict_violation THEN RAISE EXCEPTION 'RESOURCE_IN_USE';
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_system_catalog_projection(p_resource text, p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
 SET row_security TO 'on'
AS $function$
DECLARE v_result jsonb; v_children boolean;
BEGIN
  v_result:=jsonb_build_object('id',p_row->'id','status',p_row->'status','sort',p_row->'sort',
    'createdAt',p_row->'created_at','updatedAt',p_row->'updated_at');
  IF p_resource='dictionary-item' THEN
    RETURN v_result||jsonb_build_object('dictionaryId',p_row->'dictionary_id','value',p_row->'value','label',p_row->'label');
  END IF;
  v_result:=v_result||jsonb_build_object('key',p_row->'key','name',p_row->'name');
  IF p_resource='department' THEN
    IF p_row ? 'has_children' THEN v_children:=(p_row->>'has_children')::boolean;
    ELSE SELECT EXISTS(SELECT 1 FROM public.platform_department WHERE parent_id=(p_row->>'id')::uuid) INTO v_children;
    END IF;
    v_result:=v_result||jsonb_build_object('parentId',p_row->'parent_id','hasChildren',v_children);
  END IF;
  IF p_resource IN ('dictionary','parameter') THEN v_result:=v_result||jsonb_build_object('remark',p_row->'remark'); END IF;
  IF p_resource='parameter' THEN v_result:=v_result||jsonb_build_object('value',p_row->'value'); END IF;
  RETURN v_result;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_system_identity(p_actor uuid, p_session uuid, p_resource text, p_operation text, p_id uuid, p_input jsonb, p_request text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET row_security TO 'on'
AS $function$
DECLARE
 v_result jsonb; v_id uuid:=p_id; v_ids uuid[]; v_posts uuid[]; v_roles uuid[]; v_department uuid;
 v_page integer:=COALESCE((p_input->>'page')::integer,1); v_size integer:=COALESCE((p_input->>'pageSize')::integer,20);
 v_sort text:=COALESCE(p_input->>'sortBy',CASE WHEN p_resource='employee' THEN 'createdAt' ELSE 'sort' END);
 v_order text:=COALESCE(p_input->>'sortOrder',CASE WHEN p_resource='employee' THEN 'desc' ELSE 'asc' END);
 v_status text:=p_input->>'status'; v_q text:=NULLIF(btrim(p_input->>'q'),'');
 v_row public.platform_assignment%ROWTYPE; v_role public.platform_role%ROWTYPE;
 v_now timestamptz:=clock_timestamp(); v_account_version integer; v_permission text; v_name text; v_email text;
BEGIN
 IF p_resource IS NULL OR p_resource NOT IN ('employee','role') OR p_operation IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object'
 OR p_request IS NULL OR length(btrim(p_request))=0 OR v_page<1 OR v_size<1 OR v_size>100
 OR v_order NOT IN ('asc','desc') OR (v_status IS NOT NULL AND v_status NOT IN ('active','disabled')) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF p_operation NOT IN ('list','get','candidates','employees','create','update','delete','batch-delete','set-status','set-roles','set-permissions','assign-employees','revoke-employees','import-lookup','export-page') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF p_operation='export-page' THEN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.'||p_resource||':export');
  p_operation:='list';
  -- 导出使用同一受限投影，但由独立export权限授权，不要求角色额外持有read。
  v_permission:='export';
 END IF;
 IF p_resource='employee' AND p_operation='import-lookup' THEN
  v_email:=lower(btrim(p_input->>'email'));
  IF v_email IS NULL OR length(v_email)=0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  PERFORM public.lock_platform_authorization();
  PERFORM id FROM public."user" WHERE lower(email)=v_email FOR UPDATE;
  PERFORM public.require_platform_action(p_actor,p_session,'platform.authorization:manage');
  -- 精确匹配仅供导入在同事务决定授任职或更新；返回标识和版本，不返回邮箱快照。
  SELECT jsonb_build_object('userId',u.id,'employeeId',CASE WHEN a.status<>'revoked' THEN a.user_id END,
   'expectedVersion',CASE WHEN a.status<>'revoked' THEN a.version+s.version-1 END,'emailVerified',u.email_verified)
  INTO v_result FROM public."user" u JOIN public.user_account_status s ON s.user_id=u.id LEFT JOIN public.platform_assignment a ON a.user_id=u.id WHERE lower(u.email)=v_email;
  RETURN COALESCE(v_result,jsonb_build_object('userId',NULL,'employeeId',NULL,'expectedVersion',NULL,'emailVerified',false));
 END IF;
 IF p_operation IN ('list','get','candidates','employees') THEN
  PERFORM public.require_platform_action(p_actor,p_session,'platform.'||p_resource||':'||COALESCE(v_permission,'read'));
  IF p_operation='candidates' THEN
   IF p_resource<>'employee' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   PERFORM public.require_platform_action(p_actor,p_session,'platform.authorization:manage');
   -- 候选只投影已验证且无当前任职的全局账号，不读取完整邮箱给前端。
   WITH eligible AS(SELECT u.id,u.name,left(split_part(u.email,'@',1),1)||'***@'||split_part(u.email,'@',2) AS masked_email,u.created_at
    FROM public."user" u WHERE u.email_verified AND NOT EXISTS(SELECT 1 FROM public.platform_assignment a WHERE a.user_id=u.id AND a.status<>'revoked')),
   matched AS(SELECT * FROM eligible WHERE v_q IS NULL OR strpos(lower(name),lower(v_q))>0 OR strpos(lower(masked_email),lower(v_q))>0 OR id::text=v_q),
   selected AS(SELECT * FROM matched ORDER BY created_at DESC,id DESC LIMIT v_size OFFSET (v_page::bigint-1)*v_size)
   SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',id,'name',name,'maskedEmail',masked_email) ORDER BY created_at DESC,id DESC) FROM selected),'[]'::jsonb),
    'page',v_page,'pageSize',v_size,'total',(SELECT count(*) FROM matched)) INTO v_result;
   RETURN v_result;
  END IF;
  IF p_operation='get' THEN
   v_result:=CASE p_resource WHEN 'employee' THEN public.platform_system_employee_projection(p_id) ELSE public.platform_system_role_projection(p_id) END;
   IF v_result IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF; RETURN v_result;
  END IF;
  IF p_resource='employee' OR p_operation='employees' THEN
   IF v_sort NOT IN ('name','status','createdAt') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   IF p_operation='employees' THEN
    IF NOT EXISTS(SELECT 1 FROM public.platform_role WHERE id=p_id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF NOT (p_input ? 'assigned') OR jsonb_typeof(p_input->'assigned')<>'boolean' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   END IF;
   WITH eligible AS(SELECT a.user_id,u.name,a.status,a.granted_at,p.department_id,
    left(split_part(u.email,'@',1),1)||'***@'||split_part(u.email,'@',2) AS masked_email
    FROM public.platform_assignment a JOIN public."user" u ON u.id=a.user_id LEFT JOIN public.platform_employee_profile p ON p.user_id=a.user_id
    WHERE a.status<>'revoked'),
   matched AS(SELECT * FROM eligible e WHERE
    (v_status IS NULL OR e.status=CASE v_status WHEN 'disabled' THEN 'suspended' ELSE 'active' END)
    AND (v_q IS NULL OR strpos(lower(e.name),lower(v_q))>0 OR strpos(lower(e.masked_email),lower(v_q))>0 OR e.user_id::text=v_q)
    AND (p_input->>'departmentId' IS NULL OR e.department_id=(p_input->>'departmentId')::uuid)
    AND (p_input->>'roleId' IS NULL OR EXISTS(SELECT 1 FROM public.platform_assignment_role x WHERE x.user_id=e.user_id AND x.role_id=(p_input->>'roleId')::uuid))
    AND (p_operation<>'employees' OR EXISTS(SELECT 1 FROM public.platform_assignment_role x WHERE x.user_id=e.user_id AND x.role_id=p_id)=(p_input->>'assigned')::boolean)),
   ordered AS(SELECT user_id,row_number() OVER(ORDER BY
    CASE WHEN v_sort='name' AND v_order='asc' THEN name END ASC,CASE WHEN v_sort='name' AND v_order='desc' THEN name END DESC,
    CASE WHEN v_sort='status' AND v_order='asc' THEN status END ASC,CASE WHEN v_sort='status' AND v_order='desc' THEN status END DESC,
    CASE WHEN v_sort='createdAt' AND v_order='asc' THEN granted_at END ASC,CASE WHEN v_sort='createdAt' AND v_order='desc' THEN granted_at END DESC,user_id) AS n FROM matched),
   selected AS(SELECT * FROM ordered ORDER BY n LIMIT v_size OFFSET (v_page::bigint-1)*v_size)
   SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.platform_system_employee_projection(user_id) ORDER BY n) FROM selected),'[]'::jsonb),
    'page',v_page,'pageSize',v_size,'total',(SELECT count(*) FROM matched)) INTO v_result; RETURN v_result;
  END IF;
  IF v_sort NOT IN ('name','key','sort','createdAt') OR p_operation<>'list' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  WITH matched AS(SELECT r.*,COALESCE(p.sort,0) AS sort FROM public.platform_role r LEFT JOIN public.platform_role_profile p ON p.role_id=r.id
   WHERE(v_status IS NULL OR r.status=CASE v_status WHEN 'disabled' THEN 'suspended' ELSE 'active' END)
    AND(v_q IS NULL OR strpos(lower(r.name),lower(v_q))>0 OR strpos(lower(r.key),lower(v_q))>0)),
  ordered AS(SELECT id,row_number() OVER(ORDER BY
    CASE WHEN v_sort='name' AND v_order='asc' THEN name END ASC,CASE WHEN v_sort='name' AND v_order='desc' THEN name END DESC,
    CASE WHEN v_sort='key' AND v_order='asc' THEN key END ASC,CASE WHEN v_sort='key' AND v_order='desc' THEN key END DESC,
    CASE WHEN v_sort='sort' AND v_order='asc' THEN sort END ASC,CASE WHEN v_sort='sort' AND v_order='desc' THEN sort END DESC,
    CASE WHEN v_sort='createdAt' AND v_order='asc' THEN created_at END ASC,CASE WHEN v_sort='createdAt' AND v_order='desc' THEN created_at END DESC,id) AS n FROM matched),
  selected AS(SELECT * FROM ordered ORDER BY n LIMIT v_size OFFSET(v_page::bigint-1)*v_size)
  SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.platform_system_role_projection(id) ORDER BY n) FROM selected),'[]'::jsonb),'page',v_page,'pageSize',v_size,'total',(SELECT count(*) FROM matched)) INTO v_result;
  RETURN v_result;
 END IF;
 -- 与所有任职、角色和全局账号状态写入共用同一事务锁，等锁后重新鉴权。
 PERFORM public.lock_platform_authorization();
 -- 先取得目标账号锁，再通过鉴权取得actor状态读锁，保持与原生改名的user→status顺序一致。
 IF p_resource='employee' THEN
  IF p_operation='create' AND p_input->>'mode'='existing' THEN
   PERFORM id FROM public."user" WHERE id=(p_input->>'userId')::uuid FOR UPDATE;
  ELSIF p_operation IN ('update','set-status','set-roles') THEN
   PERFORM id FROM public."user" WHERE id=p_id FOR UPDATE;
  END IF;
 END IF;
 PERFORM public.require_platform_action(p_actor,p_session,
  CASE WHEN p_resource='employee' AND p_operation='update' THEN 'platform.employee:update'
   WHEN p_resource='role' AND p_operation IN ('create','update','delete','set-status') THEN 'platform.role:'||CASE p_operation WHEN 'set-status' THEN 'update' ELSE p_operation END
   ELSE 'platform.authorization:manage' END);
 IF p_resource='employee' THEN
  IF p_operation='create' THEN
   v_department:=(p_input->>'departmentId')::uuid;
   SELECT COALESCE(array_agg(DISTINCT x::uuid),'{}'::uuid[]) INTO v_posts FROM jsonb_array_elements_text(COALESCE(p_input->'postIds','[]'::jsonb)) x;
   SELECT COALESCE(array_agg(DISTINCT x::uuid),'{}'::uuid[]) INTO v_roles FROM jsonb_array_elements_text(COALESCE(p_input->'roleIds','[]'::jsonb)) x;
   PERFORM public.validate_platform_employee_links(v_department,v_posts,v_roles);
   IF p_input->>'mode'='create' THEN
    v_id:=public.create_platform_employee(p_actor,p_session,p_input->>'email',p_input->>'name',p_input->>'passwordHash',v_roles,'platform employee creation',p_request);
   ELSIF p_input->>'mode'='existing' THEN
    v_id:=(p_input->>'userId')::uuid;
    PERFORM 1 FROM public."user" WHERE id=v_id AND email_verified FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    SELECT * INTO v_row FROM public.platform_assignment WHERE user_id=v_id FOR UPDATE;
    IF FOUND AND v_row.status<>'revoked' THEN RAISE EXCEPTION 'KEY_ALREADY_EXISTS'; END IF;
    INSERT INTO public.platform_assignment(user_id,status,version,granted_at,granted_by,grant_reason)
     VALUES(v_id,'active',1,v_now,p_actor::text,'platform employee assignment')
     ON CONFLICT(user_id) DO UPDATE SET status='active',version=public.platform_assignment.version+1,granted_at=v_now,granted_by=p_actor::text,grant_reason='platform employee assignment',revoked_at=NULL,revoked_by=NULL,revoke_reason=NULL;
    INSERT INTO public.platform_assignment_role(user_id,role_id) SELECT v_id,x FROM unnest(v_roles) x;
   ELSE RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   INSERT INTO public.platform_employee_profile(user_id,department_id) VALUES(v_id,v_department)
    ON CONFLICT(user_id) DO UPDATE SET department_id=EXCLUDED.department_id,updated_at=v_now;
   DELETE FROM public.platform_employee_post WHERE user_id=v_id;
   INSERT INTO public.platform_employee_post(user_id,post_id) SELECT v_id,x FROM unnest(v_posts) x;
   IF p_input->>'mode'='existing' THEN
    PERFORM public.append_platform_system_audit(p_actor,'employee','created',v_id,p_request);
   END IF;
   RETURN public.platform_system_employee_projection(v_id);
  END IF;
  IF p_operation IN ('delete','batch-delete') THEN
   IF p_operation='delete' THEN v_ids:=ARRAY[p_id]; ELSE SELECT array_agg(DISTINCT x::uuid) INTO v_ids FROM jsonb_array_elements_text(p_input->'userIds') x; END IF;
   IF cardinality(v_ids) IS NULL OR cardinality(v_ids)<1 OR cardinality(v_ids)>100 OR array_position(v_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   IF EXISTS(SELECT 1 FROM unnest(v_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.platform_assignment WHERE user_id=x AND status<>'revoked')) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   UPDATE public.platform_assignment SET status='revoked',version=version+1,revoked_at=v_now,revoked_by=p_actor::text,revoke_reason='platform employee removed' WHERE user_id=ANY(v_ids);
   DELETE FROM public.platform_employee_post WHERE user_id=ANY(v_ids);
   DELETE FROM public.platform_employee_profile WHERE user_id=ANY(v_ids);
   FOREACH v_id IN ARRAY v_ids LOOP PERFORM public.append_platform_system_audit(p_actor,'employee','deleted',v_id,p_request); END LOOP;
   IF p_operation='delete' THEN RETURN jsonb_build_object('id',p_id,'deleted',true); END IF;
   RETURN jsonb_build_object('userIds',to_jsonb(v_ids),'deleted',true);
  END IF;
  -- 姓名由全局账号共享；合成版本同时覆盖本人改名、任职资料和角色关联变化。
  SELECT version INTO v_account_version FROM public.user_account_status WHERE user_id=p_id;
  SELECT * INTO v_row FROM public.platform_assignment WHERE user_id=p_id AND status<>'revoked' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF (p_input->>'expectedVersion')::integer IS NULL OR (p_input->>'expectedVersion')::integer<>v_row.version+v_account_version-1 THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF p_operation='update' THEN
   IF jsonb_typeof(p_input->'postIds') IS DISTINCT FROM 'array' OR NOT(p_input ? 'departmentId') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   v_name:=btrim(p_input->>'name');v_department:=(p_input->>'departmentId')::uuid;
   SELECT COALESCE(array_agg(DISTINCT x::uuid),'{}'::uuid[]) INTO v_posts FROM jsonb_array_elements_text(p_input->'postIds') x;
   IF v_name IS NULL OR length(v_name)<1 OR length(v_name)>200 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   PERFORM public.validate_platform_employee_links(v_department,v_posts,'{}');
   UPDATE public."user" SET name=v_name,updated_at=v_now AT TIME ZONE 'UTC' WHERE id=p_id AND name IS DISTINCT FROM v_name;
   INSERT INTO public.platform_employee_profile(user_id,department_id) VALUES(p_id,v_department) ON CONFLICT(user_id) DO UPDATE SET department_id=EXCLUDED.department_id,updated_at=v_now;
   DELETE FROM public.platform_employee_post WHERE user_id=p_id;
   INSERT INTO public.platform_employee_post(user_id,post_id) SELECT p_id,x FROM unnest(v_posts) x;
   UPDATE public.platform_assignment SET version=version+1 WHERE user_id=p_id;
   PERFORM public.append_platform_system_audit(p_actor,'employee','updated',p_id,p_request);
  ELSIF p_operation='set-status' THEN
   IF v_status IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   UPDATE public.platform_assignment SET status=CASE v_status WHEN 'disabled' THEN 'suspended' ELSE 'active' END,version=version+1,
    revoked_at=CASE WHEN v_status='disabled' THEN v_now END,revoked_by=CASE WHEN v_status='disabled' THEN p_actor::text END,
    revoke_reason=CASE WHEN v_status='disabled' THEN 'platform employee disabled' END WHERE user_id=p_id;
   PERFORM public.append_platform_system_audit(p_actor,'employee','status_changed',p_id,p_request);
  ELSIF p_operation='set-roles' THEN
   IF jsonb_typeof(p_input->'roleIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   IF v_row.status<>'active' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   SELECT COALESCE(array_agg(DISTINCT x::uuid),'{}'::uuid[]) INTO v_roles FROM jsonb_array_elements_text(p_input->'roleIds') x;
   PERFORM public.validate_platform_employee_links(NULL,'{}',v_roles);
   DELETE FROM public.platform_assignment_role WHERE user_id=p_id;
   INSERT INTO public.platform_assignment_role(user_id,role_id) SELECT p_id,x FROM unnest(v_roles) x;
   UPDATE public.platform_assignment SET version=version+1 WHERE user_id=p_id;
   PERFORM public.append_platform_system_audit(p_actor,'employee','roles_changed',p_id,p_request);
  ELSE RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  RETURN public.platform_system_employee_projection(p_id);
 END IF;
 IF p_operation='create' THEN
  IF p_input->>'key' IS NULL OR p_input->>'key' !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$' OR length(btrim(p_input->>'name')) NOT BETWEEN 1 AND 200 OR v_status IS NULL OR COALESCE((p_input->>'sort')::integer,-1)<0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  v_id:=gen_random_uuid();
  INSERT INTO public.platform_role(id,key,name,status,built_in,permissions,version,created_at,updated_at)
   VALUES(v_id,p_input->>'key',btrim(p_input->>'name'),CASE v_status WHEN 'disabled' THEN 'suspended' ELSE 'active' END,false,'{}',1,v_now,v_now);
  INSERT INTO public.platform_role_profile(role_id,sort) VALUES(v_id,(p_input->>'sort')::integer);
  PERFORM public.append_platform_system_audit(p_actor,'role','created',v_id,p_request);
 ELSE
  SELECT * INTO v_role FROM public.platform_role WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_role.built_in AND v_role.key='platform_admin' AND p_operation IN ('update','delete','set-status','set-permissions') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_operation='update' THEN
   IF p_input->>'key' IS NULL OR p_input->>'key' !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$' OR length(btrim(p_input->>'name')) NOT BETWEEN 1 AND 200 OR v_status IS NULL OR COALESCE((p_input->>'sort')::integer,-1)<0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   IF v_role.built_in AND p_input->>'key'<>v_role.key THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
   -- 角色元信息和启停允许普通role:update，权限内容始终由独立超级管理员动作修改。
   UPDATE public.platform_role SET key=p_input->>'key',name=btrim(p_input->>'name'),status=CASE v_status WHEN 'disabled' THEN 'suspended' ELSE 'active' END,version=version+1,updated_at=v_now WHERE id=p_id;
   INSERT INTO public.platform_role_profile(role_id,sort) VALUES(p_id,(p_input->>'sort')::integer) ON CONFLICT(role_id) DO UPDATE SET sort=EXCLUDED.sort;
   PERFORM public.append_platform_system_audit(p_actor,'role','updated',p_id,p_request);
  ELSIF p_operation='set-status' THEN
   IF v_status IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   UPDATE public.platform_role SET status=CASE v_status WHEN 'disabled' THEN 'suspended' ELSE 'active' END,version=version+1,updated_at=v_now WHERE id=p_id;
   PERFORM public.append_platform_system_audit(p_actor,'role','status_changed',p_id,p_request);
  ELSIF p_operation='delete' THEN
   IF EXISTS(SELECT 1 FROM public.platform_assignment_role WHERE role_id=p_id) THEN RAISE EXCEPTION 'RESOURCE_IN_USE'; END IF;
   DELETE FROM public.platform_role WHERE id=p_id;
   PERFORM public.append_platform_system_audit(p_actor,'role','deleted',p_id,p_request);
   RETURN jsonb_build_object('id',p_id,'deleted',true);
  ELSIF p_operation='set-permissions' THEN
   IF jsonb_typeof(p_input->'permissions') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'permissions')>500 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   FOR v_permission IN SELECT jsonb_array_elements_text(p_input->'permissions') LOOP
    IF v_permission='platform.authorization:manage' OR NOT v_permission=ANY(array_remove(public.platform_permission_catalog(),'platform.authorization:manage')) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   END LOOP;
   UPDATE public.platform_role SET permissions=ARRAY(SELECT DISTINCT jsonb_array_elements_text(p_input->'permissions')),version=version+1,updated_at=v_now WHERE id=p_id;
   PERFORM public.append_platform_system_audit(p_actor,'role','permissions_changed',p_id,p_request);
  ELSIF p_operation IN ('assign-employees','revoke-employees') THEN
   SELECT array_agg(DISTINCT x::uuid) INTO v_ids FROM jsonb_array_elements_text(p_input->'userIds') x;
   IF cardinality(v_ids) IS NULL OR cardinality(v_ids)<1 OR cardinality(v_ids)>100 OR array_position(v_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   IF EXISTS(SELECT 1 FROM unnest(v_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.platform_assignment WHERE user_id=x AND status='active')) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   IF p_operation='assign-employees' THEN
    IF v_role.status<>'active' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
    INSERT INTO public.platform_assignment_role(user_id,role_id) SELECT x,p_id FROM unnest(v_ids) x ON CONFLICT DO NOTHING;
   ELSE DELETE FROM public.platform_assignment_role WHERE role_id=p_id AND user_id=ANY(v_ids); END IF;
   UPDATE public.platform_assignment SET version=version+1 WHERE user_id=ANY(v_ids);
   FOREACH v_id IN ARRAY v_ids LOOP PERFORM public.append_platform_system_audit(p_actor,'employee','roles_changed',v_id,p_request); END LOOP;
   PERFORM public.append_platform_system_audit(p_actor,'role',CASE p_operation WHEN 'assign-employees' THEN 'employees_assigned' ELSE 'employees_revoked' END,p_id,p_request);
   RETURN jsonb_build_object('roleId',p_id,'userIds',to_jsonb(v_ids),'assigned',p_operation='assign-employees');
  ELSE RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 END IF;
 RETURN public.platform_system_role_projection(v_id);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'KEY_ALREADY_EXISTS';
 WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation THEN RAISE EXCEPTION 'VALIDATION_ERROR';
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_task_action(p_kind text, p_resource text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_resource text;
BEGIN
  IF p_kind='employee-import' AND p_resource='employees' THEN RETURN 'platform.authorization:manage'; END IF;
  IF p_kind IS DISTINCT FROM 'export' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  v_resource:=CASE p_resource
    WHEN 'employees' THEN 'employee' WHEN 'roles' THEN 'role'
    WHEN 'departments' THEN 'department' WHEN 'posts' THEN 'post' WHEN 'dictionaries' THEN 'dictionary'
    WHEN 'dictionary-items' THEN 'dictionary' WHEN 'parameters' THEN 'parameter' WHEN 'users' THEN 'user'
    WHEN 'organizations' THEN 'organization' WHEN 'login-events' THEN 'login' WHEN 'sessions' THEN 'session'
    WHEN 'audit-events' THEN 'audit' END;
  IF v_resource IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  RETURN 'platform.'||v_resource||':export';
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.platform_permission_catalog()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$ SELECT ARRAY['platform.authorization:manage','platform.organization:read','platform.organization:update','platform.organization:export','platform.user:read','platform.user:create','platform.user:update','platform.user:suspend','platform.user:resetPassword','platform.user:readSensitive','platform.user:unlock','platform.user:export','platform.audit:read','platform.audit:export','platform.settings:read','platform.settings:update','platform.login:read','platform.login:export','platform.session:read','platform.session:revoke','platform.session:export','platform.employee:read','platform.employee:create','platform.employee:update','platform.employee:delete','platform.employee:export','platform.role:read','platform.role:create','platform.role:update','platform.role:delete','platform.role:export','platform.department:read','platform.department:create','platform.department:update','platform.department:delete','platform.department:export','platform.post:read','platform.post:create','platform.post:update','platform.post:delete','platform.post:export','platform.dictionary:read','platform.dictionary:create','platform.dictionary:update','platform.dictionary:delete','platform.dictionary:export','platform.dictionary:refresh','platform.parameter:read','platform.parameter:create','platform.parameter:update','platform.parameter:delete','platform.parameter:export','platform.parameter:refresh','platform.announcement:read','platform.announcement:create','platform.announcement:update','platform.announcement:delete','platform.announcement:publish','platform.announcement:readers','platform.task:read','platform.task:download','platform.monitor:read','platform.schedule:read','platform.schedule:manage','platform.schedule:run','platform.file:read','platform.file:create','platform.file:update','platform.file:delete','platform.file:restore','platform.file:purge','platform.folder:read','platform.folder:create','platform.folder:update','platform.folder:delete']::text[]; $function$;
--> statement-breakpoint
SET LOCAL ROLE platform_executor;
SELECT public.lock_platform_authorization();
RESET ROLE;
-- 迁移持有角色表写锁，移除退役动作时暂时停用内置角色不可修改触发器；随后恢复原约束。
ALTER TABLE public.platform_role DISABLE TRIGGER platform_role_guard;
SET LOCAL ROLE platform_executor;
UPDATE public.platform_role SET permissions = ARRAY(
  SELECT permission FROM unnest(permissions) AS permission
  WHERE permission NOT LIKE 'platform.menu:%'
), version = version + 1, updated_at = clock_timestamp()
WHERE permissions && ARRAY['platform.menu:read','platform.menu:create','platform.menu:update','platform.menu:delete','platform.menu:export']::text[];
RESET ROLE;
ALTER TABLE public.platform_role ENABLE TRIGGER platform_role_guard;
--> statement-breakpoint
DROP FUNCTION public.platform_system_navigation_children(uuid, text[]);
DROP FUNCTION public.platform_menu_registry();
DROP FUNCTION public.platform_menu_route_permission(text);
DROP FUNCTION public.platform_menu_actions();
