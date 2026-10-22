-- 0107 与本检查在同一迁移事务中提交。旧归属的完成事实不能被解释为新归属已落地。
-- 允许 0092 直升产生的全新迁入计划；旧服务已经开始迁入时，须先把全部计划恢复完成。
DO $migration$
BEGIN
 IF EXISTS (
  SELECT 1 FROM public.platform_file_operations
  WHERE phase NOT IN ('completed','failed')
   AND coalesce((plans->0->>'import')::boolean,false)
   AND request_id <> 'platform-library-namespace'
 ) AND (
  EXISTS (
   SELECT 1 FROM public.platform_file_operations
   WHERE phase NOT IN ('completed','failed')
    AND coalesce((plans->0->>'import')::boolean,false)
    AND request_id <> 'platform-library-namespace'
    AND lease_expires_at > clock_timestamp()
  ) OR
  EXISTS (
   SELECT 1 FROM public.platform_file_operations o, jsonb_array_elements(o.objects) item
   WHERE o.phase NOT IN ('completed','failed')
    AND coalesce((o.plans->0->>'import')::boolean,false)
    AND o.request_id <> 'platform-library-namespace'
    AND (coalesce((item->>'targetPrepared')::boolean,false)
      OR coalesce((item->>'sourceDeleted')::boolean,false))
  ) OR EXISTS (
   SELECT 1 FROM public.platform_file_operations
   WHERE phase='completed' AND coalesce((plans->0->>'import')::boolean,false)
    AND request_id <> 'platform-library-namespace'
  )
 ) THEN
  RAISE EXCEPTION 'PLATFORM_FILE_IMPORTS_MUST_SETTLE';
 END IF;
END;
$migration$;
