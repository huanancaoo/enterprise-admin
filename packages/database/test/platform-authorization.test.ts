import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { resolve } from "node:path"
import { readFile } from "node:fs/promises"
import { afterAll, beforeAll, describe, test, vi } from "vitest"
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers"
import { Pool } from "pg"
import type { SecondaryStorage } from "better-auth"
import { platformPermissions } from "@workspace/permissions"
import { createAuth, noopAuthEmailHooks } from "../src/auth.ts"
import { createDatabase } from "../src/index.ts"
import {
  createPlatformAdmin,
  managePlatformAssignment,
} from "../src/platform-assignment-admin.ts"
import { runWithAuthRequestContext } from "../src/auth-request-context.ts"

const databaseRoot = resolve(import.meta.dirname, "..")
const workspace = resolve(databaseRoot, "../..")
const exec = promisify(execFile)
const baseURL = "http://localhost:3000"
const origins = ["http://localhost:3200", "http://localhost:3201"]
const password = "Platform-Authorization-123!"
const wrongPassword = "Incorrect-Password-123!"
type Principal = {
  id: string
  email: string
  session: string
  token: string
  cookie: string
}
type NativeAccount = { id: string; email: string }
type Role = { id: string; key: string }

function memorySecondaryStorage(): SecondaryStorage {
  const store = new Map<string, { value: string; expiresAt?: number }>()
  const get = (key: string) => {
    const item = store.get(key)
    if (
      !item ||
      (item.expiresAt !== undefined && item.expiresAt <= Date.now())
    ) {
      store.delete(key)
      return null
    }
    return item.value
  }
  return {
    get: async (key) => get(key),
    getAndDelete: async (key) => {
      const value = get(key)
      store.delete(key)
      return value
    },
    set: async (key, value, ttl) => {
      store.set(key, {
        value,
        ...(ttl === undefined ? {} : { expiresAt: Date.now() + ttl * 1000 }),
      })
    },
    delete: async (key) => {
      store.delete(key)
    },
    increment: async (key, ttl) => {
      const previous = get(key)
      const item = store.get(key)
      const next = Number(previous ?? 0) + 1
      store.set(key, {
        value: String(next),
        expiresAt: item?.expiresAt ?? Date.now() + ttl * 1000,
      })
      return next
    },
  }
}

function cookies(previous: string, response: Response) {
  const values = new Map(
    previous
      .split("; ")
      .filter(Boolean)
      .map((item) => {
        const delimiter = item.indexOf("=")
        return [item.slice(0, delimiter), item.slice(delimiter + 1)]
      })
  )
  for (const item of response.headers.getSetCookie()) {
    const first = item.split(";")[0]!
    const delimiter = first.indexOf("=")
    const name = first.slice(0, delimiter)
    if (/max-age=0(?:;|$)/i.test(item)) values.delete(name)
    else values.set(name, first.slice(delimiter + 1))
  }
  return [...values].map(([name, value]) => name + "=" + value).join("; ")
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  const bits = [...secret.toUpperCase().replace(/=+$/, "")]
    .map((character) =>
      alphabet.indexOf(character).toString(2).padStart(5, "0")
    )
    .join("")
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, index) =>
      Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)
    )
  )
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const digest = createHmac("sha1", key).update(counter).digest()
  return (
    (digest.readUInt32BE(digest[digest.length - 1]! & 15) & 0x7fffffff) %
    1_000_000
  )
    .toString()
    .padStart(6, "0")
}

function authWork<T>(work: () => T | Promise<T>) {
  return runWithAuthRequestContext(
    {
      requestId: randomUUID(),
      clientIp: `10.${[...randomBytes(3)].join(".")}`,
      userAgent: "Platform authorization database acceptance",
    },
    work
  )
}

function isDatabaseError(expected: string) {
  return (error: unknown) =>
    error instanceof Error && error.message === expected
}

describe(
  "平台多角色授权与账号密码锁（真实 PostgreSQL / Better Auth）",
  { concurrent: false },
  () => {
    let container: StartedTestContainer | undefined
    let owner: Pool
    let runtime: Pool
    let deployer: Pool
    let auth: ReturnType<typeof createAuth>
    let supers: Principal[]
    let organization: string

    async function account(verified = true): Promise<NativeAccount> {
      const email = `${randomUUID()}@platform-auth.test`
      const registered = await authWork(() =>
        auth.api.signUpEmail({
          body: { name: "Authorization account", email, password },
        })
      )
      if (verified)
        await owner.query(
          'UPDATE public."user" SET email_verified=true WHERE id=$1',
          [registered.user.id]
        )
      return { id: registered.user.id, email }
    }

    async function signIn(
      target: NativeAccount,
      value = password,
      origin = origins[0]!
    ) {
      return authWork(() =>
        auth.api.signInEmail({
          body: { email: target.email, password: value },
          headers: new Headers({ origin }),
          asResponse: true,
        })
      )
    }

    async function principal(target?: NativeAccount): Promise<Principal> {
      const current = target ?? (await account())
      const response = await signIn(current)
      assert.equal(response.status, 200, await response.clone().text())
      const body = (await response.json()) as { token: string }
      const session = (
        await runtime.query<{ id: string }>(
          "SELECT id FROM public.session WHERE token=$1 AND user_id=$2",
          [body.token, current.id]
        )
      ).rows[0]!
      return {
        ...current,
        token: body.token,
        session: session.id,
        cookie: cookies("", response),
      }
    }

    const assign = (
      user: NativeAccount,
      role: Role | { key: string },
      action = "grant"
    ) =>
      deployer.query(
        "SELECT public.manage_platform_assignment($1,$2::uuid,$3,$4)",
        [action, user.id, role.key, "Platform authorization real database test"]
      )

    async function role(permissions: string[]): Promise<Role> {
      return (
        await owner.query<Role>(
          "INSERT INTO public.platform_role(key,name,permissions) VALUES($1,$2,$3) RETURNING id,key",
          [`test_${randomUUID()}`, "Test role", permissions]
        )
      ).rows[0]!
    }

    async function access(user: Principal) {
      return (
        await runtime.query<{
          roles: Array<{ id: string; key: string }>
          permissions: string[]
        }>("SELECT * FROM public.read_platform_access($1,$2)", [
          user.id,
          user.session,
        ])
      ).rows[0]!
    }

    async function lockState(user: NativeAccount) {
      const record = (
        await owner.query<{
          failures: number
          locked_until: Date | null
          failure_times: Date[]
        }>(
          "SELECT cardinality(failure_times) AS failures, locked_until, failure_times FROM public.password_login_lock WHERE user_id=$1",
          [user.id]
        )
      ).rows[0]
      assert.ok(record, "真实登录必须建立此账号的锁定状态行")
      return record
    }

    async function fail(user: NativeAccount, times: number) {
      for (let index = 0; index < times; index++) {
        const response = await signIn(user, wrongPassword, origins[index % 2]!)
        assert.equal((await response.json()).code, "INVALID_EMAIL_OR_PASSWORD")
      }
    }

    async function sessionIds(user: NativeAccount) {
      return (
        await owner.query<{ id: string }>(
          "SELECT id FROM public.session WHERE user_id=$1 ORDER BY id",
          [user.id]
        )
      ).rows.map((value) => value.id)
    }

    async function nativePost(path: string, body: unknown, cookie = "") {
      return authWork(() =>
        auth.handler(
          new Request(`${baseURL}/api/auth/${path}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: origins[0]!,
              cookie,
              "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
            },
            body: JSON.stringify(body),
          })
        )
      )
    }

    beforeAll(async () => {
      const versions = JSON.parse(
        await readFile(
          resolve(workspace, "docs/architecture/versions.json"),
          "utf8"
        )
      )
      const secrets = Array.from({ length: 5 }, () =>
        randomBytes(24).toString("hex")
      )
      container = await new GenericContainer(
        versions.releaseFoundation.postgresql.image
      )
        .withEnvironment({
          POSTGRES_USER: "bootstrap_admin",
          POSTGRES_DB: "enterprise_admin",
          POSTGRES_PASSWORD: secrets[0]!,
          APP_MIGRATOR_PASSWORD: secrets[1]!,
          APP_RUNTIME_PASSWORD: secrets[2]!,
          PLATFORM_RUNTIME_PASSWORD: secrets[3]!,
          PLATFORM_DEPLOYER_PASSWORD: secrets[4]!,
        })
        .withCopyFilesToContainer([
          {
            source: resolve(workspace, "infra/postgres/bootstrap.sql"),
            target: "/docker-entrypoint-initdb.d/001-bootstrap.sql",
          },
        ])
        .withExposedPorts(5432)
        .withWaitStrategy(
          Wait.forLogMessage(
            "database system is ready to accept connections",
            2
          )
        )
        .start()
      const url = (user: string, secret: string) =>
        `postgresql://${user}:${secret}@${container!.getHost()}:${container!.getMappedPort(5432)}/enterprise_admin`
      owner = new Pool({
        connectionString: url("bootstrap_admin", secrets[0]!),
      })
      runtime = createDatabase(url("app_runtime", secrets[2]!)).pool
      deployer = new Pool({
        connectionString: url("platform_deployer", secrets[4]!),
      })
      const migrate = () =>
        exec(process.execPath, [resolve(databaseRoot, "src/migrate.ts")], {
          cwd: databaseRoot,
          env: {
            PATH: process.env.PATH,
            MIGRATION_DATABASE_URL: url("app_migrator", secrets[1]!),
          },
          maxBuffer: 8 * 1024 * 1024,
        })
      await migrate()
      await migrate()
      auth = createAuth(
        runtime,
        baseURL,
        randomBytes(32).toString("hex"),
        origins,
        noopAuthEmailHooks,
        memorySecondaryStorage(),
        [],
        {
          clientId: "test-github-client-id",
          clientSecret: "test-github-client-secret",
        }
      )
      supers = []
      for (let index = 0; index < 2; index++) {
        const email = `${randomUUID()}@super-auth.test`
        const id = await createPlatformAdmin(deployer, {
          email,
          password,
          name: `Super ${index}`,
          reason: "Platform authorization database acceptance",
        })
        supers.push(await principal({ id, email }))
      }
      const createdOrganization = await authWork(() =>
        auth.api.createOrganization({
          body: { name: "Authorization organization", slug: randomUUID() },
          headers: new Headers({ cookie: supers[0]!.cookie }),
        })
      )
      assert.ok(createdOrganization)
      organization = createdOrganization.id
    }, 180_000)

    afterAll(async () => {
      await Promise.all([owner?.end(), runtime?.end(), deployer?.end()])
      await container?.stop()
    })

    test("新表没有runtime/deployer直接权限，固定函数保持最小执行权限与安全配置", async () => {
      assert.deepEqual(
        (
          await runtime.query(
            "SELECT public.platform_permission_catalog() AS actions"
          )
        ).rows[0].actions.sort(),
        [...platformPermissions].sort()
      )
      for (const name of [
        "platform_role",
        "platform_assignment_role",
        "password_login_lock",
      ]) {
        await assert.rejects(runtime.query(`SELECT * FROM public.${name}`), {
          code: "42501",
        })
        await assert.rejects(deployer.query(`SELECT * FROM public.${name}`), {
          code: "42501",
        })
        const flags = (
          await owner.query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
            [name]
          )
        ).rows[0]
        assert.deepEqual(flags, {
          relrowsecurity: true,
          relforcerowsecurity: true,
        })
      }
      const rows = (
        await owner.query(
          "SELECT p.proname,p.prosecdef,p.proconfig,r.rolname,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE') AS public FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY($1)",
          [
            [
              "read_platform_access",
              "require_platform_action",
              "manage_platform_assignment",
              "begin_password_login",
              "finish_password_login",
              "unlock_platform_password_login",
            ],
          ]
        )
      ).rows
      assert.equal(rows.length, 6)
      for (const row of rows) {
        assert.equal(row.prosecdef, true)
        assert.equal(row.rolname, "platform_executor")
        assert.equal(row.public, false)
        assert.ok(row.proconfig.includes("search_path=pg_catalog"))
        assert.ok(row.proconfig.includes("row_security=on"))
      }
    })

    test("缺失动作不能通过数据库三值逻辑绕过授权", async () => {
      await assert.rejects(
        owner.query("SELECT public.require_platform_action($1,$2,NULL)", [
          supers[0]!.id,
          supers[0]!.session,
        ]),
        isDatabaseError("FORBIDDEN")
      )
    })

    test("多角色按并集去重；CLI grant additive，revoke仅移除指定角色；同一Session下次请求立即生效", async () => {
      const user = await principal()
      const first = await role([
        "platform.organization:read",
        "platform.user:read",
      ])
      const second = await role(["platform.user:read", "platform.session:read"])
      await assign(user, first)
      await assign(user, second)
      const combined = await access(user)
      assert.deepEqual(
        combined.roles.map((item) => item.key).sort(),
        [first.key, second.key].sort()
      )
      assert.deepEqual(combined.permissions, [
        "platform.organization:read",
        "platform.session:read",
        "platform.user:read",
      ])
      await runtime.query(
        "SELECT public.list_platform_sessions($1,$2,NULL,NULL,1,20,$3)",
        [user.id, user.session, randomUUID()]
      )
      await assign(user, second, "revoke")
      assert.deepEqual((await access(user)).permissions, [
        "platform.organization:read",
        "platform.user:read",
      ])
      await assert.rejects(
        runtime.query(
          "SELECT public.list_platform_sessions($1,$2,NULL,NULL,1,20,$3)",
          [user.id, user.session, randomUUID()]
        ),
        isDatabaseError("FORBIDDEN")
      )
      assert.deepEqual(
        (await access(user)).roles.map((item) => item.key),
        [first.key]
      )
      await owner.query(
        "UPDATE public.platform_role SET status='suspended' WHERE id=$1",
        [first.id]
      )
      assert.deepEqual((await access(user)).permissions, [])
      assert.equal(
        (
          await auth.api.getSession({
            headers: new Headers({ cookie: user.cookie }),
          })
        )?.session.id,
        user.session
      )
      // 停用只暂时移除角色权限；撤销关联后再启用角色也不能恢复这名员工的授权。
      await assign(user, first, "revoke")
      await owner.query(
        "UPDATE public.platform_role SET status='active' WHERE id=$1",
        [first.id]
      )
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS count FROM public.platform_assignment_role WHERE user_id=$1",
            [user.id]
          )
        ).rows[0].count,
        0
      )
      assert.equal(await access(user), undefined)
      // 这两个内置key同时走导出的CLI库，避免只验证固定SQL而漏掉库的旧单角色实现。
      await managePlatformAssignment(deployer, "grant", {
        userId: user.id,
        role: "platform_auditor",
        reason: "CLI additive assignment assertion",
      })
      assert.ok(
        (await access(user)).roles.some(
          (item) => item.key === "platform_auditor"
        )
      )
      await managePlatformAssignment(deployer, "revoke", {
        userId: user.id,
        role: "platform_auditor",
        reason: "CLI single role revocation assertion",
      })
      assert.equal(await access(user), undefined)
    })

    test("tenant成员/角色不会产生平台权限，停用任职丢弃角色且恢复不恢复角色", async () => {
      const user = await principal()
      const tenantOrganization = await authWork(() =>
        auth.api.createOrganization({
          body: { name: "Tenant owner only", slug: randomUUID() },
          headers: new Headers({ cookie: user.cookie }),
        })
      )
      assert.ok(tenantOrganization)
      assert.equal(await access(user), undefined)
      await assert.rejects(
        runtime.query("SELECT public.list_platform_users($1,$2,NULL,1,20,$3)", [
          user.id,
          user.session,
          randomUUID(),
        ]),
        isDatabaseError("FORBIDDEN")
      )
      const assigned = await role(["platform.user:read"])
      await assign(user, assigned)
      await owner.query(
        "UPDATE public.platform_assignment SET status='suspended',revoked_at=clock_timestamp(),revoked_by='acceptance',revoke_reason='Suspend platform assignment only' WHERE user_id=$1",
        [user.id]
      )
      assert.equal(await access(user), undefined)
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS count FROM public.platform_assignment_role WHERE user_id=$1",
            [user.id]
          )
        ).rows[0].count,
        0
      )
      await owner.query(
        "UPDATE public.platform_assignment SET status='active',revoked_at=NULL,revoked_by=NULL,revoke_reason=NULL WHERE user_id=$1",
        [user.id]
      )
      assert.deepEqual((await access(user)).permissions, [])
      assert.equal(
        (
          await owner.query(
            "SELECT role FROM public.member WHERE organization_id=$1 AND user_id=$2",
            [tenantOrganization.id, user.id]
          )
        ).rows[0].role,
        "owner"
      )
      assert.equal(
        (
          await auth.api.getSession({
            headers: new Headers({ cookie: user.cookie }),
          })
        )?.session.id,
        user.session
      )
    })

    test("新员工身份、密码、任职、多角色和审计原子提交；失败不污染既有账号", async () => {
      const roles = [
        await role(["platform.employee:read"]),
        await role(["platform.user:read"]),
      ]
      const email = `${randomUUID()}@employee-auth.test`
      const hash = await (await auth.$context).password.hash(password)
      const invalidRequest = randomUUID()
      await assert.rejects(
        runtime.query(
          "SELECT public.create_platform_employee($1,$2,$3,'Employee',$4,$5::uuid[],'Atomic employee assertion',$6)",
          [
            supers[0]!.id,
            supers[0]!.session,
            email,
            hash,
            [randomUUID()],
            invalidRequest,
          ]
        ),
        isDatabaseError("VALIDATION_ERROR")
      )
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int AS count FROM public."user" WHERE email=$1',
            [email]
          )
        ).rows[0].count,
        0
      )
      const request = randomUUID()
      const id = (
        await runtime.query<{ id: string }>(
          "SELECT public.create_platform_employee($1,$2,$3,'Employee',$4,$5::uuid[],'Atomic employee assertion',$6) AS id",
          [
            supers[0]!.id,
            supers[0]!.session,
            email,
            hash,
            roles.map((item) => item.id),
            request,
          ]
        )
      ).rows[0]!.id
      const employee = await principal({ id, email })
      assert.deepEqual((await access(employee)).permissions, [
        "platform.employee:read",
        "platform.user:read",
      ])
      assert.equal(
        (
          await owner.query(
            'SELECT email_verified FROM public."user" WHERE id=$1',
            [id]
          )
        ).rows[0].email_verified,
        true
      )
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS count FROM public.account WHERE user_id=$1 AND provider_id='credential'",
            [id]
          )
        ).rows[0].count,
        1
      )
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS count FROM public.audit_events WHERE request_id=$1 AND event_code='platform.employee_created' AND resource_id=$2",
            [request, id]
          )
        ).rows[0].count,
        1
      )
      const duplicateRequest = randomUUID()
      await assert.rejects(
        runtime.query(
          "SELECT public.create_platform_employee($1,$2,$3,'Duplicate',$4,$5::uuid[],'Duplicate employee assertion',$6)",
          [
            supers[0]!.id,
            supers[0]!.session,
            email,
            hash,
            roles.map((item) => item.id),
            duplicateRequest,
          ]
        ),
        isDatabaseError("EMAIL_ALREADY_EXISTS")
      )
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS count FROM public.account WHERE user_id=$1 AND provider_id='credential'",
            [id]
          )
        ).rows[0].count,
        1
      )
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS count FROM public.audit_events WHERE request_id=$1",
            [duplicateRequest]
          )
        ).rows[0].count,
        0
      )
    })

    test("旧固定函数全部声明准确动作，不残留固定role或sensitive布尔门禁", async () => {
      const expected: Record<string, string> = {
        list_platform_organizations: "platform.organization:read",
        get_platform_organization: "platform.organization:read",
        transition_platform_organization: "platform.organization:update",
        list_platform_users: "platform.user:read",
        get_platform_user: "platform.user:read",
        get_platform_sensitive_profile: "platform.user:readSensitive",
        list_platform_audit_events: "platform.audit:read",
        get_platform_audit_event: "platform.audit:read",
        get_platform_settings: "platform.settings:read",
        update_platform_settings: "platform.settings:update",
        get_platform_storage_policy: "platform.settings:read",
        update_platform_storage_policy: "platform.settings:update",
        create_platform_user: "platform.user:create",
        update_platform_user: "platform.user:update",
        set_platform_user_status: "platform.user:suspend",
        prepare_platform_password_reset: "platform.user:resetPassword",
        record_platform_password_reset_requested: "platform.user:resetPassword",
        list_platform_login_logs: "platform.login:read",
        list_platform_sessions: "platform.session:read",
        revoke_platform_session: "platform.session:revoke",
      }
      const rows = (
        await owner.query<{ proname: string; definition: string }>(
          "SELECT proname,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1::text[])",
          [Object.keys(expected)]
        )
      ).rows
      assert.equal(rows.length, Object.keys(expected).length)
      for (const row of rows) {
        const compact = row.definition.replace(/\s+/g, "")
        assert.ok(compact.includes(`'${expected[row.proname]}'`), row.proname)
        assert.doesNotMatch(
          row.definition,
          /require_platform_(?:user|organization)_access|v_role\s*(?:<>|!=|=)\s*'platform_admin'/
        )
      }
      const oldHelpers = (
        await owner.query(
          "SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1::text[])",
          [
            [
              "require_platform_user_access",
              "require_platform_organization_access",
              "precheck_platform_identity_write",
            ],
          ]
        )
      ).rows
      assert.deepEqual(oldHelpers, [])
    })

    test("真实runtime逐个函数验证精确action，角色拥有其他权限不能越权", async () => {
      const actor = await principal()
      const exactRole = await role([])
      await assign(actor, exactRole)
      const target = await principal()
      const calls: Array<{
        action: string
        sql: string
        tail: unknown[]
        error?: string
      }> = [
        {
          action: "platform.organization:read",
          sql: "list_platform_organizations($1,$2,NULL,NULL,1,20,'name','asc',$3)",
          tail: [randomUUID()],
        },
        {
          action: "platform.organization:read",
          sql: "get_platform_organization($1,$2,$3,$4)",
          tail: [organization, randomUUID()],
        },
        {
          action: "platform.organization:update",
          sql: "transition_platform_organization($1,$2,$3,'invalid','Permission gate assertion',1,$4,$5)",
          tail: [organization, randomUUID(), randomUUID()],
          error: "VALIDATION_ERROR",
        },
        {
          action: "platform.user:read",
          sql: "list_platform_users($1,$2,NULL,1,20,$3)",
          tail: [randomUUID()],
        },
        {
          action: "platform.user:read",
          sql: "get_platform_user($1,$2,$3,$4)",
          tail: [target.id, randomUUID()],
        },
        {
          action: "platform.user:readSensitive",
          sql: "get_platform_sensitive_profile($1,$2,$3,'Permission gate assertion',$4)",
          tail: [target.id, randomUUID()],
        },
        {
          action: "platform.user:create",
          sql: "create_platform_user($1,$2,'','','',$3)",
          tail: [randomUUID()],
          error: "VALIDATION_ERROR",
        },
        {
          action: "platform.user:update",
          sql: "update_platform_user($1,$2,$3,'',1,$4)",
          tail: [target.id, randomUUID()],
          error: "VALIDATION_ERROR",
        },
        {
          action: "platform.user:suspend",
          sql: "set_platform_user_status($1,$2,$3,'invalid',1,$4)",
          tail: [target.id, randomUUID()],
          error: "VALIDATION_ERROR",
        },
        {
          action: "platform.user:resetPassword",
          sql: "prepare_platform_password_reset($1,$2,$3,$4)",
          tail: [target.id, randomUUID()],
        },
        {
          action: "platform.user:resetPassword",
          sql: "record_platform_password_reset_requested($1,$2,$3,$4)",
          tail: [target.id, randomUUID()],
        },
        {
          action: "platform.audit:read",
          sql: "list_platform_audit_events($1,$2,NULL,NULL,NULL,NULL,NULL,NULL,1,20,$3)",
          tail: [randomUUID()],
        },
        {
          action: "platform.audit:read",
          sql: "get_platform_audit_event($1,$2,$3,$4)",
          tail: [`audit:${randomUUID()}`, randomUUID()],
          error: "VALIDATION_ERROR",
        },
        {
          action: "platform.settings:read",
          sql: "get_platform_settings($1,$2,$3)",
          tail: [randomUUID()],
        },
        {
          action: "platform.settings:read",
          sql: "get_platform_storage_policy($1,$2,$3,$4)",
          tail: [organization, randomUUID()],
        },
        {
          action: "platform.settings:update",
          sql: "update_platform_settings($1,$2,'invalid','Permission gate assertion',1,$3,$4)",
          tail: [randomUUID(), randomUUID()],
          error: "VALIDATION_ERROR",
        },
        {
          action: "platform.settings:update",
          sql: "update_platform_storage_policy($1,$2,$3,-1,1,1,'Permission gate assertion',1,$4,$5)",
          tail: [organization, randomUUID(), randomUUID()],
          error: "VALIDATION_ERROR",
        },
        {
          action: "platform.login:read",
          sql: "list_platform_login_logs($1,$2,NULL,NULL,NULL,NULL,NULL,NULL,1,20,$3)",
          tail: [randomUUID()],
        },
        {
          action: "platform.session:read",
          sql: "list_platform_sessions($1,$2,NULL,NULL,1,20,$3)",
          tail: [randomUUID()],
        },
        {
          action: "platform.session:revoke",
          sql: "revoke_platform_session($1,$2,$3,$4)",
          tail: [randomUUID(), randomUUID()],
        },
      ]
      for (const call of calls) {
        const execute = () =>
          runtime.query("SELECT public." + call.sql, [
            actor.id,
            actor.session,
            ...call.tail,
          ])
        await owner.query(
          "UPDATE public.platform_role SET permissions=$2::text[] WHERE id=$1",
          [
            exactRole.id,
            [
              call.action === "platform.user:read"
                ? "platform.session:read"
                : "platform.user:read",
            ],
          ]
        )
        await assert.rejects(execute(), isDatabaseError("FORBIDDEN"), call.sql)
        await owner.query(
          "UPDATE public.platform_role SET permissions=$2::text[] WHERE id=$1",
          [exactRole.id, [call.action]]
        )
        if (call.error)
          await assert.rejects(execute(), isDatabaseError(call.error), call.sql)
        else await execute()
      }
    })

    test("旧资源导出与列表读取分别授权，共享投影函数不向runtime开放", async () => {
      const operator = await principal()
      const resources = [
        {
          resource: "user",
          read: "list_platform_users",
          export: "export_platform_users_page",
          args: "NULL,1,20,$3",
        },
        {
          resource: "organization",
          read: "list_platform_organizations",
          export: "export_platform_organizations_page",
          args: "NULL,NULL,1,20,'name','asc',$3",
        },
        {
          resource: "login",
          read: "list_platform_login_logs",
          export: "export_platform_login_logs_page",
          args: "NULL,NULL,NULL,NULL,NULL,NULL,1,20,$3",
        },
        {
          resource: "session",
          read: "list_platform_sessions",
          export: "export_platform_sessions_page",
          args: "NULL,NULL,1,20,$3",
        },
        {
          resource: "audit",
          read: "list_platform_audit_events",
          export: "export_platform_audit_events_page",
          args: "NULL,NULL,NULL,NULL,'platform.user_created',NULL,1,20,$3",
        },
      ]
      const exportRole = await role(
        resources.map((item) => `platform.${item.resource}:export`)
      )
      await assign(operator, exportRole)
      const call = (fn: string, args: string) =>
        runtime.query<{ result: { items: unknown[]; total: number } }>(
          `SELECT public.${fn}($1,$2,${args}) AS result`,
          [operator.id, operator.session, randomUUID()]
        )
      for (const item of resources) {
        await assert.rejects(
          call(item.read, item.args),
          isDatabaseError("FORBIDDEN")
        )
        const page = (await call(item.export, item.args)).rows[0]!.result
        assert.ok(Array.isArray(page.items))
        assert.equal(typeof page.total, "number")
      }
      await owner.query(
        "UPDATE public.platform_role SET permissions=$2::text[] WHERE id=$1",
        [
          exportRole.id,
          resources.map((item) => `platform.${item.resource}:read`),
        ]
      )
      for (const item of resources) {
        assert.ok(
          Array.isArray(
            (await call(item.read, item.args)).rows[0]!.result.items
          )
        )
        await assert.rejects(
          call(item.export, item.args),
          isDatabaseError("FORBIDDEN")
        )
      }
      const helpers = (
        await owner.query(
          "SELECT has_function_privilege('app_runtime',oid,'EXECUTE') AS runtime,EXISTS(SELECT 1 FROM aclexplode(COALESCE(proacl,acldefault('f',proowner))) WHERE grantee=0 AND privilege_type='EXECUTE') AS public FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'read_platform_%_for_action'"
        )
      ).rows
      assert.equal(helpers.length, 5)
      for (const helper of helpers)
        assert.deepEqual(helper, { runtime: false, public: false })
    })

    test("内置super不可改名/停用/改权限/删除，普通角色不能取得授权管理保留权限", async () => {
      for (const sql of [
        "UPDATE public.platform_role SET name='changed' WHERE key='platform_admin'",
        "UPDATE public.platform_role SET status='suspended' WHERE key='platform_admin'",
        "UPDATE public.platform_role SET permissions='{}' WHERE key='platform_admin'",
        "DELETE FROM public.platform_role WHERE key='platform_admin'",
      ]) {
        await assert.rejects(
          owner.query(sql),
          isDatabaseError("BUILT_IN_ROLE_IMMUTABLE")
        )
      }
      await assert.rejects(
        role(["platform.authorization:manage"]),
        isDatabaseError("VALIDATION_ERROR")
      )
      await assert.rejects(
        role(["platform.unknown:read"]),
        isDatabaseError("VALIDATION_ERROR")
      )
      await assert.rejects(
        owner.query(
          "INSERT INTO public.platform_role(key,name,built_in) VALUES($1,'Fake built in',true)",
          [`fake_${randomUUID()}`]
        ),
        isDatabaseError("VALIDATION_ERROR")
      )
      assert.ok(
        (await access(supers[0]!)).permissions.includes(
          "platform.authorization:manage"
        )
      )
    })

    test("platform/tenant共享同账号失败计数，第5错锁定且正确密码不能绕过，不撤销已有Session", async () => {
      const user = await principal()
      const originalSessions = await sessionIds(user)
      await fail(user, 4)
      assert.equal((await lockState(user)).failures, 4)
      assert.equal((await lockState(user)).locked_until, null)
      await fail(user, 1)
      const state = await lockState(user)
      assert.equal(state.failures, 5)
      assert.ok(state.locked_until && state.locked_until > new Date())
      const denied = await signIn(user)
      assert.equal((await denied.json()).code, "PASSWORD_LOGIN_LOCKED")
      assert.deepEqual(await sessionIds(user), originalSessions)
      assert.equal(
        (
          await auth.api.getSession({
            headers: new Headers({ cookie: user.cookie }),
          })
        )?.user.id,
        user.id
      )
      const after = await lockState(user)
      assert.equal(
        after.locked_until?.toISOString(),
        state.locked_until?.toISOString()
      )
      assert.equal(after.failures, 5)
    })

    test("滚动窗口裁掉15分钟前失败；并发错密不丢计数且不会串到其他账号", async () => {
      const rolling = await principal()
      await owner.query(
        "UPDATE public.password_login_lock SET failure_times=ARRAY[clock_timestamp()-interval '16 minutes',clock_timestamp()-interval '14 minutes',clock_timestamp()-interval '8 minutes',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute'],locked_until=NULL WHERE user_id=$1",
        [rolling.id]
      )
      await fail(rolling, 1)
      assert.equal((await lockState(rolling)).failures, 5)
      assert.ok((await lockState(rolling)).locked_until)

      const concurrent = await principal()
      const other = await principal()
      const oldSessions = await sessionIds(concurrent)
      const [responses, accepted] = await Promise.all([
        Promise.all(
          Array.from({ length: 7 }, () => signIn(concurrent, wrongPassword))
        ),
        signIn(other),
      ])
      assert.equal(accepted.status, 200)
      const codes = await Promise.all(
        responses.map(async (response) => (await response.json()).code)
      )
      assert.equal(
        codes.filter((code) => code === "INVALID_EMAIL_OR_PASSWORD").length,
        5
      )
      assert.equal(
        codes.filter((code) => code === "PASSWORD_LOGIN_LOCKED").length,
        2
      )
      assert.equal((await lockState(concurrent)).failures, 5)
      assert.ok((await lockState(concurrent)).locked_until)
      assert.equal((await lockState(other)).failures, 0)
      assert.deepEqual(await sessionIds(concurrent), oldSessions)
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS count FROM public.password_login_lock WHERE user_id=$1",
            [concurrent.id]
          )
        ).rows[0].count,
        1
      )
    })

    test("密码成功立即清零；锁到期重新计数；未知邮箱不创建状态", async () => {
      const user = await principal()
      await fail(user, 4)
      assert.equal((await signIn(user)).status, 200)
      assert.equal((await lockState(user)).failures, 0)
      await fail(user, 5)
      await owner.query(
        "UPDATE public.password_login_lock SET locked_until=clock_timestamp()-interval '1 second' WHERE user_id=$1",
        [user.id]
      )
      await fail(user, 1)
      assert.equal((await lockState(user)).failures, 1)
      assert.equal((await lockState(user)).locked_until, null)
      const beforeUnknown = (
        await owner.query(
          "SELECT count(*)::int AS count FROM public.password_login_lock"
        )
      ).rows[0].count
      const unknown = await signIn(
        { id: randomUUID(), email: `${randomUUID()}@unknown.test` },
        wrongPassword
      )
      assert.equal((await unknown.json()).code, "INVALID_EMAIL_OR_PASSWORD")
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS count FROM public.password_login_lock"
          )
        ).rows[0].count,
        beforeUnknown
      )
    })

    test("只有unlock动作可解锁，解锁独立留痕且不修改已有Session", async () => {
      const target = await principal()
      const operator = await principal()
      const unlocker = await role(["platform.user:unlock"])
      const reader = await principal()
      await assign(operator, unlocker)
      await assign(reader, await role(["platform.user:read"]))
      await fail(target, 5)
      const sessions = await sessionIds(target)
      const deniedRequest = randomUUID()
      await assert.rejects(
        runtime.query(
          "SELECT public.unlock_platform_password_login($1,$2,$3,$4)",
          [reader.id, reader.session, target.id, deniedRequest]
        ),
        isDatabaseError("FORBIDDEN")
      )
      assert.ok((await lockState(target)).locked_until)
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS count FROM public.audit_events WHERE request_id=$1",
            [deniedRequest]
          )
        ).rows[0].count,
        0
      )
      const request = randomUUID()
      const unlocked = (
        await runtime.query<{
          result: { changed: boolean; lockedUntil: null }
        }>(
          "SELECT public.unlock_platform_password_login($1,$2,$3,$4) AS result",
          [operator.id, operator.session, target.id, request]
        )
      ).rows[0]!.result
      assert.equal(unlocked.changed, true)
      assert.equal(unlocked.lockedUntil, null)
      assert.equal((await lockState(target)).failures, 0)
      assert.equal((await lockState(target)).locked_until, null)
      const audit = (
        await owner.query(
          "SELECT actor_id,resource_id,event_code,result FROM public.audit_events WHERE request_id=$1",
          [request]
        )
      ).rows[0]
      assert.deepEqual(audit, {
        actor_id: operator.id,
        resource_id: target.id,
        event_code: "platform.user_password_login_unlocked",
        result: "succeeded",
      })
      assert.deepEqual(await sessionIds(target), sessions)
      assert.equal(
        (
          await auth.api.getSession({
            headers: new Headers({ cookie: target.cookie }),
          })
        )?.session.id,
        target.session
      )
      assert.equal((await signIn(target)).status, 200)
      const noChange = (
        await runtime.query<{ result: { changed: boolean } }>(
          "SELECT public.unlock_platform_password_login($1,$2,$3,$4) AS result",
          [operator.id, operator.session, target.id, randomUUID()]
        )
      ).rows[0]!.result
      assert.equal(noChange.changed, false)
    })

    test("解锁等待验密行锁时先与授权撤销串行，撤销提交后旧Session不能再解锁", async () => {
      const user = await principal()
      const operator = await principal()
      const unlockRole = await role(["platform.user:unlock"])
      await assign(operator, unlockRole)
      await fail(user, 5)
      const blocker = await owner.connect()
      const unlocking = await runtime.connect()
      const revoking = await deployer.connect()
      let pendingUnlock: Promise<unknown> | undefined
      let pendingRevoke: Promise<unknown> | undefined
      try {
        const unlockPid = (
          await unlocking.query("SELECT pg_backend_pid() AS pid")
        ).rows[0].pid
        const revokePid = (
          await revoking.query("SELECT pg_backend_pid() AS pid")
        ).rows[0].pid
        await blocker.query("BEGIN")
        await blocker.query(
          "SELECT user_id FROM public.password_login_lock WHERE user_id=$1 FOR UPDATE",
          [user.id]
        )
        pendingUnlock = unlocking.query(
          "SELECT public.unlock_platform_password_login($1,$2,$3,$4)",
          [operator.id, operator.session, user.id, randomUUID()]
        )
        const waitForLock = (pid: number) =>
          vi.waitFor(
            async () =>
              assert.equal(
                (
                  await owner.query(
                    "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
                    [pid]
                  )
                ).rows[0].wait_event_type,
                "Lock"
              ),
            { timeout: 3000, interval: 20 }
          )
        await waitForLock(unlockPid)
        pendingRevoke = revoking.query(
          "SELECT public.manage_platform_assignment('revoke',$1,$2,'revoke unlock during password verification')",
          [operator.id, unlockRole.key]
        )
        await waitForLock(revokePid)
        await blocker.query("COMMIT")
        await pendingUnlock
        await pendingRevoke
        await assert.rejects(
          runtime.query(
            "SELECT public.unlock_platform_password_login($1,$2,$3,$4)",
            [operator.id, operator.session, user.id, randomUUID()]
          ),
          isDatabaseError("FORBIDDEN")
        )
      } finally {
        await blocker.query("ROLLBACK")
        await Promise.allSettled([pendingUnlock, pendingRevoke].filter(Boolean))
        blocker.release()
        unlocking.release()
        revoking.release()
      }
    })

    test("平台登录日志实时投影锁状态，分页与历史不变，个人日志不扩展", async () => {
      const user = await principal()
      const record = async (
        actor: string | null,
        email: string,
        method: string
      ) =>
        (
          await runtime.query<{ id: string }>(
            "SELECT public.record_login_event($1,$2,$3,'failed','INVALID_CREDENTIALS',NULL,NULL,$4) AS id",
            [actor, email, method, randomUUID()]
          )
        ).rows[0]!.id
      await record(user.id, user.email, "github")
      await record(user.id, user.email, "totp")
      const anonymous = await record(
        null,
        `${randomUUID()}@unknown.test`,
        "email"
      )
      const unlocked = await principal()
      const historyBefore = (
        await owner.query(
          "SELECT to_jsonb(e) AS event FROM public.login_events e ORDER BY id"
        )
      ).rows
      await owner.query(
        "UPDATE public.password_login_lock SET failure_times=ARRAY[clock_timestamp()],locked_until=clock_timestamp()+interval '15 minutes' WHERE user_id=$1",
        [user.id]
      )
      const until = (await lockState(user)).locked_until!
      const actor = supers[0]!
      const read = (page: number, size: number, filter: string | null = null) =>
        runtime.query<{
          result: {
            items: Array<{
              id: string
              userId: string | null
              lockedUntil: string | null
            }>
            page: number
            pageSize: number
            total: number
          }
        }>(
          "SELECT public.list_platform_login_logs($1,$2,NULL,$3,NULL,NULL,NULL,NULL,$4,$5,$6) AS result",
          [actor.id, actor.session, filter, page, size, randomUUID()]
        )
      for (const page of [1, 2, 100]) {
        const current = (await read(page, 2, user.id)).rows[0]!.result
        const historic = (
          await owner.query(
            "SELECT public.read_login_events_page(NULL,$1,NULL,NULL,NULL,NULL,$2,2) AS result",
            [user.id, page]
          )
        ).rows[0].result
        assert.equal(current.total, historic.total)
        assert.equal(current.page, historic.page)
        assert.equal(current.pageSize, historic.pageSize)
        assert.deepEqual(
          current.items.map(({ lockedUntil, ...item }) => {
            assert.notEqual(lockedUntil, undefined)
            return item
          }),
          historic.items
        )
        for (const row of current.items)
          assert.equal(new Date(row.lockedUntil!).getTime(), until.getTime())
      }
      const all = (await read(1, 100)).rows[0]!.result
      assert.equal(
        all.items.find((row) => row.id === anonymous)!.lockedUntil,
        null
      )
      assert.equal(
        all.items.find((row) => row.userId === unlocked.id)!.lockedUntil,
        null
      )
      const personal = (
        await runtime.query(
          "SELECT public.list_personal_login_logs($1,$2,NULL,NULL,NULL,NULL,1,100,$3) AS result",
          [user.id, user.session, randomUUID()]
        )
      ).rows[0].result
      assert.ok(
        personal.items.every(
          (row: Record<string, unknown>) => !Object.hasOwn(row, "lockedUntil")
        )
      )
      const exporter = await principal()
      const exportRole = await role(["platform.login:export"])
      await assign(exporter, exportRole)
      const exported = (
        await runtime.query(
          "SELECT public.export_platform_login_logs_page($1,$2,NULL,$3,NULL,NULL,NULL,NULL,1,20,$4) AS result",
          [exporter.id, exporter.session, user.id, randomUUID()]
        )
      ).rows[0].result
      assert.ok(
        exported.items.every(
          (row: { lockedUntil: string }) =>
            new Date(row.lockedUntil).getTime() === until.getTime()
        )
      )
      await runtime.query(
        "SELECT public.unlock_platform_password_login($1,$2,$3,$4)",
        [actor.id, actor.session, user.id, randomUUID()]
      )
      assert.ok(
        (await read(1, 100, user.id)).rows[0]!.result.items.every(
          (row) => row.lockedUntil === null
        )
      )
      await owner.query(
        "UPDATE public.password_login_lock SET locked_until=clock_timestamp()-interval '1 second' WHERE user_id=$1",
        [user.id]
      )
      assert.ok(
        (await read(1, 100, user.id)).rows[0]!.result.items.every(
          (row) => row.lockedUntil === null
        )
      )
      const historyAfter = (
        await owner.query(
          "SELECT to_jsonb(e) AS event FROM public.login_events e WHERE user_id<>$1 OR user_id IS NULL ORDER BY id",
          [exporter.id]
        )
      ).rows
      assert.deepEqual(historyAfter, historyBefore)
    })

    test("正确密码即使随后邮箱未验证返回403，也会清零失败次数", async () => {
      const user = await principal()
      await fail(user, 4)
      await owner.query(
        'UPDATE public."user" SET email_verified=false WHERE id=$1',
        [user.id]
      )
      const result = await signIn(user)
      assert.equal((await result.json()).code, "EMAIL_NOT_VERIFIED")
      assert.equal((await lockState(user)).failures, 0)
      assert.equal((await lockState(user)).locked_until, null)
    })

    test("真实MFA挑战之前清零密码失败；原生MFA临时锁和已有Session保持独立", async () => {
      const user = await principal()
      const enabled = await nativePost(
        "two-factor/enable",
        { password, method: "totp" },
        user.cookie
      )
      assert.equal(enabled.status, 200, await enabled.clone().text())
      let cookie = cookies(user.cookie, enabled)
      const enrollment = (await enabled.json()) as { totpURI: string }
      const secret = new URL(enrollment.totpURI).searchParams.get("secret")!
      assert.ok(secret)
      const verified = await nativePost(
        "two-factor/verify-totp",
        { code: totp(secret) },
        cookie
      )
      assert.equal(verified.status, 200, await verified.clone().text())
      cookie = cookies(cookie, verified)
      const baselineSessions = await sessionIds(user)
      await fail(user, 4)
      const challenged = await signIn(user)
      assert.equal(challenged.status, 200)
      assert.equal((await challenged.json()).twoFactorRedirect, true)
      assert.equal((await lockState(user)).failures, 0)
      assert.deepEqual(await sessionIds(user), baselineSessions)
      assert.ok(
        (await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user
          .id === user.id
      )

      await owner.query(
        "UPDATE public.two_factor SET failed_verification_count=10,locked_until=(clock_timestamp()+interval '15 minutes') AT TIME ZONE 'UTC' WHERE user_id=$1",
        [user.id]
      )
      const nativeState = (
        await owner.query(
          "SELECT failed_verification_count,locked_until FROM public.two_factor WHERE user_id=$1",
          [user.id]
        )
      ).rows[0]
      await fail(user, 3)
      const lockedMfaChallenge = await signIn(user)
      assert.equal(
        (await lockedMfaChallenge.clone().json()).twoFactorRedirect,
        true
      )
      assert.equal((await lockState(user)).failures, 0)
      assert.deepEqual(
        (
          await owner.query(
            "SELECT failed_verification_count,locked_until FROM public.two_factor WHERE user_id=$1",
            [user.id]
          )
        ).rows[0],
        nativeState
      )
      const denied = await nativePost(
        "two-factor/verify-totp",
        { code: totp(secret) },
        cookies("", lockedMfaChallenge)
      )
      assert.equal((await denied.json()).code, "ACCOUNT_TEMPORARILY_LOCKED")
      assert.equal((await lockState(user)).failures, 0)
      assert.deepEqual(await sessionIds(user), baselineSessions)
    })

    test("并发撤销两位super时仅一位成功，最后一位撤权在提交时拒绝", async () => {
      const results = await Promise.allSettled(
        supers.map((user) =>
          managePlatformAssignment(deployer, "revoke", {
            userId: user.id,
            role: "platform_admin",
            reason: "Concurrent last superadmin acceptance",
          })
        )
      )
      assert.equal(
        results.filter((value) => value.status === "fulfilled").length,
        1
      )
      const rejected = results.find(
        (value) => value.status === "rejected"
      ) as PromiseRejectedResult
      assert.equal(rejected.reason.message, "LAST_PLATFORM_SUPERADMIN")
      const remaining = (
        await owner.query(
          "SELECT a.user_id FROM public.platform_assignment a JOIN public.platform_assignment_role ar ON ar.user_id=a.user_id JOIN public.platform_role r ON r.id=ar.role_id JOIN public.user_account_status s ON s.user_id=a.user_id WHERE a.status='active' AND s.status='active' AND r.key='platform_admin' AND r.status='active'"
        )
      ).rows
      assert.equal(remaining.length, 1)
    })

    test("暂停最后super全局账号被拒绝，状态、原生Session与审计在同一事务回滚", async () => {
      const remaining = (
        await owner.query<{ user_id: string }>(
          "SELECT a.user_id FROM public.platform_assignment a JOIN public.platform_assignment_role ar ON ar.user_id=a.user_id JOIN public.platform_role r ON r.id=ar.role_id WHERE a.status='active' AND r.key='platform_admin'"
        )
      ).rows[0]!
      const survivor = supers.find((user) => user.id === remaining.user_id)!
      const before = (
        await owner.query(
          "SELECT status,version FROM public.user_account_status WHERE user_id=$1",
          [survivor.id]
        )
      ).rows[0]
      const sessions = await sessionIds(survivor)
      const request = randomUUID()
      await assert.rejects(
        runtime.query(
          "SELECT public.set_platform_user_status($1,$2,$1,'suspended',$3,$4)",
          [survivor.id, survivor.session, before.version, request]
        ),
        isDatabaseError("LAST_PLATFORM_SUPERADMIN")
      )
      assert.deepEqual(
        (
          await owner.query(
            "SELECT status,version FROM public.user_account_status WHERE user_id=$1",
            [survivor.id]
          )
        ).rows[0],
        before
      )
      assert.deepEqual(await sessionIds(survivor), sessions)
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS count FROM public.audit_events WHERE request_id=$1",
            [request]
          )
        ).rows[0].count,
        0
      )
      assert.ok(
        (await access(survivor)).roles.some(
          (item) => item.key === "platform_admin"
        )
      )
    })
  }
)
