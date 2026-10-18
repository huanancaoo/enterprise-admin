-- 可选筛选与时间窗口会改变匹配行数；泛型计划会把大窗口误估为极少行，
-- 导致分页扫描整个匹配集再排序。仅在此函数内按实际参数规划，保留原查询与授权链。
ALTER FUNCTION public.read_platform_audit_events_for_action(uuid,uuid,timestamptz,timestamptz,uuid,uuid,text,text,integer,integer,text,text)
SET plan_cache_mode = force_custom_plan;
