-- Custom SQL migration file, put your code below! --
-- 每张新租户表都受同一可信事务组织范围约束；后台投递另由固定入口建立范围。
DO $migration$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'business_tasks', 'business_notifications', 'notification_preferences',
    'webhook_endpoints', 'domain_events', 'webhook_deliveries'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_scope ON public.%I FOR ALL TO app_runtime USING (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid)', table_name);
  END LOOP;
END
$migration$;

GRANT SELECT, INSERT, UPDATE ON public.business_tasks TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON public.business_notifications TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_endpoints TO app_runtime;
GRANT SELECT, INSERT ON public.domain_events TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON public.webhook_deliveries TO app_runtime;
