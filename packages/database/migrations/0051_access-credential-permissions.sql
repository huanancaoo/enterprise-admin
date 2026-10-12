-- Key 哈希与过期/启停属于身份域，验证发生在建立组织上下文之前。
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apikey TO app_runtime;
--> statement-breakpoint
ALTER TABLE public.access_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY access_credentials_tenant ON public.access_credentials TO app_runtime
USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON public.access_credentials TO app_runtime;
