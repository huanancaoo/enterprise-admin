-- 认证元数据在建立可信上下文之前读取；RLS 仅施加于租户业务表。
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE project_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_translations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY projects_tenant ON projects TO app_runtime
USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY project_translations_tenant ON project_translations TO app_runtime
USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON projects, project_translations TO app_runtime;
