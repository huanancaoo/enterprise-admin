import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, test, vi } from "vitest"
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers"
import { Pool } from "pg"
import { hashPassword, verifyPassword } from "better-auth/crypto"
import { managePlatformAssignment } from "../src/platform-assignment-admin.ts"

const exec = promisify(execFile)
type Identity = { id: string; session: string; token: string; email: string }
describe("全局身份管理固定函数", { concurrent: false }, () => {
  let container: StartedTestContainer | undefined
  let owner: Pool
  let runtime: Pool
  let deployer: Pool
  let fixture: string | undefined
  let admin: Identity
  let auditor: Identity
  const legacy = randomUUID()

  async function seed(
    name = "Identity User",
    role?: "platform_admin" | "platform_auditor"
  ): Promise<Identity> {
    const id = randomUUID()
    const email = id + "@test.example"
    const session = randomUUID()
    const token = randomBytes(24).toString("hex")
    await runtime.query(
      'INSERT INTO public."user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$2,$3,true,now(),now())',
      [id, name, email]
    )
    await runtime.query(
      "INSERT INTO public.session(id,user_id,token,created_at,updated_at,expires_at,ip_address,user_agent) VALUES($1,$2,$3,now(),now(),now()+interval '1 day','127.0.0.1','DB Test')",
      [session, id, token]
    )
    if (role)
      await managePlatformAssignment(deployer, "grant", {
        userId: id,
        role,
        reason: "Identity management database test",
      })
    return { id, session, token, email }
  }
  async function result(statement: string, values: unknown[]) {
    return (
      await runtime.query<{ result: Record<string, unknown> }>(
        statement,
        values
      )
    ).rows[0].result
  }
  const status = (
    target: Identity,
    value: string,
    version: number,
    request: string = randomUUID()
  ) =>
    result(
      "SELECT public.set_platform_user_status($1,$2,$3,$4,$5,$6) AS result",
      [admin.id, admin.session, target.id, value, version, request]
    )

  beforeAll(async () => {
    const versions = JSON.parse(
      await readFile("../../docs/architecture/versions.json", "utf8")
    )
    const passwords = Array.from({ length: 5 }, () =>
      randomBytes(24).toString("hex")
    )
    container = await new GenericContainer(
      versions.releaseFoundation.postgresql.image
    )
      .withEnvironment({
        POSTGRES_USER: "bootstrap_admin",
        POSTGRES_DB: "enterprise_admin",
        POSTGRES_PASSWORD: passwords[0],
        APP_MIGRATOR_PASSWORD: passwords[1],
        APP_RUNTIME_PASSWORD: passwords[2],
        PLATFORM_RUNTIME_PASSWORD: passwords[3],
        PLATFORM_DEPLOYER_PASSWORD: passwords[4],
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
    runtime = new Pool({ connectionString: url("app_runtime", passwords[2]) })
    deployer = new Pool({
      connectionString: url("platform_deployer", passwords[4]),
    })
    fixture = await mkdtemp(join(tmpdir(), "identity-management-db-"))
    await cp("src", join(fixture, "src"), { recursive: true })
    await cp("migrations", join(fixture, "migrations"), { recursive: true })
    await symlink(resolve("node_modules"), join(fixture, "node_modules"))
    const journalPath = join(fixture, "migrations/meta/_journal.json")
    const journal = JSON.parse(await readFile(journalPath, "utf8"))
    const migrate = () =>
      exec(process.execPath, [join(fixture!, "src/migrate.ts")], {
        env: {
          PATH: process.env.PATH,
          MIGRATION_DATABASE_URL: url("app_migrator", passwords[1]),
        },
      })
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter(
          (entry: { idx: number }) => entry.idx <= 67
        ),
      })
    )
    await migrate()
    await runtime.query(
      'INSERT INTO public."user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$2,$3,true,now(),now())',
      [legacy, "Legacy User", "legacy@test.example"]
    )
    await writeFile(journalPath, JSON.stringify(journal))
    await migrate()
    await migrate()
    admin = await seed("Identity Admin", "platform_admin")
    auditor = await seed("Identity Auditor", "platform_auditor")
  })
  afterAll(async () => {
    await Promise.all([owner?.end(), runtime?.end(), deployer?.end()])
    await container?.stop()
    if (fixture) await rm(fixture, { recursive: true, force: true })
  })

  test("升级补旧账号，新原生账号由触发器初始化；运行身份无状态/日志表或任职写权限", async () => {
    const current = await seed()
    for (const id of [legacy, current.id]) {
      assert.deepEqual(
        (
          await owner.query(
            "SELECT status,version FROM public.user_account_status WHERE user_id=$1",
            [id]
          )
        ).rows[0],
        { status: "active", version: 1 }
      )
    }
    for (const table of ["user_account_status", "login_events"]) {
      await assert.rejects(runtime.query("SELECT * FROM public." + table), {
        code: "42501",
      })
      const flags = (
        await owner.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
          [table]
        )
      ).rows[0]
      assert.deepEqual(flags, {
        relrowsecurity: true,
        relforcerowsecurity: true,
      })
    }
    await assert.rejects(
      runtime.query(
        "UPDATE public.platform_assignment SET role='platform_admin' WHERE user_id=$1",
        [current.id]
      ),
      { code: "42501" }
    )
    assert.equal(
      (
        await owner.query(
          "SELECT has_column_privilege('platform_executor','public.session','token','SELECT') AS allowed"
        )
      ).rows[0].allowed,
      false
    )
    const names = [
      "create_platform_user",
      "update_platform_user",
      "set_platform_user_status",
      "record_login_event",
      "list_platform_login_logs",
      "list_personal_login_logs",
      "list_platform_sessions",
      "revoke_platform_session",
      "require_active_account",
    ]
    const functions = (
      await owner.query(
        "SELECT p.proname,p.prosecdef,p.proconfig,r.rolname,has_function_privilege('app_runtime',p.oid,'EXECUTE') AS runtime,has_function_privilege('platform_deployer',p.oid,'EXECUTE') AS deployer,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE') AS public FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY($1::text[])",
        [names]
      )
    ).rows
    assert.equal(functions.length, names.length)
    for (const fn of functions) {
      assert.equal(fn.rolname, "platform_executor")
      assert.equal(fn.prosecdef, true)
      assert.deepEqual(fn.proconfig, [
        "search_path=pg_catalog",
        "row_security=on",
      ])
      assert.equal(fn.runtime, true)
      assert.equal(fn.deployer, false)
      assert.equal(fn.public, false)
    }
  })

  test("网页创建原生已验证账号和密码，不创建平台任职或组织成员；重复邮箱不修改原身份", async () => {
    const email = randomUUID() + "@test.example"
    const password = "Identity-Test-123!"
    const hash = await hashPassword(password)
    const user = await result(
      "SELECT public.create_platform_user($1,$2,$3,$4,$5,$6) AS result",
      [
        admin.id,
        admin.session,
        " Web User ",
        email.toUpperCase(),
        hash,
        randomUUID(),
      ]
    )
    assert.equal(user.name, "Web User")
    assert.equal(user.emailVerified, true)
    assert.equal(user.status, "active")
    assert.equal(user.version, 1)
    assert.deepEqual(user.organizations, [])
    assert.equal(JSON.stringify(user).includes(password), false)
    const account = (
      await owner.query(
        "SELECT provider_id,password FROM public.account WHERE user_id=$1",
        [user.userId]
      )
    ).rows[0]
    assert.equal(account.provider_id, "credential")
    assert.equal(
      await verifyPassword({ hash: account.password, password }),
      true
    )
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM public.platform_assignment WHERE user_id=$1",
          [user.userId]
        )
      ).rows[0].n,
      0
    )
    await assert.rejects(
      runtime.query("SELECT public.create_platform_user($1,$2,$3,$4,$5,$6)", [
        admin.id,
        admin.session,
        "Overwrite",
        email,
        hash,
        randomUUID(),
      ]),
      { message: "EMAIL_ALREADY_EXISTS" }
    )
    assert.equal(
      (
        await owner.query('SELECT name FROM public."user" WHERE id=$1', [
          user.userId,
        ])
      ).rows[0].name,
      "Web User"
    )
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM public.account WHERE user_id=$1",
          [user.userId]
        )
      ).rows[0].n,
      1
    )
  })

  test("姓名版本覆盖原生更新，无变化不递增；旧版本和审计员写入拒绝", async () => {
    const user = await seed()
    const update = (name: string, version: number, actor = admin) =>
      result(
        "SELECT public.update_platform_user($1,$2,$3,$4,$5,$6) AS result",
        [actor.id, actor.session, user.id, name, version, randomUUID()]
      )
    assert.equal((await update("Updated", 1)).version, 2)
    assert.equal((await update("Updated", 2)).changed, false)
    await assert.rejects(update("Stale", 1), { message: "VERSION_CONFLICT" })
    await runtime.query('UPDATE public."user" SET name=$1 WHERE id=$2', [
      "Native Updated",
      user.id,
    ])
    await assert.rejects(update("Stale Native", 2), {
      message: "VERSION_CONFLICT",
    })
    await assert.rejects(update("Denied", 3, auditor), { message: "FORBIDDEN" })
    const request = randomUUID()
    await runtime.query(
      "SELECT public.record_platform_identity_failure($1,$2,$3,$4,$5,$6)",
      [
        auditor.id,
        auditor.session,
        "platform.user_updated",
        user.id,
        request,
        "FORBIDDEN",
      ]
    )
    assert.equal(
      (
        await owner.query(
          "SELECT result FROM public.audit_events WHERE request_id=$1",
          [request]
        )
      ).rows[0].result,
      "denied"
    )
  })

  test("暂停撤销所有会话和 assurance，恢复不复活旧会话", async () => {
    const user = await seed()
    const second = randomUUID()
    await runtime.query(
      "INSERT INTO public.session(id,user_id,token,updated_at,expires_at) VALUES($1,$2,$3,now(),now()+interval '1 day')",
      [second, user.id, randomUUID()]
    )
    await owner.query(
      "INSERT INTO public.platform_session_assurance(session_id,user_id,verified_at,method) VALUES($1,$2,now(),'totp')",
      [user.session, user.id]
    )
    const suspended = await status(user, "suspended", 1)
    assert.equal(suspended.version, 2)
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM public.session WHERE user_id=$1",
          [user.id]
        )
      ).rows[0].n,
      0
    )
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM public.platform_session_assurance WHERE user_id=$1",
          [user.id]
        )
      ).rows[0].n,
      0
    )
    await assert.rejects(
      runtime.query("SELECT public.require_active_account($1)", [user.id]),
      { message: "ACCOUNT_SUSPENDED" }
    )
    assert.equal((await status(user, "suspended", 2)).changed, false)
    assert.equal((await status(user, "active", 2)).version, 3)
    await runtime.query("SELECT public.require_active_account($1)", [user.id])
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM public.session WHERE user_id=$1",
          [user.id]
        )
      ).rows[0].n,
      0
    )
    await assert.rejects(
      runtime.query("SELECT public.require_active_account($1)", [randomUUID()]),
      { message: "AUTHORIZATION_UNAVAILABLE" }
    )
  })

  test("账号暂停等待已授权事务释放状态读锁", async () => {
    const user = await seed()
    const reader = await runtime.connect()
    const writer = await runtime.connect()
    let pending: Promise<unknown> | undefined
    try {
      const pid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid
      await reader.query("BEGIN")
      await reader.query("SELECT public.require_active_account($1)", [user.id])
      pending = writer.query(
        "SELECT public.set_platform_user_status($1,$2,$3,'suspended',1,$4)",
        [admin.id, admin.session, user.id, randomUUID()]
      )
      await vi.waitFor(
        async () => {
          assert.equal(
            (
              await owner.query(
                "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
                [pid]
              )
            ).rows[0].wait_event_type,
            "Lock"
          )
        },
        { timeout: 3000, interval: 20 }
      )
      await reader.query("COMMIT")
      await pending
      assert.equal(
        (
          await owner.query(
            "SELECT status FROM public.user_account_status WHERE user_id=$1",
            [user.id]
          )
        ).rows[0].status,
        "suspended"
      )
    } finally {
      await reader.query("ROLLBACK")
      await pending
      reader.release()
      writer.release()
    }
  })

  test("在线会话仅返回有效会话的脱敏投影；管理员撤销，审计员只读", async () => {
    const user = await seed("Session Target")
    await runtime.query(
      "INSERT INTO public.session(id,user_id,token,updated_at,expires_at) VALUES($1,$2,$3,now(),now()-interval '1 second')",
      [randomUUID(), user.id, randomUUID()]
    )
    const page = await result(
      "SELECT public.list_platform_sessions($1,$2,$3,$4,$5,$6,$7) AS result",
      [auditor.id, auditor.session, null, user.id, 1, 20, randomUUID()]
    )
    assert.equal(page.total, 1)
    assert.equal(JSON.stringify(page).includes(user.token), false)
    assert.equal(JSON.stringify(page).includes(user.email), false)
    assert.equal(
      (page.items as Record<string, unknown>[])[0].sessionId,
      user.session
    )
    await assert.rejects(
      runtime.query("SELECT public.revoke_platform_session($1,$2,$3,$4)", [
        auditor.id,
        auditor.session,
        user.session,
        randomUUID(),
      ]),
      { message: "FORBIDDEN" }
    )
    assert.deepEqual(
      await result(
        "SELECT public.revoke_platform_session($1,$2,$3,$4) AS result",
        [admin.id, admin.session, user.session, randomUUID()]
      ),
      { sessionId: user.session, revoked: true }
    )
    assert.deepEqual(
      await result(
        "SELECT public.revoke_platform_session($1,$2,$3,$4) AS result",
        [admin.id, admin.session, user.session, randomUUID()]
      ),
      { sessionId: user.session, revoked: false }
    )
  })

  test("登录记录保存已知与匿名失败，平台可筛选，个人只能读本人", async () => {
    const user = await seed("Login Target")
    const other = await seed("Other Login")
    const record = (
      identity: string | null,
      email: string,
      method: string,
      outcome: string,
      reason: string | null
    ) =>
      runtime.query(
        "SELECT public.record_login_event($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          identity,
          email,
          method,
          outcome,
          reason,
          "127.0.0.1",
          "Login Test",
          randomUUID(),
        ]
      )
    await record(user.id, user.email, "email", "succeeded", null)
    await record(
      null,
      user.email.toUpperCase(),
      "email",
      "failed",
      "INVALID_CREDENTIALS"
    )
    await record(user.id, user.email, "totp", "failed", "INVALID_OTP")
    await record(other.id, other.email, "github", "succeeded", null)
    await record(
      null,
      "unknown@test.example",
      "email",
      "failed",
      "INVALID_CREDENTIALS"
    )
    const personal = await result(
      "SELECT public.list_personal_login_logs($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result",
      [user.id, user.session, null, null, null, null, 1, 20, randomUUID()]
    )
    assert.equal(personal.total, 3)
    assert.ok(
      (personal.items as Record<string, unknown>[]).every(
        (row) => row.userId === user.id
      )
    )
    await assert.rejects(
      runtime.query(
        "SELECT public.list_personal_login_logs($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [other.id, user.session, null, null, null, null, 1, 20, randomUUID()]
      ),
      { message: "UNAUTHENTICATED" }
    )
    const global = await result(
      "SELECT public.list_platform_login_logs($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result",
      [
        auditor.id,
        auditor.session,
        null,
        user.id,
        "failed",
        "totp",
        null,
        null,
        1,
        20,
        randomUUID(),
      ]
    )
    assert.equal(global.total, 1)
    assert.equal(JSON.stringify(global).includes(user.email), false)
    assert.equal(
      (global.items as Record<string, unknown>[])[0].reasonCode,
      "INVALID_OTP"
    )
    const emptyPage = await result(
      "SELECT public.list_platform_login_logs($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result",
      [
        admin.id,
        admin.session,
        null,
        user.id,
        null,
        null,
        null,
        null,
        100,
        20,
        randomUUID(),
      ]
    )
    assert.equal(emptyPage.total, 3)
    assert.deepEqual(emptyPage.items, [])
    await assert.rejects(
      record(user.id, user.email, "email", "failed", "raw error and password"),
      { message: "VALIDATION_ERROR" }
    )
  })

  test("重置准备仅授权读邮箱，原生请求成功后才记录请求成功", async () => {
    const user = await seed()
    const request = randomUUID()
    const read = await result(
      "SELECT public.prepare_platform_password_reset($1,$2,$3,$4) AS result",
      [admin.id, admin.session, user.id, request]
    )
    assert.deepEqual(read, { userId: user.id, email: user.email })
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM public.audit_events WHERE request_id=$1",
          [request]
        )
      ).rows[0].n,
      0
    )
    await assert.rejects(
      runtime.query(
        "SELECT public.prepare_platform_password_reset($1,$2,$3,$4)",
        [auditor.id, auditor.session, user.id, randomUUID()]
      ),
      { message: "FORBIDDEN" }
    )
    await runtime.query(
      "SELECT public.record_platform_password_reset_requested($1,$2,$3,$4)",
      [admin.id, admin.session, user.id, request]
    )
    assert.equal(
      (
        await owner.query(
          "SELECT event_code FROM public.audit_events WHERE request_id=$1",
          [request]
        )
      ).rows[0].event_code,
      "platform.user_password_reset_requested"
    )
    const audit = await result(
      "SELECT public.list_platform_audit_events($1,$2,NULL,NULL,NULL,NULL,$3,NULL,1,20,$4) AS result",
      [
        admin.id,
        admin.session,
        "platform.user_password_reset_requested",
        randomUUID(),
      ]
    )
    assert.ok(
      (audit.items as Record<string, unknown>[]).some(
        (row) => row.resourceId === user.id
      )
    )
  })

  test("审计写入失败原子回滚新账号、状态与会话删除", async () => {
    const user = await seed()
    const email = randomUUID() + "@test.example"
    await owner.query(
      "CREATE FUNCTION public.reject_identity_test_audit() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''injected audit failure''; END;'"
    )
    await owner.query(
      "CREATE TRIGGER reject_identity_test_audit BEFORE INSERT ON public.audit_events FOR EACH ROW WHEN (NEW.request_id='force-identity-audit-failure') EXECUTE FUNCTION public.reject_identity_test_audit()"
    )
    try {
      await assert.rejects(
        runtime.query("SELECT public.create_platform_user($1,$2,$3,$4,$5,$6)", [
          admin.id,
          admin.session,
          "Atomic",
          email,
          await hashPassword("Identity-Test-123!"),
          "force-identity-audit-failure",
        ]),
        { message: "AUDIT_UNAVAILABLE" }
      )
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int AS n FROM public."user" WHERE email=$1',
            [email]
          )
        ).rows[0].n,
        0
      )
      await assert.rejects(
        status(user, "suspended", 1, "force-identity-audit-failure"),
        { message: "AUDIT_UNAVAILABLE" }
      )
      assert.deepEqual(
        (
          await owner.query(
            "SELECT status,version FROM public.user_account_status WHERE user_id=$1",
            [user.id]
          )
        ).rows[0],
        { status: "active", version: 1 }
      )
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS n FROM public.session WHERE user_id=$1",
            [user.id]
          )
        ).rows[0].n,
        1
      )
    } finally {
      await owner.query(
        "DROP TRIGGER reject_identity_test_audit ON public.audit_events"
      )
      await owner.query("DROP FUNCTION public.reject_identity_test_audit()")
    }
  })
  test("原生改名先持 user 行时，平台等待后报告版本冲突而不死锁", async () => {
    const user = await seed()
    const native = await runtime.connect()
    const platform = await runtime.connect()
    let pending: Promise<unknown> | undefined
    try {
      const pid = (await platform.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid
      await native.query("BEGIN")
      await native.query(
        'SELECT id FROM public."user" WHERE id=$1 FOR UPDATE',
        [user.id]
      )
      pending = assert.rejects(
        platform.query("SELECT public.update_platform_user($1,$2,$3,$4,1,$5)", [
          admin.id,
          admin.session,
          user.id,
          "Platform Name",
          randomUUID(),
        ]),
        { message: "VERSION_CONFLICT" }
      )
      await vi.waitFor(
        async () => {
          assert.equal(
            (
              await owner.query(
                "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
                [pid]
              )
            ).rows[0].wait_event_type,
            "Lock"
          )
        },
        { timeout: 3000, interval: 20 }
      )
      await native.query('UPDATE public."user" SET name=$1 WHERE id=$2', [
        "Native Name",
        user.id,
      ])
      await native.query("COMMIT")
      await pending
      assert.equal(
        (
          await owner.query('SELECT name FROM public."user" WHERE id=$1', [
            user.id,
          ])
        ).rows[0].name,
        "Native Name"
      )
    } finally {
      await native.query("ROLLBACK")
      await pending
      native.release()
      platform.release()
    }
  })

  test("暂停事务之后的原生 session INSERT 等待提交并拒绝，恢复不复活", async () => {
    const user = await seed()
    const suspender = await runtime.connect()
    const native = await runtime.connect()
    let pending: Promise<unknown> | undefined
    try {
      const pid = (await native.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid
      await suspender.query("BEGIN")
      await suspender.query(
        "SELECT public.set_platform_user_status($1,$2,$3,'suspended',1,$4)",
        [admin.id, admin.session, user.id, randomUUID()]
      )
      pending = assert.rejects(
        native.query(
          "INSERT INTO public.session(id,user_id,token,updated_at,expires_at) VALUES($1,$2,$3,now(),now()+interval '1 day')",
          [randomUUID(), user.id, randomUUID()]
        ),
        { message: "ACCOUNT_SUSPENDED" }
      )
      await vi.waitFor(
        async () => {
          assert.equal(
            (
              await owner.query(
                "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
                [pid]
              )
            ).rows[0].wait_event_type,
            "Lock"
          )
        },
        { timeout: 3000, interval: 20 }
      )
      await suspender.query("COMMIT")
      await pending
      await status(user, "active", 2)
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS n FROM public.session WHERE user_id=$1",
            [user.id]
          )
        ).rows[0].n,
        0
      )
    } finally {
      await suspender.query("ROLLBACK")
      await pending
      suspender.release()
      native.release()
    }
  })

  test("原生 session 续期与暂停 DELETE 以行锁串行，不反向等待状态锁", async () => {
    const user = await seed()
    const native = await runtime.connect()
    const suspender = await runtime.connect()
    let pending: Promise<unknown> | undefined
    try {
      const pid = (await suspender.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid
      await native.query("BEGIN")
      await native.query(
        "SELECT id FROM public.session WHERE id=$1 FOR UPDATE",
        [user.session]
      )
      pending = suspender.query(
        "SELECT public.set_platform_user_status($1,$2,$3,'suspended',1,$4)",
        [admin.id, admin.session, user.id, randomUUID()]
      )
      await vi.waitFor(
        async () => {
          assert.equal(
            (
              await owner.query(
                "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
                [pid]
              )
            ).rows[0].wait_event_type,
            "Lock"
          )
        },
        { timeout: 3000, interval: 20 }
      )
      await native.query(
        "UPDATE public.session SET expires_at=now()+interval '2 days',updated_at=now() WHERE id=$1",
        [user.session]
      )
      await native.query("COMMIT")
      await pending
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS n FROM public.session WHERE user_id=$1",
            [user.id]
          )
        ).rows[0].n,
        0
      )
      assert.equal(
        (
          await runtime.query(
            "UPDATE public.session SET updated_at=now() WHERE id=$1",
            [user.session]
          )
        ).rowCount,
        0
      )
    } finally {
      await native.query("ROLLBACK")
      await pending
      native.release()
      suspender.release()
    }
    const other = await seed()
    const target = await seed()
    await assert.rejects(
      runtime.query("UPDATE public.session SET user_id=$1 WHERE id=$2", [
        other.id,
        target.session,
      ]),
      { message: "VALIDATION_ERROR" }
    )
  })
})
