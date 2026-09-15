import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { promisify } from "node:util"
import { afterAll, beforeAll, test } from "vitest"
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers"
import { Pool } from "pg"
import { sql } from "drizzle-orm"
import { createTenantRunner, type TenantContext } from "../src/tenant.ts"
import { projectRepository } from "../src/repositories/projects.ts"

const context = (organizationId: string): TenantContext => ({
  organizationId,
  userId: randomUUID(),
  membershipId: randomUUID(),
  requestId: randomUUID(),
  locale: "zh-CN",
})
const a = context(randomUUID())
const b = context(randomUUID())
let container: StartedTestContainer | undefined
let pool: Pool
let run: ReturnType<typeof createTenantRunner>
let projectA: string
let projectB: string

beforeAll(async () => {
  const versions = JSON.parse(
    await readFile("../../docs/architecture/versions.json", "utf8")
  )
  const passwords = Array.from({ length: 4 }, () =>
    randomBytes(24).toString("hex")
  )
  container = await new GenericContainer(versions.postgresql.image)
    .withEnvironment({
      POSTGRES_USER: "bootstrap_admin",
      POSTGRES_DB: "enterprise_admin",
      POSTGRES_PASSWORD: passwords[0],
      APP_MIGRATOR_PASSWORD: passwords[1],
      APP_RUNTIME_PASSWORD: passwords[2],
      PLATFORM_RUNTIME_PASSWORD: passwords[3],
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
      MIGRATION_DATABASE_URL: url("app_migrator", passwords[1]),
    },
  })
  // 单连接池让并发请求必然复用同一连接，避免靠新连接掩盖上下文泄漏。
  pool = new Pool({
    connectionString: url("app_runtime", passwords[2]),
    max: 1,
  })
  run = createTenantRunner(pool)
  for (const [ctx, name] of [
    [a, "A"],
    [b, "B"],
  ] as const) {
    await pool.query(
      "INSERT INTO organization(id,name,slug,created_at) VALUES ($1,$2,$2,now())",
      [ctx.organizationId, name]
    )
  }
  projectA = (
    await run(a, (tx) =>
      projectRepository.create(tx, {
        contentLocale: "zh-CN",
        name: "A",
        description: null,
      })
    )
  ).id
  projectB = (
    await run(b, (tx) =>
      projectRepository.create(tx, {
        contentLocale: "en-US",
        name: "B",
        description: "B description",
      })
    )
  ).id
})
afterAll(async () => {
  try {
    await pool?.end()
  } finally {
    await container?.stop()
  }
})

// Drizzle 包装驱动错误；断言 SQLSTATE，避免把连接错误误当隔离通过。
function code(expected: string) {
  return (error: unknown): boolean => {
    const value = error as { code?: string; cause?: { code?: string } }
    return (value.cause?.code ?? value.code) === expected
  }
}

test("实际 runtime 非 Owner、无旁路权限，两表启用且强制 RLS", async () => {
  const role = await pool.query(
    "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user"
  )
  assert.deepEqual(role.rows[0], {
    current_user: "app_runtime",
    rolsuper: false,
    rolbypassrls: false,
  })
  const tables = await pool.query(
    "SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname IN ('projects','project_translations')"
  )
  assert.equal(tables.rowCount, 2)
  for (const row of tables.rows)
    assert.deepEqual(row, {
      relrowsecurity: true,
      relforcerowsecurity: true,
      owner: "app_migrator",
    })
})

test("Repository 显式范围和故意遗漏 WHERE 的 SQL 都只返回当前组织", async () => {
  for (const ctx of [a, b])
    await run(ctx, async (tx) => {
      assert.equal((await projectRepository.list(tx)).length, 1)
      for (const table of ["projects", "project_translations"]) {
        const result = await tx.execute(
          sql`SELECT organization_id FROM ${sql.identifier(table)}`
        )
        assert.deepEqual(result.rows, [{ organization_id: ctx.organizationId }])
      }
      assert.deepEqual(
        await projectRepository.translations(
          tx,
          ctx === a ? projectB : projectA
        ),
        []
      )
      assert.deepEqual(
        await projectRepository.delete(tx, ctx === a ? projectB : projectA),
        []
      )
    })
})

test("跨组织 INSERT 与变更 organization_id 被 WITH CHECK 拒绝", async () => {
  const queries = [
    sql`INSERT INTO projects(organization_id,content_locale) VALUES (${b.organizationId}, 'zh-CN')`,
    sql`UPDATE projects SET organization_id=${b.organizationId} WHERE id=${projectA}`,
    sql`INSERT INTO project_translations(organization_id,project_id,locale,name) VALUES (${b.organizationId},${projectB},'ar','invalid')`,
    sql`UPDATE project_translations SET organization_id=${b.organizationId} WHERE project_id=${projectA}`,
  ]
  for (const query of queries)
    await assert.rejects(
      run(a, (tx) => tx.execute(query)),
      code("42501")
    )
})

test("当前组织译文无法引用另一组织 Project；同语言译文不重复", async () => {
  await assert.rejects(
    run(a, (tx) =>
      tx.execute(
        sql`INSERT INTO project_translations(organization_id,project_id,locale,name) VALUES (${a.organizationId},${projectB},'ar','invalid')`
      )
    ),
    code("23503")
  )
  await assert.rejects(
    run(a, (tx) =>
      tx.execute(
        sql`INSERT INTO project_translations(organization_id,project_id,locale,name) VALUES (${a.organizationId},${projectA},'zh-CN','duplicate')`
      )
    ),
    code("23505")
  )
})

test("无上下文时两表不可读取、写入被拒绝", async () => {
  for (const table of ["projects", "project_translations"])
    assert.equal((await pool.query(`SELECT * FROM ${table}`)).rowCount, 0)
  await assert.rejects(
    pool.query(
      "INSERT INTO projects(organization_id,content_locale) VALUES ($1,'zh-CN')",
      [a.organizationId]
    ),
    code("42501")
  )
  await assert.rejects(
    pool.query(
      "INSERT INTO project_translations(organization_id,project_id,locale,name) VALUES ($1,$2,'ar','no context')",
      [a.organizationId, projectA]
    ),
    code("42501")
  )
})

test("A/B 并发排队复用连接，提交与回滚均不遗留上下文", async () => {
  const pids = await Promise.all(
    Array.from({ length: 24 }, (_, i) =>
      run(i % 2 ? a : b, async (tx) => {
        await tx.execute(sql`SELECT pg_sleep(0.002)`)
        const result = await tx.execute(
          sql`SELECT organization_id, pg_backend_pid() AS pid FROM projects`
        )
        assert.equal(result.rows.length, 1)
        assert.equal(result.rows[0]!.organization_id, tx.context.organizationId)
        return result.rows[0]!.pid
      })
    )
  )
  assert.equal(new Set(pids).size, 1)
  const aborted = randomUUID()
  await assert.rejects(
    run(a, async (tx) => {
      await tx.execute(
        sql`INSERT INTO projects(id,organization_id,content_locale) VALUES (${aborted},${a.organizationId},'ar')`
      )
      throw new Error("rollback test")
    }),
    /rollback test/
  )
  assert.equal(
    (
      await pool.query(
        "SELECT NULLIF(current_setting('app.organization_id',true),'') AS org"
      )
    ).rows[0].org,
    null
  )
  assert.equal((await pool.query("SELECT * FROM projects")).rowCount, 0)
  await run(a, async (tx) =>
    assert.equal(
      (await tx.execute(sql`SELECT * FROM projects WHERE id=${aborted}`))
        .rowCount,
      0
    )
  )
  assert.equal(
    (await run(b, (tx) => projectRepository.list(tx)))[0]!.id,
    projectB
  )
})

test("创建项目与基础译文原子提交，译文失败回滚项目，硬删除级联译文", async () => {
  await assert.rejects(
    run(a, (tx) =>
      projectRepository.create(tx, {
        contentLocale: "zh-CN",
        name: "   ",
        description: null,
      })
    ),
    code("23514")
  )
  assert.equal((await run(a, (tx) => projectRepository.list(tx))).length, 1)
  const created = await run(a, (tx) =>
    projectRepository.create(tx, {
      contentLocale: "ar",
      name: " example ",
      description: null,
    })
  )
  await run(a, async (tx) => {
    const translations = await projectRepository.translations(tx, created.id)
    assert.equal(translations[0]!.name, "example")
    assert.equal(created.status, "draft")
    assert.equal((await projectRepository.delete(tx, created.id)).length, 1)
    assert.equal(
      (await projectRepository.translations(tx, created.id)).length,
      0
    )
  })
})

test("未加组织过滤的 UPDATE/DELETE 也不能触及其他组织资源", async () => {
  await run(a, async (tx) => {
    for (const query of [
      sql`UPDATE projects SET status='archived' WHERE id=${projectB}`,
      sql`DELETE FROM projects WHERE id=${projectB}`,
      sql`UPDATE project_translations SET name='forbidden' WHERE project_id=${projectB}`,
      sql`DELETE FROM project_translations WHERE project_id=${projectB}`,
    ])
      assert.equal((await tx.execute(query)).rowCount, 0)
  })
  await run(b, async (tx) => {
    assert.equal((await projectRepository.list(tx))[0]!.status, "draft")
    assert.equal(
      (await projectRepository.translations(tx, projectB))[0]!.name,
      "B"
    )
  })
})
