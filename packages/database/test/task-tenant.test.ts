import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { promisify } from "node:util"
import { setTimeout as delay } from "node:timers/promises"
import { afterAll, beforeAll, test } from "vitest"
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers"
import { Pool } from "pg"
import { sql } from "drizzle-orm"
import {
  createTaskTenantRunner,
  TaskAuthorizationError,
  type TaskIdentity,
} from "../src/task-tenant.ts"

let container: StartedTestContainer | undefined
let owner: Pool
let runtime: Pool
let run: ReturnType<typeof createTaskTenantRunner>

beforeAll(async () => {
  const versions = JSON.parse(
    await readFile("../../docs/architecture/versions.json", "utf8")
  )
  const passwords = Array.from({ length: 5 }, () =>
    randomBytes(24).toString("hex")
  )
  container = await new GenericContainer(versions.postgresql.image)
    .withEnvironment({
      POSTGRES_USER: "bootstrap_admin",
      POSTGRES_DB: "enterprise_admin",
      POSTGRES_PASSWORD: passwords[0]!,
      APP_MIGRATOR_PASSWORD: passwords[1]!,
      APP_RUNTIME_PASSWORD: passwords[2]!,
      PLATFORM_RUNTIME_PASSWORD: passwords[3]!,
      PLATFORM_DEPLOYER_PASSWORD: passwords[4]!,
    })
    .withCopyFilesToContainer([
      {
        source: resolve("../../infra/postgres/bootstrap.sql"),
        target: "/docker-entrypoint-initdb.d/001-bootstrap.sql",
      },
    ])
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage("database system is ready to accept connections", 2)
    )
    .start()
  const url = (user: string, password: string) =>
    `postgresql://${user}:${password}@${container!.getHost()}:${container!.getMappedPort(5432)}/enterprise_admin`
  await promisify(execFile)(process.execPath, [resolve("src/migrate.ts")], {
    env: {
      PATH: process.env.PATH,
      MIGRATION_DATABASE_URL: url("app_migrator", passwords[1]!),
    },
  })
  owner = new Pool({
    connectionString: url("bootstrap_admin", passwords[0]!),
    max: 3,
  })
  runtime = new Pool({
    connectionString: url("app_runtime", passwords[2]!),
    max: 1,
    application_name: "worker-authorization-test",
  })
  await owner.query(`
    CREATE TABLE worker_test_resources (
      organization_id uuid NOT NULL REFERENCES public.organization(id),
      resource_id uuid NOT NULL,
      PRIMARY KEY (organization_id, resource_id)
    );
    CREATE TABLE worker_test_effects (
      organization_id uuid NOT NULL,
      resource_id uuid NOT NULL,
      intent_key text NOT NULL,
      value text NOT NULL,
      PRIMARY KEY (organization_id, intent_key),
      FOREIGN KEY (organization_id, resource_id) REFERENCES worker_test_resources(organization_id, resource_id)
    );
    ALTER TABLE worker_test_resources OWNER TO app_migrator;
    ALTER TABLE worker_test_effects OWNER TO app_migrator;
    ALTER TABLE worker_test_resources ENABLE ROW LEVEL SECURITY;
    ALTER TABLE worker_test_resources FORCE ROW LEVEL SECURITY;
    ALTER TABLE worker_test_effects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE worker_test_effects FORCE ROW LEVEL SECURITY;
    CREATE POLICY worker_test_resources_tenant ON worker_test_resources
      USING (organization_id = NULLIF(current_setting('app.organization_id',true),'')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id',true),'')::uuid);
    CREATE POLICY worker_test_effects_tenant ON worker_test_effects
      USING (organization_id = NULLIF(current_setting('app.organization_id',true),'')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id',true),'')::uuid);
    GRANT SELECT, INSERT ON worker_test_resources, worker_test_effects TO app_runtime;
  `)
  run = createTaskTenantRunner(runtime)
})
afterAll(async () => {
  try {
    await Promise.all([owner?.end(), runtime?.end()])
  } finally {
    await container?.stop()
  }
})

async function organization(
  role = "owner",
  permission?: Record<string, string[]>
) {
  const organizationId = randomUUID()
  const actorId = randomUUID()
  const membershipId = randomUUID()
  await owner.query(
    'INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$2,$3,true,now(),now())',
    [actorId, "Worker member", `${actorId}@test.local`]
  )
  await owner.query(
    "INSERT INTO organization(id,name,slug,created_at) VALUES($1,$2,$2,now())",
    [organizationId, `worker-${organizationId}`]
  )
  if (permission) {
    await owner.query(
      "INSERT INTO organization_role(id,organization_id,role,permission,created_at,updated_at) VALUES($1,$2,$3,$4,now(),now())",
      [randomUUID(), organizationId, role, JSON.stringify(permission)]
    )
    await owner.query(
      `INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,'owner',now())`,
      [randomUUID(), organizationId, actorId]
    )
    const customActor = randomUUID()
    await owner.query(
      'INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$2,$3,true,now(),now())',
      [customActor, "Custom Worker member", `${customActor}@test.local`]
    )
    await owner.query(
      "INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,$4,now())",
      [membershipId, organizationId, customActor, role]
    )
    return {
      identity: {
        organizationId,
        actorId: customActor,
        resourceId: randomUUID(),
        locale: "ar" as const,
        requestId: randomUUID(),
      },
      membershipId,
    }
  }
  await owner.query(
    "INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,$4,now())",
    [membershipId, organizationId, actorId, role]
  )
  return {
    identity: {
      organizationId,
      actorId,
      resourceId: randomUUID(),
      locale: "ar" as const,
      requestId: randomUUID(),
    },
    membershipId,
  }
}

test("后台成员无浏览器 Session，使用当前成员关系及运行身份建立 TenantTx", async () => {
  const { identity, membershipId } = await organization()
  const result = await run(identity, { project: ["create"] }, async (tx) => ({
    context: tx.context,
    rows: (
      await tx.execute(
        sql`SELECT current_user, current_setting('app.organization_id') AS organization_id`
      )
    ).rows,
  }))
  assert.deepEqual(result.context, {
    organizationId: identity.organizationId,
    userId: identity.actorId,
    membershipId,
    locale: "ar",
    requestId: identity.requestId,
  })
  assert.deepEqual(result.rows, [
    { current_user: "app_runtime", organization_id: identity.organizationId },
  ])
  assert.equal(
    (
      await owner.query("SELECT 1 FROM session WHERE user_id=$1", [
        identity.actorId,
      ])
    ).rowCount,
    0
  )
})

test("动态组织角色按 Better Auth 的全部动作要求授权，不使用入队权限快照", async () => {
  const { identity } = await organization("task-editor", {
    project: ["create"],
  })
  await assert.rejects(
    run(
      identity,
      { project: ["create", "update"] },
      async () => "unauthorized"
    ),
    (error: unknown) =>
      error instanceof TaskAuthorizationError &&
      error.code === "PERMISSION_DENIED"
  )
  assert.equal(
    await run(identity, { project: ["create"] }, async () => "allowed"),
    "allowed"
  )
  await owner.query(
    "UPDATE organization_role SET permission=$1 WHERE organization_id=$2 AND role='task-editor'",
    [JSON.stringify({ project: ["read"] }), identity.organizationId]
  )
  await assert.rejects(
    run(identity, { project: ["create"] }, async () => "revoked"),
    (error: unknown) =>
      error instanceof TaskAuthorizationError &&
      error.code === "PERMISSION_DENIED"
  )
})

test("当前用户没有目标组织成员关系时，永久拒绝后台业务执行", async () => {
  const a = await organization()
  const b = await organization()
  await assert.rejects(
    run(
      { ...a.identity, actorId: b.identity.actorId },
      { project: ["create"] },
      async () => "foreign actor"
    ),
    (error: unknown) =>
      error instanceof TaskAuthorizationError &&
      error.code === "MEMBERSHIP_REQUIRED"
  )
  const custom = await organization("task-writer", { project: ["create"] })
  await owner.query("DELETE FROM member WHERE id=$1", [custom.membershipId])
  await assert.rejects(
    run(custom.identity, { project: ["create"] }, async () => "removed member"),
    (error: unknown) =>
      error instanceof TaskAuthorizationError &&
      error.code === "MEMBERSHIP_REQUIRED"
  )
})

test("组织停用后成员任务永久拒绝，处理器不产生业务结果", async () => {
  const { identity } = await organization()
  await owner.query(
    "UPDATE organization_status SET status='SUSPENDED' WHERE organization_id=$1",
    [identity.organizationId]
  )
  await assert.rejects(
    run(identity, { project: ["create"] }, async () => "suspended business"),
    (error: unknown) =>
      error instanceof TaskAuthorizationError &&
      error.code === "ORGANIZATION_SUSPENDED"
  )
})

async function seedResource(identity: TaskIdentity) {
  await owner.query(
    "INSERT INTO worker_test_resources(organization_id,resource_id) VALUES($1,$2)",
    [identity.organizationId, identity.resourceId]
  )
}

function sqlCode(expected: string) {
  return (error: unknown): boolean => {
    const value = error as { code?: string; cause?: { code?: string } }
    return (value.cause?.code ?? value.code) === expected
  }
}

test("后台任务复用连接仍受 RLS 隔离，读取和写入不能跨组织资源", async () => {
  const a = (await organization()).identity
  const b = (await organization()).identity
  await seedResource(a)
  await seedResource(b)
  const pids = await Promise.all(
    Array.from({ length: 12 }, (_, index) => {
      const identity = index % 2 ? a : b
      return run(identity, { project: ["create"] }, async (tx) => {
        const rows = await tx.execute(
          sql`SELECT resource_id, pg_backend_pid() AS pid FROM worker_test_resources`
        )
        assert.equal(rows.rows.length, 1)
        assert.equal(rows.rows[0]!.resource_id, identity.resourceId)
        return rows.rows[0]!.pid
      })
    })
  )
  assert.equal(new Set(pids).size, 1)
  assert.equal(
    await run(
      a,
      { project: ["create"] },
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT resource_id FROM worker_test_resources WHERE resource_id=${b.resourceId}::uuid`
          )
        ).rowCount
    ),
    0
  )
  await assert.rejects(
    run(a, { project: ["create"] }, (tx) =>
      tx.execute(sql`
    INSERT INTO worker_test_effects(organization_id,resource_id,intent_key,value)
    VALUES (${b.organizationId}::uuid,${b.resourceId}::uuid,'foreign-write','forbidden')`)
    ),
    sqlCode("42501")
  )
  assert.equal(
    (await runtime.query("SELECT * FROM worker_test_resources")).rowCount,
    0
  )
})

test("业务事实与准确资源类型成功审计原子提交，审计写失败回滚业务事实", async () => {
  const identity = (await organization()).identity
  await seedResource(identity)
  const write = async (intent: string, failAudit: boolean) =>
    run(identity, { project: ["create"] }, async (tx) => {
      await tx.execute(sql`INSERT INTO worker_test_effects(organization_id,resource_id,intent_key,value)
      VALUES (${tx.context.organizationId}::uuid,${identity.resourceId}::uuid,${intent},'effect')`)
      await tx.execute(sql`INSERT INTO audit_events(organization_id,event_code,actor_id,resource_type,resource_id,request_id,fields)
      VALUES (${tx.context.organizationId}::uuid,'test.task.completed',${tx.context.userId}::uuid,'worker_test_resource',${identity.resourceId}::uuid,${tx.context.requestId},${failAudit ? null : "{}"}::jsonb)`)
      return "committed"
    })
  assert.equal(await write("success", false), "committed")
  await assert.rejects(write("audit-failure", true), sqlCode("23502"))
  assert.deepEqual(
    (
      await owner.query(
        "SELECT intent_key FROM worker_test_effects WHERE organization_id=$1",
        [identity.organizationId]
      )
    ).rows,
    [{ intent_key: "success" }]
  )
  assert.deepEqual(
    (
      await owner.query(
        "SELECT actor_id,resource_type,resource_id,request_id FROM audit_events WHERE event_code='test.task.completed' AND organization_id=$1",
        [identity.organizationId]
      )
    ).rows,
    [
      {
        actor_id: identity.actorId,
        resource_type: "worker_test_resource",
        resource_id: identity.resourceId,
        request_id: identity.requestId,
      },
    ]
  )
  assert.equal(
    (
      await runtime.query(
        "SELECT NULLIF(current_setting('app.organization_id',true),'') AS organization_id"
      )
    ).rows[0].organization_id,
    null
  )
})

for (const change of ["role", "membership", "status"] as const) {
  test(`等待组织锁后重读当前授权：${change} 变更拒绝新业务`, async () => {
    const { identity, membershipId } = await organization(
      "waiting-task-writer",
      { project: ["create"] }
    )
    await seedResource(identity)
    const blocker = await owner.connect()
    let pending: Promise<{ error?: unknown }> | undefined
    try {
      await blocker.query("BEGIN")
      await blocker.query("SELECT public.require_active_organization($1)", [
        identity.organizationId,
      ])
      pending = run(identity, { project: ["create"] }, async (tx) => {
        await tx.execute(sql`INSERT INTO worker_test_effects(organization_id,resource_id,intent_key,value)
          VALUES (${tx.context.organizationId}::uuid,${identity.resourceId}::uuid,'after-wait','forbidden')`)
      }).then(
        () => ({}),
        (error: unknown) => ({ error })
      )
      let blocked = false
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await owner.query(
          "SELECT 1 FROM pg_stat_activity WHERE application_name='worker-authorization-test' AND cardinality(pg_blocking_pids(pid))>0"
        )
        if (result.rowCount) {
          blocked = true
          break
        }
        await delay(10)
      }
      assert.equal(blocked, true, "任务必须等待组织管理事务持有的锁")
      if (change === "role")
        await blocker.query(
          "UPDATE organization_role SET permission=$1 WHERE organization_id=$2 AND role='waiting-task-writer'",
          [JSON.stringify({ project: ["read"] }), identity.organizationId]
        )
      if (change === "membership")
        await blocker.query("DELETE FROM member WHERE id=$1", [membershipId])
      if (change === "status")
        await blocker.query(
          "UPDATE organization_status SET status='SUSPENDED' WHERE organization_id=$1",
          [identity.organizationId]
        )
      await blocker.query("COMMIT")
      const { error } = await pending
      assert.ok(error instanceof TaskAuthorizationError)
      assert.equal(
        error.code,
        change === "role"
          ? "PERMISSION_DENIED"
          : change === "membership"
            ? "MEMBERSHIP_REQUIRED"
            : "ORGANIZATION_SUSPENDED"
      )
      assert.equal(
        (
          await owner.query(
            "SELECT 1 FROM worker_test_effects WHERE organization_id=$1",
            [identity.organizationId]
          )
        ).rowCount,
        0
      )
    } finally {
      await blocker.query("ROLLBACK")
      blocker.release()
      await pending
    }
  })
}

test("不存在的目标组织与成员不存在使用相同永久拒绝，避免暴露组织存在性", async () => {
  const { identity } = await organization()
  await assert.rejects(
    run(
      { ...identity, organizationId: randomUUID() },
      { project: ["create"] },
      async () => "missing organization business"
    ),
    (error: unknown) =>
      error instanceof TaskAuthorizationError &&
      error.code === "MEMBERSHIP_REQUIRED"
  )
})
