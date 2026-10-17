import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers"
import { Pool } from "pg"

// 只隔离平台资源固定函数的数据库边界；身份权限引擎由自己的测试覆盖。
// fixture 保留可撤销的权威身份与动作集合，用于真实验证资源函数每次重验。
describe("平台资源固定函数权限与原子性", { concurrent: false }, () => {
  let container: StartedTestContainer | undefined
  let owner: Pool
  let runtime: Pool
  const actor = randomUUID()
  const session = randomUUID()
  const other = randomUUID()
  const otherSession = randomUUID()
  const resource = randomUUID()
  const hash = "a".repeat(64)

  const create = (
    id: string,
    purpose: string,
    request: string = randomUUID()
  ) =>
    runtime.query(
      "SELECT public.create_platform_resource($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result",
      [
        actor,
        session,
        id,
        purpose,
        "employees.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        100,
        hash,
        request,
      ]
    )
  const read = (
    user = actor,
    activeSession = session,
    request: string = randomUUID()
  ) =>
    runtime.query(
      "SELECT public.get_platform_resource($1,$2,$3,$4) AS result",
      [user, activeSession, resource, request]
    )

  beforeAll(async () => {
    const versions = JSON.parse(
      await readFile("../../docs/architecture/versions.json", "utf8")
    )
    const password = randomBytes(24).toString("hex")
    container = await new GenericContainer(
      versions.releaseFoundation.postgresql.image
    )
      .withEnvironment({
        POSTGRES_USER: "bootstrap_admin",
        POSTGRES_DB: "resources_test",
        POSTGRES_PASSWORD: password,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forLogMessage("database system is ready to accept connections", 2)
      )
      .start()
    const connection = {
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: "resources_test",
      password,
    }
    owner = new Pool({ ...connection, user: "bootstrap_admin" })
    await owner.query(`
      CREATE ROLE app_runtime LOGIN PASSWORD '${password}';
      CREATE ROLE platform_executor NOLOGIN;
      CREATE ROLE platform_runtime NOLOGIN;
      CREATE ROLE platform_deployer NOLOGIN;
      CREATE TABLE public.resource_test_access(user_id uuid PRIMARY KEY,session_id uuid NOT NULL,active boolean NOT NULL,actions text[] NOT NULL);
      CREATE FUNCTION public.read_platform_access(p_actor uuid,p_session uuid) RETURNS TABLE(user_id uuid,permissions text[])
      LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $f$
        SELECT a.user_id,a.actions FROM public.resource_test_access a WHERE a.user_id=p_actor AND a.session_id=p_session AND a.active;
      $f$;
      CREATE FUNCTION public.require_platform_action(p_actor uuid,p_session uuid,p_action text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $f$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM public.resource_test_access a WHERE a.user_id=p_actor AND a.session_id=p_session AND a.active AND p_action=ANY(a.actions)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
      END;
      $f$;
      CREATE TABLE public.audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),scope text NOT NULL,event_code text NOT NULL,
        actor_id uuid,resource_type text,resource_id uuid,result text NOT NULL,request_id text NOT NULL,
        organization_id uuid,tenant_visible boolean NOT NULL DEFAULT false,fields jsonb NOT NULL,
        CONSTRAINT test_audit_available CHECK(request_id <> 'fail-audit'));
      ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY;
      GRANT INSERT ON public.audit_events TO platform_executor;
    `)
    const migration = await readFile(
      "migrations/0073_platform-tasks-resources.sql",
      "utf8"
    )
    const resourceSql = migration.match(
      /-- platform-resources:start\n([\s\S]*?)-- platform-resources:end/
    )
    if (!resourceSql) throw new Error("正式迁移缺少平台资源 SQL 边界标记")
    await owner.query(resourceSql[1])
    await owner.query(
      "INSERT INTO public.resource_test_access VALUES($1,$2,true,ARRAY['platform.authorization:manage','platform.task:read','platform.announcement:create']),($3,$4,true,ARRAY['platform.task:read'])",
      [actor, session, other, otherSession]
    )
    runtime = new Pool({ ...connection, user: "app_runtime" })
  })

  afterAll(async () => {
    await runtime?.end()
    await owner?.end()
    await container?.stop()
  })

  test("runtime 只有固定函数调用权限；平台表强制 RLS 且 executor 不能直接更新或删除", async () => {
    for (const action of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const result = await owner.query(
        "SELECT has_table_privilege('app_runtime','public.platform_resources',$1) AS allowed",
        [action]
      )
      expect(result.rows[0].allowed).toBe(false)
    }
    await expect(
      runtime.query("SELECT * FROM public.platform_resources")
    ).rejects.toMatchObject({ code: "42501" })
    const flags = await owner.query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.platform_resources'::regclass"
    )
    expect(flags.rows[0]).toEqual({
      relrowsecurity: true,
      relforcerowsecurity: true,
    })
    const helpers = await owner.query(
      "SELECT has_function_privilege('app_runtime','public.require_platform_resource_write(uuid,uuid,text)','EXECUTE') AS helper,has_table_privilege('platform_executor','public.platform_resources','UPDATE') AS can_update,has_table_privilege('platform_executor','public.platform_resources','DELETE') AS can_delete"
    )
    expect(helpers.rows[0]).toEqual({
      helper: false,
      can_update: false,
      can_delete: false,
    })
  })

  test("创建资源和私有成功审计原子提交，投影不包含组织标识或存储定位", async () => {
    const response = await create(resource, "task-output")
    expect(response.rows[0].result).toMatchObject({
      id: resource,
      purpose: "task-output",
      uploadedBy: actor,
      name: "employees.xlsx",
      bytes: 100,
      sha256: hash,
    })
    expect(Object.keys(response.rows[0].result).sort()).toEqual(
      [
        "id",
        "purpose",
        "uploadedBy",
        "name",
        "mimeType",
        "bytes",
        "sha256",
        "createdAt",
      ].sort()
    )
    const audit = await owner.query(
      "SELECT scope,resource_type,organization_id,tenant_visible,fields FROM public.audit_events WHERE resource_id=$1 AND event_code='platform.resource_created'",
      [resource]
    )
    expect(audit.rows).toEqual([
      {
        scope: "platform",
        resource_type: "platform_resource",
        organization_id: null,
        tenant_visible: false,
        fields: { purpose: "task-output", bytes: 100 },
      },
    ])
  })

  test("有 task:read 但不是上传者仍不能读任务资源，内部领域入口只返回元数据", async () => {
    await expect(read(other, otherSession)).rejects.toThrow("FORBIDDEN")
    const allowed = await read()
    expect(allowed.rows[0].result.id).toBe(resource)
    const internal = await runtime.query(
      "SELECT public.get_platform_resource_internal($1) AS result",
      [resource]
    )
    expect(internal.rows[0].result).toEqual(allowed.rows[0].result)
  })

  test("上传准备和提交都校验当前权限；任务输入仅管理授权动作允许", async () => {
    await expect(
      runtime.query(
        "SELECT public.prepare_platform_resource($1,$2,'task-input')",
        [other, otherSession]
      )
    ).rejects.toThrow("FORBIDDEN")
    await runtime.query(
      "SELECT public.prepare_platform_resource($1,$2,'task-input')",
      [actor, session]
    )
    await owner.query(
      "UPDATE public.resource_test_access SET actions=ARRAY['platform.task:read'] WHERE user_id=$1",
      [actor]
    )
    await expect(create(randomUUID(), "task-input")).rejects.toThrow(
      "FORBIDDEN"
    )
    await owner.query(
      "UPDATE public.resource_test_access SET actions=ARRAY['platform.authorization:manage','platform.task:read','platform.announcement:create'] WHERE user_id=$1",
      [actor]
    )
  })

  test("身份撤销后即使资源属于本人也不能读取", async () => {
    await owner.query(
      "UPDATE public.resource_test_access SET active=false WHERE user_id=$1",
      [actor]
    )
    await expect(read()).rejects.toThrow("FORBIDDEN")
    await owner.query(
      "UPDATE public.resource_test_access SET active=true WHERE user_id=$1",
      [actor]
    )
  })

  test("审计失败使创建回滚，读取也不返回受限投影", async () => {
    const failed = randomUUID()
    await expect(create(failed, "task-output", "fail-audit")).rejects.toThrow(
      "AUDIT_UNAVAILABLE"
    )
    const remaining = await owner.query(
      "SELECT count(*)::integer AS count FROM public.platform_resources WHERE id=$1",
      [failed]
    )
    expect(remaining.rows[0].count).toBe(0)
    await expect(read(actor, session, "fail-audit")).rejects.toThrow(
      "AUDIT_UNAVAILABLE"
    )
  })
})
