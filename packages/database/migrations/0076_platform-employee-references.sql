-- 关联名称属于员工资料读投影；不能要求员工读取者另有完整目录管理权限。
-- 已选关联即使停用也保留名称，候选状态由下面的受限选项接口独立筛选。
CREATE OR REPLACE FUNCTION public.platform_system_employee_projection(p_user uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $f$
 SELECT jsonb_build_object('userId',a.user_id,'name',u.name,
   'maskedEmail',left(split_part(u.email,'@',1),1)||'***@'||split_part(u.email,'@',2),
   'status',CASE a.status WHEN 'active' THEN 'active' ELSE 'disabled' END,
   'departmentId',p.department_id,
   'department',(SELECT jsonb_build_object('id',d.id,'name',d.name) FROM public.platform_department d WHERE d.id=p.department_id),
   'posts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) ORDER BY t.id)
     FROM public.platform_employee_post x JOIN public.platform_post t ON t.id=x.post_id WHERE x.user_id=a.user_id),'[]'::jsonb),
   'roles',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'key',r.key,'name',r.name,'builtIn',r.built_in) ORDER BY r.id)
     FROM public.platform_assignment_role x JOIN public.platform_role r ON r.id=x.role_id WHERE x.user_id=a.user_id),'[]'::jsonb),
   'postIds',COALESCE((SELECT jsonb_agg(x.post_id ORDER BY x.post_id) FROM public.platform_employee_post x WHERE x.user_id=a.user_id),'[]'::jsonb),
   'roleIds',COALESCE((SELECT jsonb_agg(x.role_id ORDER BY x.role_id) FROM public.platform_assignment_role x WHERE x.user_id=a.user_id),'[]'::jsonb),
   'version',a.version+s.version-1,'createdAt',a.granted_at,
   'lockedUntil',CASE WHEN l.locked_until>statement_timestamp() THEN l.locked_until END,
   'failedAttempts',(SELECT count(*) FROM unnest(l.failure_times) t WHERE t>statement_timestamp()-interval '15 minutes'))
 FROM public.platform_assignment a JOIN public."user" u ON u.id=a.user_id
 JOIN public.user_account_status s ON s.user_id=a.user_id
 LEFT JOIN public.platform_employee_profile p ON p.user_id=a.user_id
 LEFT JOIN public.password_login_lock l ON l.user_id=a.user_id
 WHERE a.user_id=p_user AND a.status<>'revoked';
$f$;
--> statement-breakpoint
CREATE FUNCTION public.list_platform_employee_options(p_actor uuid,p_session uuid,p_kind text,p_input jsonb,p_request text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $f$
DECLARE
 v_permissions text[]; v_table text; v_extra text; v_result jsonb;
 v_q text:=NULLIF(btrim(p_input->>'q'),''); v_status text:=p_input->>'status'; v_ids uuid[];
 v_page integer:=COALESCE((p_input->>'page')::integer,1); v_size integer:=COALESCE((p_input->>'pageSize')::integer,20);
BEGIN
 SELECT permissions INTO v_permissions FROM public.read_platform_access(p_actor,p_session);
 IF NOT FOUND OR NOT('platform.employee:read'=ANY(v_permissions)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 -- 列表筛选和员工编辑共享这份受限读契约，不暴露目录配置、角色权限或扩大目录读取授权。
 IF p_kind IS NULL OR p_kind NOT IN ('department','post','role') OR p_input IS NULL OR jsonb_typeof(p_input)<>'object'
 OR p_input-ARRAY['q','status','ids','page','pageSize']<>'{}'::jsonb OR length(v_q)>200
 OR (v_status IS NOT NULL AND v_status NOT IN ('active','disabled')) OR v_page<1 OR v_size NOT BETWEEN 1 AND 100
 OR p_request IS NULL OR length(btrim(p_request))=0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 IF p_input ? 'ids' THEN
  IF jsonb_typeof(p_input->'ids') IS DISTINCT FROM 'string' OR length(p_input->>'ids')=0 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  v_ids:=string_to_array(p_input->>'ids',',')::uuid[];
  IF cardinality(v_ids)>100 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 END IF;
 v_table:='platform_'||p_kind;
 v_extra:=CASE p_kind WHEN 'department' THEN
  '||jsonb_build_object(''parentId'',t.parent_id,''hasChildren'',EXISTS(SELECT 1 FROM public.platform_department c WHERE c.parent_id=t.id))'
  ELSE '' END;
 EXECUTE format($q$
  WITH filtered AS MATERIALIZED (
   SELECT t.* FROM public.%1$I t WHERE ($1::text IS NULL OR strpos(lower(t.name),lower($1))>0 OR strpos(lower(t.key),lower($1))>0)
   AND ($2::text IS NULL OR CASE t.status WHEN 'suspended' THEN 'disabled' ELSE t.status END=$2)
   AND ($3::uuid[] IS NULL OR t.id=ANY($3))
  ), selected AS (
   SELECT t.id,t.name,jsonb_build_object('id',t.id,'key',t.key,'name',t.name,
    'status',CASE t.status WHEN 'suspended' THEN 'disabled' ELSE t.status END)%2$s AS item
   FROM filtered t ORDER BY t.name,t.id LIMIT $5 OFFSET $6
  )
  SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(item ORDER BY name,id) FROM selected),'[]'::jsonb),
   'page',$4,'pageSize',$5,'total',(SELECT count(*) FROM filtered))
 $q$,v_table,v_extra) INTO v_result USING v_q,v_status,v_ids,v_page,v_size,(v_page::bigint-1)*v_size;
 RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'VALIDATION_ERROR';
END;
$f$;
--> statement-breakpoint
GRANT CREATE ON SCHEMA public TO platform_executor;
ALTER FUNCTION public.list_platform_employee_options(uuid,uuid,text,jsonb,text) OWNER TO platform_executor;
REVOKE ALL ON FUNCTION public.list_platform_employee_options(uuid,uuid,text,jsonb,text) FROM PUBLIC,app_runtime,platform_runtime,platform_deployer;
GRANT EXECUTE ON FUNCTION public.list_platform_employee_options(uuid,uuid,text,jsonb,text) TO app_runtime;
REVOKE CREATE ON SCHEMA public FROM platform_executor;
