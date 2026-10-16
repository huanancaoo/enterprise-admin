-- 固定审计函数显式记录事实发生时刻；runtime 仍只能经函数写入，原 RLS 继续限定事件目录。
GRANT INSERT (occurred_at) ON public.audit_events TO platform_executor;
