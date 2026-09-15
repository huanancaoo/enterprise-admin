import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, test } from "vitest"
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers"
import { Pool } from "pg"
import { createAuth } from "../src/auth.ts"
import { createDatabase } from "../src/index.ts"

const exec = promisify(execFile)
const tables = [
  "account",
  "invitation",
  "member",
  "organization",
  "organization_role",
  "project_translations",
  "projects",
  "session",
  "user",
  "verification",
]

const suiteName = "S2: bootstrap → one-shot migration → runtime"

describe(suiteName, { concurrent: false }, () => {
  let container: StartedTestContainer | undefined
  let owner: Pool
  let migrator: Pool
  let runtime: Pool
  let platform: Pool
  let migrationUrl: string
  let temp: string | undefined

  const runMigration = (
    script = resolve("src/migrate.ts"),
    url = migrationUrl
  ) =>
    exec(process.execPath, [script], {
      // 子进程只得到迁移凭据，不能借助测试 bootstrap 凭据隐式成功。
      env: { PATH: process.env.PATH, MIGRATION_DATABASE_URL: url },
    })

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
    owner = new Pool({ connectionString: url("bootstrap_admin", passwords[0]) })
    migrationUrl = url("app_migrator", passwords[1])
    migrator = new Pool({ connectionString: migrationUrl })
    runtime = createDatabase(url("app_runtime", passwords[2])).pool
    platform = new Pool({
      connectionString: url("platform_runtime", passwords[3]),
    })
  })

  afterAll(async () => {
    // 初始化或断言失败也关闭连接，测试绝不复用开发数据库。
    try {
      await Promise.all([
        owner?.end(),
        migrator?.end(),
        runtime?.end(),
        platform?.end(),
      ])
    } finally {
      await container?.stop()
      if (temp) await rm(temp, { recursive: true, force: true })
    }
  })

  test("空库成功迁移，重复执行不重放或改变 ledger", async () => {
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'"
        )
      ).rows[0].n,
      0
    )
    await runMigration()
    const before = (
      await migrator.query(
        "SELECT * FROM drizzle.__drizzle_migrations ORDER BY id"
      )
    ).rows
    assert.equal(before.length, 6)
    await runMigration()
    assert.deepEqual(
      (
        await migrator.query(
          "SELECT * FROM drizzle.__drizzle_migrations ORDER BY id"
        )
      ).rows,
      before
    )
    assert.deepEqual(
      (
        await owner.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
        )
      ).rows.map((row) => row.tablename),
      tables
    )
  })

  test("Owner、角色属性、DDL、TEMP、角色切换和迁移历史访问边界", async () => {
    const roles = (
      await owner.query(
        "SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname IN ('app_migrator','app_runtime','platform_runtime')"
      )
    ).rows
    assert.equal(roles.length, 3)
    for (const row of roles)
      for (const key of [
        "rolsuper",
        "rolbypassrls",
        "rolcreatedb",
        "rolcreaterole",
        "rolreplication",
      ])
        assert.equal(row[key], false)
    const owners = (
      await owner.query(
        "SELECT tableowner FROM pg_tables WHERE schemaname IN ('public','drizzle')"
      )
    ).rows
    assert.ok(owners.length > 0)
    assert.ok(owners.every((row) => row.tableowner === "app_migrator"))
    for (const pool of [runtime, platform]) {
      for (const sql of [
        "CREATE TABLE public.forbidden(id int)",
        "CREATE TEMP TABLE forbidden(id int)",
        "CREATE SCHEMA forbidden",
        'ALTER TABLE public."user" ADD COLUMN forbidden text',
        'TRUNCATE public."user"',
        'DROP TABLE public."user" CASCADE',
        "SET ROLE app_migrator",
        "SET ROLE bootstrap_admin",
        "SELECT * FROM drizzle.__drizzle_migrations",
      ])
        await assert.rejects(
          pool.query(sql),
          (error: { code?: string }) => error.code === "42501",
          sql
        )
    }
    await assert.rejects(runtime.query("SET ROLE platform_runtime"), {
      code: "42501",
    })
    for (const table of tables) {
      const { rows } = await runtime.query(
        "SELECT has_table_privilege(current_user, $1, 'SELECT') AND has_table_privilege(current_user, $1, 'INSERT') AND has_any_column_privilege(current_user, $1, 'UPDATE') AND has_table_privilege(current_user, $1, 'DELETE') AS allowed",
        [`public."${table}"`]
      )
      assert.equal(rows[0].allowed, true, table)
    }
  })

  test("实际 runtime 执行 Better Auth 注册、登录、会话、组织和动态角色操作", async () => {
    const auth = createAuth(
      runtime,
      "http://localhost:3000",
      randomBytes(32).toString("hex")
    )
    const registered = await auth.api.signUpEmail({
      body: {
        name: "S2",
        email: "s2@example.test",
        password: "S2-database-test-password",
      },
    })
    assert.ok(registered.user.id)
    const response = await auth.api.signInEmail({
      body: { email: "s2@example.test", password: "S2-database-test-password" },
      asResponse: true,
    })
    assert.equal(response.status, 200)
    const cookie = response.headers
      .getSetCookie()
      .map((item) => item.split(";")[0])
      .join("; ")
    const headers = new Headers({ cookie })
    const session = await auth.api.getSession({ headers })
    assert.equal(session?.user.id, registered.user.id)
    const org = await auth.api.createOrganization({
      headers,
      body: { name: "S2 Org", slug: "s2-org" },
    })
    assert.ok(org?.id)
    await auth.api.setActiveOrganization({
      headers,
      body: { organizationId: org!.id },
    })
    await auth.api.createOrgRole({
      headers,
      body: {
        organizationId: org!.id,
        role: "translator",
        permission: { project: ["read", "translate"] },
      },
    })
    const types = (
      await runtime.query(
        "SELECT data_type FROM information_schema.columns WHERE (table_name IN ('member','invitation','organization_role') AND column_name='organization_id') OR (table_name='session' AND column_name='active_organization_id') OR (table_name='organization' AND column_name='id')"
      )
    ).rows
    assert.equal(types.length, 5)
    assert.ok(types.every((row) => row.data_type === "uuid"))
    await runtime.query('UPDATE public."user" SET name=$1 WHERE id=$2', [
      "Updated",
      registered.user.id,
    ])
    await auth.api.signOut({ headers })
    assert.equal(await auth.api.getSession({ headers }), null)
  })

  test("平台仅能读允许的元数据列，不能读凭据或获得默认新表权限", async () => {
    assert.equal(
      (await platform.query('SELECT id, name, email FROM public."user"'))
        .rowCount,
      1
    )
    assert.equal(
      (await platform.query("SELECT id, name, slug FROM public.organization"))
        .rowCount,
      1
    )
    for (const sql of [
      "SELECT * FROM public.account",
      "SELECT * FROM public.session",
      "SELECT metadata FROM public.organization",
      "UPDATE public.organization SET name='forbidden'",
    ])
      await assert.rejects(platform.query(sql), { code: "42501" })
    const client = await migrator.connect()
    try {
      await client.query("BEGIN")
      await client.query("CREATE TABLE public.future_domain(id uuid)")
      const grants = await client.query(
        "SELECT has_table_privilege('app_runtime', 'public.future_domain', 'SELECT,INSERT,UPDATE,DELETE') AS app, has_table_privilege('platform_runtime', 'public.future_domain', 'SELECT,INSERT,UPDATE,DELETE') AS platform"
      )
      assert.deepEqual(grants.rows[0], { app: false, platform: false })
    } finally {
      await client.query("ROLLBACK")
      client.release()
    }
  })

  test("错误身份执行 migrator 失败；SQL 失败返回非零并回滚，不记入 ledger", async () => {
    const ownerConfig = owner.options
    await assert.rejects(runMigration(undefined, ownerConfig.connectionString))
    const before = (
      await migrator.query(
        "SELECT * FROM drizzle.__drizzle_migrations ORDER BY id"
      )
    ).rows
    temp = await mkdtemp(join(tmpdir(), "enterprise-migration-failure-"))
    await mkdir(join(temp, "src"))
    await cp("src/migrate.ts", join(temp, "src/migrate.ts"))
    await cp("migrations", join(temp, "migrations"), { recursive: true })
    await symlink(resolve("node_modules"), join(temp, "node_modules"))
    const journalPath = join(temp, "migrations/meta/_journal.json")
    const journal = JSON.parse(await readFile(journalPath, "utf8"))
    journal.entries.push({
      idx: journal.entries.length,
      version: "7",
      when: journal.entries.at(-1).when + 1,
      tag: "0002_failure",
      breakpoints: true,
    })
    await writeFile(journalPath, JSON.stringify(journal))
    await writeFile(
      join(temp, "migrations/0002_failure.sql"),
      "CREATE TABLE public.must_rollback(id int);\n--> statement-breakpoint\nSELECT * FROM public.intentionally_missing_table;"
    )
    await assert.rejects(
      runMigration(join(temp, "src/migrate.ts")),
      (error: { code?: number; stderr?: string }) =>
        error.code !== 0 &&
        Boolean(error.stderr?.includes("intentionally_missing_table"))
    )
    assert.equal(
      (await owner.query("SELECT to_regclass('public.must_rollback') AS name"))
        .rows[0].name,
      null
    )
    assert.deepEqual(
      (
        await migrator.query(
          "SELECT * FROM drizzle.__drizzle_migrations ORDER BY id"
        )
      ).rows,
      before
    )
    await runMigration()
  })
})
