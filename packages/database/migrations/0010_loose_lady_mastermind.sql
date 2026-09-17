CREATE TABLE "organization_status" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"status_version" integer NOT NULL,
	"authorization_version" integer NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	"status_changed_by" uuid,
	"internal_reason" text,
	CONSTRAINT "organization_status_status_check" CHECK ("organization_status"."status" IN ('ACTIVE', 'SUSPENDED')),
	CONSTRAINT "organization_status_status_version_check" CHECK ("organization_status"."status_version" >= 1),
	CONSTRAINT "organization_status_authorization_version_check" CHECK ("organization_status"."authorization_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "organization_status" ADD CONSTRAINT "organization_status_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- 迁移前先按既有 enabled 回填，避免缺行被当成默认 ACTIVE。
INSERT INTO public.organization_status (
	organization_id,
	status,
	status_version,
	authorization_version,
	status_changed_at
)
SELECT
	id,
	CASE WHEN enabled THEN 'ACTIVE' ELSE 'SUSPENDED' END,
	1,
	1,
	now()
FROM public.organization;
--> statement-breakpoint
CREATE FUNCTION public.initialize_organization_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
	INSERT INTO public.organization_status (
		organization_id,
		status,
		status_version,
		authorization_version,
		status_changed_at
	) VALUES (
		NEW.id,
		'ACTIVE',
		1,
		1,
		pg_catalog.now()
	);
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organization_status_insert
AFTER INSERT ON public.organization
FOR EACH ROW
EXECUTE FUNCTION public.initialize_organization_status();
--> statement-breakpoint
-- FOR UPDATE 需要 UPDATE 权限；不把状态写权限交给 app_runtime，由定义者身份加锁并复核。
CREATE FUNCTION public.require_active_organization(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
	v_status text;
BEGIN
	SELECT status INTO v_status
	FROM public.organization_status
	WHERE organization_id = p_organization_id
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'organization status missing'
			USING ERRCODE = 'ORS01';
	END IF;
	IF v_status <> 'ACTIVE' THEN
		RAISE EXCEPTION 'organization suspended'
			USING ERRCODE = 'ORS02';
	END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.initialize_organization_status() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.require_active_organization(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.require_active_organization(uuid) TO app_runtime;
--> statement-breakpoint
GRANT SELECT (
	organization_id,
	status,
	status_version,
	authorization_version,
	status_changed_at
) ON public.organization_status TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (authorization_version) ON public.organization_status TO app_runtime;
--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "enabled";
