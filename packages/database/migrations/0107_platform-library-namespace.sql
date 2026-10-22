-- 文件库允许自由命名，任务资源使用 UUID 命名；两者必须使用不同物理归属。
-- 已发起的普通操作必须先由旧服务恢复完成，才能切换其命名空间。
DO $migration$
DECLARE v_source jsonb := '{"kind":"platform","id":"00000000-0000-4000-8000-000000000001"}';
 v_objects jsonb := '[]'; v_object jsonb; v_operation uuid := gen_random_uuid(); v_actor uuid;
 v_area text; v_path text[]; r record; v_depth integer;
BEGIN
 IF EXISTS(SELECT 1 FROM public.platform_file_operations WHERE phase NOT IN('completed','failed') AND NOT coalesce((plans->0->>'import')::boolean,false)) THEN
  RAISE EXCEPTION 'PLATFORM_FILE_OPERATIONS_MUST_SETTLE';
 END IF;
 -- 0092 直接升级时，公告迁入尚未执行；源仍是旧资源归属。
 UPDATE public.platform_file_operations SET objects=(SELECT coalesce(jsonb_agg(o||jsonb_build_object('sourceOwner',v_source) ORDER BY ord),'[]')
  FROM jsonb_array_elements(objects) WITH ORDINALITY a(o,ord))
 WHERE phase NOT IN('completed','failed') AND coalesce((plans->0->>'import')::boolean,false);
 -- 服务完成所有公告迁入才接受文件库写入；尚未迁入时不存在已落地的文件库对象。
 IF FOUND THEN RETURN; END IF;

 FOR r IN SELECT e.*,root.path root_path FROM public.platform_file_entries e
  LEFT JOIN public.platform_file_entries root ON root.id=e.trash_root_id
  WHERE e.kind='folder' AND e.parent_id IS NOT NULL AND e.state IN('active','trashed') LOOP
  v_area:=CASE WHEN r.state='trashed' THEN 'trash' ELSE 'files' END;
  v_path:=CASE WHEN r.state='trashed' THEN ARRAY[r.trash_root_id::text]||r.path[cardinality(r.root_path)+1:cardinality(r.path)] ELSE r.path END;
  v_objects:=v_objects||jsonb_build_array(public.platform_file_object(true,v_area,v_path,v_area,v_path,0,NULL)||jsonb_build_object('sourceOwner',v_source));
 END LOOP;
 FOR r IN SELECT v.*,e.created_by FROM public.platform_file_versions v JOIN public.platform_file_entries e ON e.id=v.file_id
  WHERE v.state='available' AND NOT EXISTS(SELECT 1 FROM public.platform_file_operations o WHERE o.entry_id=e.id AND o.phase NOT IN('completed','failed') AND coalesce((o.plans->0->>'import')::boolean,false)) LOOP
  v_actor:=coalesce(v_actor,r.created_by);
  v_objects:=v_objects||jsonb_build_array(public.platform_file_object(false,r.storage_area,r.storage_path,r.storage_area,r.storage_path,r.bytes,r.sha256)||jsonb_build_object('sourceOwner',v_source));
 END LOOP;
 -- 包含空目录以及历史/回收站中的父目录，按深度先创建后迁入文件。
 FOR r IN SELECT o->>'targetArea' area,ARRAY(SELECT jsonb_array_elements_text(o->'targetPath')) path FROM jsonb_array_elements(v_objects) o LOOP
  FOR v_depth IN 1..cardinality(r.path)-1 LOOP
   v_path:=r.path[1:v_depth];
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_objects) o WHERE (o->>'directory')::boolean AND o->>'targetArea'=r.area AND o->'targetPath'=to_jsonb(v_path)) THEN
    v_objects:=v_objects||jsonb_build_array(public.platform_file_object(true,r.area,v_path,r.area,v_path,0,NULL)||jsonb_build_object('sourceOwner',v_source));
   END IF;
  END LOOP;
 END LOOP;
 IF jsonb_array_length(v_objects)>0 THEN
  SELECT jsonb_agg(o ORDER BY (o->>'directory')::boolean DESC,jsonb_array_length(o->'targetPath'),o->>'id') INTO v_objects FROM jsonb_array_elements(v_objects) o;
  SELECT coalesce(v_actor,created_by) INTO v_actor FROM public.platform_file_entries WHERE created_by IS NOT NULL LIMIT 1;
  INSERT INTO public.platform_file_operations(id,actor_id,action,request_id,input,phase,entry_id,objects,plans,committed_at,result,lease_id,lease_expires_at)
  VALUES(v_operation,v_actor,'move','platform-library-namespace','{}','committed','00000000-0000-4000-8000-000000000002',v_objects,'[{"import":true}]',clock_timestamp(),jsonb_build_object('entryId','00000000-0000-4000-8000-000000000002','revision',1),gen_random_uuid(),clock_timestamp()-interval '1 second');
  UPDATE public.platform_file_entries SET busy_operation_id=v_operation WHERE busy_operation_id IS NULL AND state IN('active','trashed');
 END IF;
END;
$migration$;
