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
import { createAuth, noopAuthEmailHooks } from "../src/auth.ts"
import { createDatabase } from "../src/index.ts"
import { createPlatformAdmin } from "../src/platform-admin.ts"

const exec = promisify(execFile)
const tables = [
  "account",
  "email_messages",
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
    const journal = JSON.parse(
      await readFile("migrations/meta/_journal.json", "utf8")
    ) as { entries: unknown[] }
    assert.equal(before.length, journal.entries.length)
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
      [
        ...tables,
        "audit_events",
        "organization_status",
        "platform_assignment",
      ].sort()
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
    assert.deepEqual(
      (
        await runtime.query(
          "SELECT has_table_privilege(current_user, 'audit_events', 'SELECT') AS read, has_table_privilege(current_user, 'audit_events', 'INSERT') AS append, has_table_privilege(current_user, 'audit_events', 'UPDATE') AS update, has_table_privilege(current_user, 'audit_events', 'DELETE') AS delete"
        )
      ).rows[0],
      { read: true, append: true, update: false, delete: false }
    )
    await assert.rejects(platform.query("SELECT * FROM audit_events"), {
      code: "42501",
    })
    assert.deepEqual(
      (
        await runtime.query(
          `SELECT
            has_column_privilege(current_user, 'organization_status', 'organization_id', 'SELECT') AS organization_id,
            has_column_privilege(current_user, 'organization_status', 'status', 'SELECT') AS status,
            has_column_privilege(current_user, 'organization_status', 'status_version', 'SELECT') AS status_version,
            has_column_privilege(current_user, 'organization_status', 'authorization_version', 'SELECT') AS authorization_version,
            has_column_privilege(current_user, 'organization_status', 'status_changed_at', 'SELECT') AS status_changed_at,
            has_column_privilege(current_user, 'organization_status', 'status_changed_by', 'SELECT') AS status_changed_by,
            has_column_privilege(current_user, 'organization_status', 'internal_reason', 'SELECT') AS internal_reason,
            has_column_privilege(current_user, 'organization_status', 'authorization_version', 'UPDATE') AS update_authorization_version,
            has_column_privilege(current_user, 'organization_status', 'status', 'UPDATE') AS update_status,
            has_table_privilege(current_user, 'organization_status', 'INSERT') AS insert,
            has_table_privilege(current_user, 'organization_status', 'DELETE') AS delete,
            has_function_privilege(current_user, 'require_active_organization(uuid)', 'EXECUTE') AS execute_lock
          `
        )
      ).rows[0],
      {
        organization_id: true,
        status: true,
        status_version: true,
        authorization_version: true,
        status_changed_at: true,
        status_changed_by: false,
        internal_reason: false,
        update_authorization_version: true,
        update_status: false,
        insert: false,
        delete: false,
        execute_lock: true,
      }
    )
    await assert.rejects(
      platform.query("SELECT status FROM organization_status"),
      {
        code: "42501",
      }
    )
    assert.deepEqual(
      (
        await runtime.query(
          `SELECT
            has_table_privilege(current_user, 'platform_assignment', 'SELECT') AS read,
            has_table_privilege(current_user, 'platform_assignment', 'INSERT') AS insert,
            has_table_privilege(current_user, 'platform_assignment', 'UPDATE') AS update,
            has_table_privilege(current_user, 'platform_assignment', 'DELETE') AS delete
          `
        )
      ).rows[0],
      { read: true, insert: true, update: false, delete: false }
    )
    await assert.rejects(
      platform.query("SELECT user_id FROM platform_assignment"),
      { code: "42501" }
    )
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
      randomBytes(32).toString("hex"),
      [],
      noopAuthEmailHooks
    )
    const registered = await auth.api.signUpEmail({
      body: {
        name: "S2",
        email: "s2@example.test",
        password: "S2-database-test-password",
      },
    })
    assert.ok(registered.user.id)
    await runtime.query(
      'UPDATE public."user" SET email_verified = true WHERE id = $1',
      [registered.user.id]
    )
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
    assert.deepEqual(
      (
        await runtime.query(
          "SELECT status, status_version, authorization_version FROM organization_status WHERE organization_id = $1",
          [org!.id]
        )
      ).rows[0],
      { status: "ACTIVE", status_version: 1, authorization_version: 2 }
    )
    await assert.rejects(
      runtime.query(
        "UPDATE organization_status SET status = 'SUSPENDED' WHERE organization_id = $1",
        [org!.id]
      ),
      { code: "42501" }
    )
    await assert.rejects(
      platform.query(
        "UPDATE organization_status SET status = 'SUSPENDED' WHERE organization_id = $1",
        [org!.id]
      ),
      { code: "42501" }
    )
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
    await migrator.query(
      "UPDATE organization_status SET status = 'SUSPENDED', status_version = status_version + 1, status_changed_at = now() WHERE organization_id = $1",
      [org!.id]
    )
    await assert.rejects(auth.api.getFullOrganization({ headers }), {
      status: "FORBIDDEN",
    })
    await assert.rejects(auth.api.listMembers({ headers }), {
      status: "FORBIDDEN",
    })
    await auth.api.signOut({ headers })
    assert.equal(await auth.api.getSession({ headers }), null)
  })

  test("CLI 创建的平台管理员可登录，邮箱已验证，也不因此成为组织成员", async () => {
    const auth = createAuth(
      runtime,
      "http://localhost:3000",
      randomBytes(32).toString("hex"),
      [],
      noopAuthEmailHooks
    )
    const email = "platform-admin@example.test"
    const password = "platform-admin-test-password"
    const { userId } = await createPlatformAdmin(auth, runtime, {
      email,
      password,
      name: "平台管理员",
    })
    assert.equal(
      (
        await runtime.query(
          'SELECT email_verified FROM public."user" WHERE id = $1',
          [userId]
        )
      ).rows[0].email_verified,
      true
    )
    assert.equal(
      (await runtime.query("SELECT 1 FROM member WHERE user_id = $1", [userId]))
        .rowCount,
      0
    )
    const response = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    })
    assert.equal(response.status, 200)
    await assert.rejects(
      createPlatformAdmin(auth, runtime, {
        email,
        password,
        name: "平台管理员",
      })
    )
  })

  test("停用后写入锁拒绝提交，缺失状态失败关闭", async () => {
    const inserted = await migrator.query<{ id: string }>(
      "INSERT INTO organization (name, slug, created_at) VALUES ('Lock Org', 'lock-org', now()) RETURNING id"
    )
    const organizationId = inserted.rows[0].id
    await migrator.query(
      "UPDATE organization_status SET status = 'SUSPENDED', status_version = status_version + 1, status_changed_at = now() WHERE organization_id = $1",
      [organizationId]
    )
    await assert.rejects(
      runtime.query("SELECT public.require_active_organization($1::uuid)", [
        organizationId,
      ]),
      (error: { code?: string }) => error.code === "ORS02"
    )
    await migrator.query(
      "UPDATE organization_status SET status = 'ACTIVE', status_version = status_version + 1, status_changed_at = now() WHERE organization_id = $1",
      [organizationId]
    )
    const client = await runtime.connect()
    try {
      await client.query("BEGIN")
      await client.query(
        "SELECT public.require_active_organization($1::uuid)",
        [organizationId]
      )
      const pending = migrator.query(
        "UPDATE organization_status SET status = 'SUSPENDED', status_version = status_version + 1, status_changed_at = now() WHERE organization_id = $1",
        [organizationId]
      )
      const waitingLocks = async () =>
        (
          await owner.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%organization_status%'"
          )
        ).rows[0].n
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        if ((await waitingLocks()) > 0) break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      assert.equal(await waitingLocks(), 1)
      await client.query("COMMIT")
      await pending
    } finally {
      client.release()
    }
    await assert.rejects(
      runtime.query("SELECT public.require_active_organization($1::uuid)", [
        organizationId,
      ]),
      (error: { code?: string }) => error.code === "ORS02"
    )
    await migrator.query(
      "DELETE FROM organization_status WHERE organization_id = $1",
      [organizationId]
    )
    await assert.rejects(
      runtime.query("SELECT public.require_active_organization($1::uuid)", [
        organizationId,
      ]),
      (error: { code?: string }) => error.code === "ORS01"
    )
    await migrator.query("DELETE FROM organization WHERE id = $1", [
      organizationId,
    ])
  })

  test("既有 enabled=false 回填为 SUSPENDED，不能覆盖成 ACTIVE", async () => {
    await owner.query(
      "CREATE DATABASE organization_status_backfill OWNER app_migrator"
    )
    const backfillUrl = migrationUrl.replace(
      /\/enterprise_admin$/,
      "/organization_status_backfill"
    )
    const dir = await mkdtemp(join(tmpdir(), "organization-status-backfill-"))
    const backfill = new Pool({ connectionString: backfillUrl })
    try {
      await mkdir(join(dir, "src"))
      await cp("src/migrate.ts", join(dir, "src/migrate.ts"))
      await cp("migrations", join(dir, "migrations"), { recursive: true })
      await symlink(resolve("node_modules"), join(dir, "node_modules"))
      const journalPath = join(dir, "migrations/meta/_journal.json")
      const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
        entries: { tag: string }[]
      }
      const statusMigrationIndex = journal.entries.findIndex(
        ({ tag }) => tag === "0010_loose_lady_mastermind"
      )
      const pending = journal.entries.splice(statusMigrationIndex)
      await writeFile(journalPath, JSON.stringify(journal))
      for (const migration of pending)
        await rm(join(dir, "migrations", `${migration.tag}.sql`))
      await runMigration(join(dir, "src/migrate.ts"), backfillUrl)
      const org = await backfill.query<{ id: string }>(
        "INSERT INTO organization (name, slug, created_at, enabled) VALUES ('Legacy Disabled', 'legacy-disabled', now(), false) RETURNING id"
      )
      journal.entries.push(...pending)
      await writeFile(journalPath, JSON.stringify(journal))
      for (const migration of pending)
        await cp(
          `migrations/${migration.tag}.sql`,
          join(dir, "migrations", `${migration.tag}.sql`)
        )
      await runMigration(join(dir, "src/migrate.ts"), backfillUrl)
      assert.deepEqual(
        (
          await backfill.query(
            "SELECT status FROM organization_status WHERE organization_id = $1",
            [org.rows[0].id]
          )
        ).rows[0],
        { status: "SUSPENDED" }
      )
      assert.equal(
        (
          await backfill.query(
            "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'organization' AND column_name = 'enabled'"
          )
        ).rowCount,
        0
      )
    } finally {
      await backfill.end()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("平台仅能读允许的元数据列，不能读凭据或获得默认新表权限", async () => {
    assert.equal(
      (await platform.query('SELECT id, name, email FROM public."user"'))
        .rowCount,
      2
    )
    assert.equal(
      (await platform.query("SELECT id, name, slug FROM public.organization"))
        .rowCount,
      1
    )
    for (const sql of [
      "SELECT * FROM public.account",
      "SELECT * FROM public.session",
      "SELECT * FROM public.email_messages",
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
