CREATE TABLE "file_operation_batch_items" (
	"organization_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"entry_id" uuid NOT NULL,
	"expected_revision" integer NOT NULL,
	"operation_id" uuid NOT NULL,
	"root_index" integer NOT NULL,
	"entry_kind" text,
	CONSTRAINT "file_operation_batch_items_organization_id_batch_id_index_pk" PRIMARY KEY("organization_id","batch_id","index"),
	CONSTRAINT "file_operation_batch_items_entry_unique" UNIQUE("organization_id","batch_id","entry_id"),
	CONSTRAINT "file_operation_batch_items_operation_unique" UNIQUE("organization_id","batch_id","operation_id"),
	CONSTRAINT "file_operation_batch_items_index_check" CHECK ("file_operation_batch_items"."index" BETWEEN 0 AND 99 AND "file_operation_batch_items"."root_index" BETWEEN 0 AND 99),
	CONSTRAINT "file_operation_batch_items_revision_check" CHECK ("file_operation_batch_items"."expected_revision" >= 1),
	CONSTRAINT "file_operation_batch_items_kind_check" CHECK ("file_operation_batch_items"."entry_kind" IS NULL OR "file_operation_batch_items"."entry_kind" IN ('file','folder'))
);
--> statement-breakpoint
CREATE TABLE "file_operation_batches" (
	"id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"request_hash" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_operation_batches_organization_id_id_pk" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "file_operation_batches_action_check" CHECK ("file_operation_batches"."action" IN ('move','trash','restore','purge')),
	CONSTRAINT "file_operation_batches_target_check" CHECK (("file_operation_batches"."action" = 'move' AND "file_operation_batches"."parent_id" IS NOT NULL) OR "file_operation_batches"."action" = 'restore' OR ("file_operation_batches"."action" IN ('trash','purge') AND "file_operation_batches"."parent_id" IS NULL)),
	CONSTRAINT "file_operation_batches_hash_check" CHECK ("file_operation_batches"."request_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "file_operation_batch_items" ADD CONSTRAINT "file_operation_batch_items_batch_fk" FOREIGN KEY ("organization_id","batch_id") REFERENCES "public"."file_operation_batches"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_operation_batch_items" ADD CONSTRAINT "file_operation_batch_items_root_fk" FOREIGN KEY ("organization_id","batch_id","root_index") REFERENCES "public"."file_operation_batch_items"("organization_id","batch_id","index") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_operation_batches" ADD CONSTRAINT "file_operation_batches_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_operation_batch_items_root_idx" ON "file_operation_batch_items" USING btree ("organization_id","batch_id","root_index");
--> statement-breakpoint
ALTER TABLE public.file_operation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_operation_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY file_operation_batches_tenant ON public.file_operation_batches TO app_runtime
USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
ALTER TABLE public.file_operation_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_operation_batch_items FORCE ROW LEVEL SECURITY;
CREATE POLICY file_operation_batch_items_tenant ON public.file_operation_batch_items TO app_runtime
USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);
GRANT SELECT, INSERT ON public.file_operation_batches, public.file_operation_batch_items TO app_runtime;
--> statement-breakpoint
-- 计划在一个事务中写入完整选择；延迟约束允许祖先在输入中排在后代之后，但不允许 root 环或缺项。
CREATE FUNCTION public.check_file_batch_plan() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE v_batch uuid; v_count integer; v_min integer; v_max integer;
BEGIN
  IF TG_TABLE_NAME = 'file_operation_batches' THEN v_batch := NEW.id; ELSE v_batch := NEW.batch_id; END IF;
  SELECT count(*),min(index),max(index) INTO v_count,v_min,v_max FROM public.file_operation_batch_items
    WHERE organization_id=NEW.organization_id AND batch_id=v_batch;
  IF v_count NOT BETWEEN 1 AND 100 OR v_min <> 0 OR v_max <> v_count-1 OR EXISTS (
    SELECT 1 FROM public.file_operation_batch_items i
      JOIN public.file_operation_batch_items r ON r.organization_id=i.organization_id AND r.batch_id=i.batch_id AND r.index=i.root_index
      WHERE i.organization_id=NEW.organization_id AND i.batch_id=v_batch AND
        (r.root_index <> r.index OR (i.index <> i.root_index AND (r.entry_kind IS DISTINCT FROM 'folder' OR i.entry_kind IS NULL))))
    THEN RAISE EXCEPTION 'invalid file batch selection' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.check_file_batch_plan() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_file_batch_plan() TO app_runtime;
CREATE CONSTRAINT TRIGGER file_operation_batches_plan_check AFTER INSERT ON public.file_operation_batches
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_file_batch_plan();
CREATE CONSTRAINT TRIGGER file_operation_batch_items_plan_check AFTER INSERT ON public.file_operation_batch_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_file_batch_plan();
