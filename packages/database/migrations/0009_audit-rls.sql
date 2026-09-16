ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_events_tenant ON audit_events TO app_runtime
USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
-- 历史事实只追加；runtime 不得修改或删除审计。
GRANT SELECT, INSERT ON audit_events TO app_runtime;
