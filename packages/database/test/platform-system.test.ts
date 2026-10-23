import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { hashPassword, verifyPassword } from "better-auth/crypto"
import { Pool } from "pg"
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers"
import { afterAll, beforeAll, describe, test, vi } from "vitest"

const exec = promisify(execFile)
type Identity = { id: string; session: string; email: string }
type Input = Record<string, unknown>
type Catalog = {
  id: string
  key: string
  name: string
  status: string
  sort: number
  parentId: string | null
  hasChildren: boolean
  hidden: boolean
  permissions: string[]
  builtIn: boolean
  value: string
  label: string
}
type EmployeeReference = { id: string; name: string }
type EmployeeOption = EmployeeReference & { key: string; status: string }
type DepartmentOption = EmployeeOption & {
  parentId: string | null
  hasChildren: boolean
}
type EmployeeRoleReference = EmployeeReference & {
  key: string
  builtIn: boolean
}
type Employee = {
  userId: string
  name: string
  maskedEmail: string
  status: string
  version: number
  departmentId: string | null
  postIds: string[]
  roleIds: string[]
  department: EmployeeReference | null
  posts: EmployeeReference[]
  roles: EmployeeRoleReference[]
  lockedUntil: string | null
  failedAttempts: number
}
type Page<T> = { items: T[]; page: number; pageSize: number; total: number }
type Tree = { items: Catalog[]; ancestors: Catalog[] }
type CachedDictionary = { key: string; items: Catalog[]; version: number }
type CachedParameter = { key: string; value: string; version: number }

describe("平台系统管理固定函数", { concurrent: false }, () => {
  let container: StartedTestContainer | undefined
  let owner: Pool
  let runtime: Pool
  let fixture: string | undefined
  let admin: Identity
  let auditor: Identity
  let adminRole: string
  const legacyMenuRoleId = randomUUID()

  async function seed(name: string, roleKey?: string): Promise<Identity> {
    const id = randomUUID()
    const session = randomUUID()
    const email = id + "@test.example"
    await runtime.query(
      'INSERT INTO public."user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$2,$3,true,now(),now())',
      [id, name, email]
    )
    await runtime.query(
      "INSERT INTO public.session(id,user_id,token,updated_at,expires_at) VALUES($1,$2,$3,now(),now()+interval '1 day')",
      [session, id, randomBytes(24).toString("hex")]
    )
    if (roleKey) {
      await owner.query(
        "INSERT INTO public.platform_assignment(user_id,status,version,granted_at,granted_by,grant_reason) VALUES($1,'active',1,clock_timestamp(),'system-test','System management test fixture')",
        [id]
      )
      await owner.query(
        "INSERT INTO public.platform_assignment_role(user_id,role_id) SELECT $1,id FROM public.platform_role WHERE key=$2",
        [id, roleKey]
      )
    }
    return { id, session, email }
  }

  async function invoke<T>(
    domain: "catalog" | "identity",
    resource: string,
    operation: string,
    id: string | null = null,
    input: Input = {},
    actor: Identity | null = admin,
    request: string = randomUUID()
  ): Promise<T> {
    const statement =
      domain === "catalog"
        ? "SELECT public.platform_system_catalog($1,$2,$3,$4,$5,$6::jsonb,$7) AS result"
        : "SELECT public.platform_system_identity($1,$2,$3,$4,$5,$6::jsonb,$7) AS result"
    return (
      await runtime.query<{ result: T }>(statement, [
        actor?.id ?? null,
        actor?.session ?? null,
        resource,
        operation,
        id,
        JSON.stringify(input),
        request,
      ])
    ).rows[0].result
  }

  const catalog = <T = Catalog>(
    resource: string,
    operation: string,
    id: string | null = null,
    input: Input = {},
    actor: Identity | null = admin,
    request: string = randomUUID()
  ) => invoke<T>("catalog", resource, operation, id, input, actor, request)
  const identity = <T = Employee>(
    resource: string,
    operation: string,
    id: string | null = null,
    input: Input = {},
    actor: Identity | null = admin,
    request: string = randomUUID()
  ) => invoke<T>("identity", resource, operation, id, input, actor, request)
  async function employeeOptions<T = EmployeeOption>(
    kind: "department" | "post" | "role",
    input: Input,
    actor: Identity | null
  ): Promise<Page<T>> {
    return (
      await runtime.query<{ result: Page<T> }>(
        "SELECT public.list_platform_employee_options($1,$2,$3,$4::jsonb,$5) AS result",
        [
          actor?.id ?? null,
          actor?.session ?? null,
          kind,
          JSON.stringify(input),
          randomUUID(),
        ]
      )
    ).rows[0].result
  }
  const values = (name: string, extra: Input = {}): Input => ({
    key: randomUUID(),
    name,
    status: "active",
    sort: 0,
    ...extra,
  })
  const treeValues = (name: string, extra: Input = {}): Input =>
    values(name, { parentId: null, ...extra })
  const assign = (target: Identity, roleIds: string[] = []) =>
    identity("employee", "create", null, {
      mode: "existing",
      userId: target.id,
      departmentId: null,
      postIds: [],
      roleIds,
    })
  const role = (name: string) =>
    identity<Catalog>("role", "create", null, values(name))
  const pageInput = { page: 1, pageSize: 20, sortBy: "sort", sortOrder: "asc" }

  async function tenantMembership(target: Identity) {
    const organization = randomUUID()
    const member = randomUUID()
    const client = await owner.connect()
    try {
      await client.query("BEGIN")
      await client.query(
        "INSERT INTO public.organization(id,name,slug,created_at) VALUES($1,'Employee tenant',$2,now())",
        [organization, randomUUID()]
      )
      await client.query(
        "INSERT INTO public.member(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,'owner',now())",
        [member, organization, target.id]
      )
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
    return { organization, member }
  }

  async function assertGlobalIdentityPreserved(
    target: Identity,
    member: string
  ) {
    assert.equal(
      (
        await owner.query(
          "SELECT status FROM public.user_account_status WHERE user_id=$1",
          [target.id]
        )
      ).rows[0].status,
      "active"
    )
    assert.equal(
      (
        await owner.query('SELECT id FROM public."user" WHERE id=$1', [
          target.id,
        ])
      ).rowCount,
      1
    )
    assert.equal(
      (await owner.query("SELECT id FROM public.member WHERE id=$1", [member]))
        .rowCount,
      1
    )
    assert.equal(
      (
        await runtime.query("SELECT id FROM public.session WHERE id=$1", [
          target.session,
        ])
      ).rowCount,
      1
    )
  }

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
    fixture = await mkdtemp(join(tmpdir(), "platform-system-db-"))
    await cp("src", join(fixture, "src"), { recursive: true })
    await cp("migrations", join(fixture, "migrations"), { recursive: true })
    await symlink(resolve("node_modules"), join(fixture, "node_modules"))
    const migrate = () =>
      exec(process.execPath, [join(fixture!, "src/migrate.ts")], {
        env: {
          PATH: process.env.PATH,
          MIGRATION_DATABASE_URL: url("app_migrator", passwords[1]),
        },
      })
    const journalPath = join(fixture, "migrations/meta/_journal.json")
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: { idx: number }[]
    }
    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter((entry) => entry.idx < 109),
      })
    )
    await migrate()
    await owner.query(
      "INSERT INTO public.platform_role(id,key,name,permissions) VALUES($1,'legacy-menu-reader','Legacy menu reader',ARRAY['platform.menu:read','platform.post:read'])",
      [legacyMenuRoleId]
    )
    await writeFile(journalPath, JSON.stringify(journal))
    await migrate()
    await migrate()
    admin = await seed("System administrator", "platform_admin")
    auditor = await seed("System auditor", "platform_auditor")
    adminRole = (
      await owner.query(
        "SELECT id FROM public.platform_role WHERE key='platform_admin'"
      )
    ).rows[0].id
  })

  afterAll(async () => {
    await Promise.all([owner?.end(), runtime?.end()])
    await container?.stop()
    if (fixture) await rm(fixture, { recursive: true, force: true })
  })

  test("runtime 无平台表 CRUD，固定入口使用受限 executor 且不开放 PUBLIC", async () => {
    const tables = [
      "platform_assignment",
      "platform_assignment_role",
      "platform_role",
      "platform_employee_profile",
      "platform_employee_post",
      "platform_role_profile",
      "platform_department",
      "platform_post",
      "platform_dictionary",
      "platform_dictionary_item",
      "platform_parameter",
      "platform_system_cache",
      "platform_system_cache_revision",
    ]
    for (const table of tables) {
      const privileges = await owner.query(
        "SELECT has_table_privilege('app_runtime',$1,'SELECT,INSERT,UPDATE,DELETE') AS allowed",
        ["public." + table]
      )
      assert.equal(privileges.rows[0].allowed, false, table)
      assert.equal(
        (
          await owner.query(
            "SELECT has_any_column_privilege('app_runtime',$1,'SELECT,INSERT,UPDATE') AS allowed",
            ["public." + table]
          )
        ).rows[0].allowed,
        false,
        table
      )
      await assert.rejects(runtime.query("SELECT * FROM public." + table), {
        code: "42501",
      })
    }
    const functions = (
      await owner.query(
        "SELECT p.proname,p.prosecdef,p.proconfig,r.rolname,has_function_privilege('app_runtime',p.oid,'EXECUTE') AS runtime,has_function_privilege('platform_deployer',p.oid,'EXECUTE') AS deployer,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE') AS public FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY($1::text[])",
        [
          [
            "platform_system_catalog",
            "platform_system_identity",
            "list_platform_employee_options",
          ],
        ]
      )
    ).rows
    assert.equal(functions.length, 3)
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

  test("匿名、未任职账号与会话不匹配拒绝，审计员只有读取权限", async () => {
    const ordinary = await seed("No platform assignment")
    await tenantMembership(ordinary)
    for (const actor of [
      null,
      ordinary,
      { ...admin, session: ordinary.session },
    ]) {
      await assert.rejects(catalog("post", "list", null, pageInput, actor))
      await assert.rejects(identity("employee", "list", null, pageInput, actor))
    }
    await catalog("post", "list", null, pageInput, auditor)
    await identity("role", "list", null, pageInput, auditor)
    await assert.rejects(
      catalog("post", "create", null, values("Denied"), auditor),
      { message: "FORBIDDEN" }
    )
    await assert.rejects(
      identity(
        "employee",
        "create",
        null,
        { mode: "existing", userId: ordinary.id },
        auditor
      ),
      { message: "FORBIDDEN" }
    )
  })

  test("运行监控动作可独立授权，撤权立即反映在访问权限中", async () => {
    const target = await seed("Monitor operator")
    await tenantMembership(target)
    const monitorRole = await role("Monitor reader")
    await identity("role", "set-permissions", monitorRole.id, {
      permissions: ["platform.monitor:read"],
    })
    await assign(target, [monitorRole.id])
    const access = async (actor: Identity) =>
      (
        await runtime.query<{ permissions: string[] }>(
          "SELECT permissions FROM public.read_platform_access($1,$2)",
          [actor.id, actor.session]
        )
      ).rows[0].permissions
    assert.ok((await access(admin)).includes("platform.monitor:read"))
    assert.ok(!(await access(auditor)).includes("platform.monitor:read"))
    assert.ok((await access(target)).includes("platform.monitor:read"))
    await identity("role", "set-permissions", monitorRole.id, {
      permissions: [],
    })
    assert.ok(!(await access(target)).includes("platform.monitor:read"))
  })

  test("定时任务的三个独立动作使用唯一平台权限目录", async () => {
    const actions = (
      await runtime.query<{ permissions: string[] }>(
        "SELECT permissions FROM public.read_platform_access($1,$2)",
        [admin.id, admin.session]
      )
    ).rows[0].permissions
    for (const action of ["read", "manage", "run"])
      assert.ok(actions.includes(`platform.schedule:${action}`))
    const target = await seed("Schedule reader")
    const scheduleRole = await role("Schedule read only")
    await identity("role", "set-permissions", scheduleRole.id, {
      permissions: ["platform.schedule:read"],
    })
    await assign(target, [scheduleRole.id])
    const granted = (
      await runtime.query<{ permissions: string[] }>(
        "SELECT permissions FROM public.read_platform_access($1,$2)",
        [target.id, target.session]
      )
    ).rows[0].permissions
    assert.deepEqual(granted, ["platform.schedule:read"])
  })

  test("创建员工原子建立已验证原生账号、密码和任职，不创建租户成员且响应不含秘密", async () => {
    const department = await catalog(
      "department",
      "create",
      null,
      treeValues("Employee department")
    )
    const post = await catalog("post", "create", null, values("Employee post"))
    const employeeRole = await role("Employee role")
    const email = randomUUID() + "@test.example"
    const password = "System-Employee-123!"
    const passwordHash = await hashPassword(password)
    const employee = await identity("employee", "create", null, {
      mode: "create",
      name: " New employee ",
      email: email.toUpperCase(),
      passwordHash,
      departmentId: department.id,
      postIds: [post.id],
      roleIds: [employeeRole.id],
    })
    assert.equal(employee.name, "New employee")
    assert.equal(employee.status, "active")
    assert.equal(employee.lockedUntil, null)
    assert.equal(employee.failedAttempts, 0)
    assert.equal(employee.departmentId, department.id)
    assert.deepEqual(employee.postIds, [post.id])
    assert.deepEqual(employee.roleIds, [employeeRole.id])
    for (const secret of [password, passwordHash, email])
      assert.equal(JSON.stringify(employee).includes(secret), false)
    const account = (
      await owner.query(
        'SELECT u.email,u.email_verified,a.provider_id,a.password FROM public."user" u JOIN public.account a ON a.user_id=u.id WHERE u.id=$1',
        [employee.userId]
      )
    ).rows[0]
    assert.equal(account.email, email)
    assert.equal(account.email_verified, true)
    assert.equal(account.provider_id, "credential")
    assert.equal(
      await verifyPassword({ hash: account.password, password }),
      true
    )
    assert.equal(
      (
        await owner.query("SELECT id FROM public.member WHERE user_id=$1", [
          employee.userId,
        ])
      ).rowCount,
      0
    )
    await assert.rejects(
      identity("employee", "create", null, {
        mode: "create",
        name: "Overwrite",
        email,
        passwordHash,
        roleIds: [],
      }),
      { message: "EMAIL_ALREADY_EXISTS" }
    )
    assert.equal(
      (
        await owner.query('SELECT name FROM public."user" WHERE id=$1', [
          employee.userId,
        ])
      ).rows[0].name,
      "New employee"
    )
    for (const [resource, id] of [
      ["department", department.id],
      ["post", post.id],
    ]) {
      await assert.rejects(catalog(resource, "delete", id), {
        message: "RESOURCE_IN_USE",
      })
    }
  })

  test("已有已验证账号授予任职保持原资料；未验证账号不可成为员工", async () => {
    const target = await seed("Existing verified user")
    const before = (
      await owner.query('SELECT * FROM public."user" WHERE id=$1', [target.id])
    ).rows[0]
    const employee = await assign(target)
    assert.equal(employee.userId, target.id)
    assert.deepEqual(
      (
        await owner.query('SELECT * FROM public."user" WHERE id=$1', [
          target.id,
        ])
      ).rows[0],
      before
    )
    const unverified = await seed("Unverified user")
    await runtime.query(
      'UPDATE public."user" SET email_verified=false WHERE id=$1',
      [unverified.id]
    )
    await assert.rejects(assign(unverified))
    assert.equal(
      (
        await owner.query(
          "SELECT user_id FROM public.platform_assignment WHERE user_id=$1",
          [unverified.id]
        )
      ).rowCount,
      0
    )
  })

  test("已有账号候选只包含已验证且未任职的账号，分页保留总数且邮箱脱敏", async () => {
    const prefix = "Candidate-" + randomUUID()
    const eligible = await seed(prefix + "-eligible")
    const assigned = await seed(prefix + "-assigned")
    const unverified = await seed(prefix + "-unverified")
    await assign(assigned)
    await runtime.query(
      'UPDATE public."user" SET email_verified=false WHERE id=$1',
      [unverified.id]
    )
    const query = { q: prefix, page: 1, pageSize: 1 }
    const result = await identity<Page<Employee>>(
      "employee",
      "candidates",
      null,
      query
    )
    assert.equal(result.total, 1)
    assert.equal(result.items[0].userId, eligible.id)
    assert.equal(JSON.stringify(result).includes(eligible.email), false)
    const overflow = await identity<Page<Employee>>(
      "employee",
      "candidates",
      null,
      { ...query, page: 100 }
    )
    assert.equal(overflow.total, 1)
    assert.deepEqual(overflow.items, [])
    const employeeReader = await seed("Employee directory reader")
    const readerRole = await role("Employee read only")
    await identity("role", "set-permissions", readerRole.id, {
      permissions: ["platform.employee:read"],
    })
    await assign(employeeReader, [readerRole.id])
    await identity(
      "employee",
      "list",
      null,
      { page: 1, pageSize: 20 },
      employeeReader
    )
    await assert.rejects(
      identity("employee", "candidates", null, query, employeeReader),
      { message: "FORBIDDEN" }
    )
  })

  test("员工资料按版本更新姓名、单部门和多岗位，旧版本拒绝且不修改邮箱", async () => {
    const target = await seed("Editable employee")
    const employee = await assign(target)
    const department = await catalog(
      "department",
      "create",
      null,
      treeValues("Assigned department")
    )
    const posts = await Promise.all([
      catalog("post", "create", null, values("Post one")),
      catalog("post", "create", null, values("Post two")),
    ])
    const update = {
      name: "Updated employee",
      departmentId: department.id,
      postIds: posts.map((post) => post.id),
      expectedVersion: employee.version,
    }
    const updated = await identity("employee", "update", target.id, update)
    assert.equal(updated.name, "Updated employee")
    assert.equal(updated.version > employee.version, true)
    assert.equal(updated.departmentId, department.id)
    assert.deepEqual(
      [...updated.postIds].sort(),
      posts.map((post) => post.id).sort()
    )
    assert.equal(
      (
        await owner.query('SELECT email FROM public."user" WHERE id=$1', [
          target.id,
        ])
      ).rows[0].email,
      target.email
    )
    await assert.rejects(identity("employee", "update", target.id, update), {
      message: "VERSION_CONFLICT",
    })
    await runtime.query('UPDATE public."user" SET name=$1 WHERE id=$2', [
      "Native employee name",
      target.id,
    ])
    await assert.rejects(
      identity("employee", "update", target.id, {
        ...update,
        expectedVersion: updated.version,
      }),
      { message: "VERSION_CONFLICT" }
    )
  })

  test("员工只读权限直接获得关联名称，停用关联资料仍可展示且不授予完整目录读取", async () => {
    const prefix = "Employee-summary-" + randomUUID()
    const department = await catalog(
      "department",
      "create",
      null,
      treeValues(prefix + " department")
    )
    const post = await catalog("post", "create", null, values(prefix + " post"))
    const linkedRole = await role(prefix + " role")
    const target = await seed(prefix + " employee")
    await identity("employee", "create", null, {
      mode: "existing",
      userId: target.id,
      departmentId: department.id,
      postIds: [post.id],
      roleIds: [linkedRole.id],
    })
    const reader = await seed("Employee summary reader")
    const readerRole = await role("Employee summary read only")
    await identity("role", "set-permissions", readerRole.id, {
      permissions: ["platform.employee:read"],
    })
    await assign(reader, [readerRole.id])
    const assertReferences = (employee: Employee) => {
      assert.equal(employee.departmentId, department.id)
      assert.deepEqual(employee.postIds, [post.id])
      assert.deepEqual(employee.roleIds, [linkedRole.id])
      assert.deepEqual(employee.department, {
        id: department.id,
        name: department.name,
      })
      assert.deepEqual(employee.posts, [{ id: post.id, name: post.name }])
      assert.deepEqual(employee.roles, [
        {
          id: linkedRole.id,
          key: linkedRole.key,
          name: linkedRole.name,
          builtIn: false,
        },
      ])
    }
    const get = () => identity("employee", "get", target.id, {}, reader)
    assertReferences(await get())
    const page = await identity<Page<Employee>>(
      "employee",
      "list",
      null,
      { q: target.id, page: 1, pageSize: 20 },
      reader
    )
    assert.equal(page.total, 1)
    assertReferences(page.items[0])
    const empty = await identity("employee", "get", reader.id, {}, reader)
    assert.equal(empty.department, null)
    assert.deepEqual(empty.posts, [])
    const linked = [
      { kind: "department", resource: department },
      { kind: "post", resource: post },
      { kind: "role", resource: linkedRole },
    ] as const
    for (const { kind, resource } of linked) {
      const directory = kind === "role" ? identity : catalog
      await assert.rejects(directory(kind, "get", resource.id, {}, reader), {
        message: "FORBIDDEN",
      })
      await assert.rejects(
        directory(
          kind,
          "list",
          null,
          kind === "department" ? {} : pageInput,
          reader
        ),
        { message: "FORBIDDEN" }
      )
      assert.equal(
        (
          await employeeOptions(
            kind,
            { q: prefix, page: 1, pageSize: 20 },
            reader
          )
        ).total,
        1
      )
    }
    await catalog("department", "set-status", department.id, {
      status: "disabled",
    })
    await catalog("post", "set-status", post.id, { status: "disabled" })
    await identity("role", "set-status", linkedRole.id, { status: "disabled" })
    assertReferences(await get())
    for (const { kind, resource } of linked) {
      const all = await employeeOptions(
        kind,
        { q: prefix, page: 1, pageSize: 20 },
        reader
      )
      assert.equal(all.total, 1)
      assert.equal(all.items[0].name, resource.name)
      assert.equal(all.items[0].status, "disabled")
      const candidates = await employeeOptions(
        kind,
        { q: prefix, status: "active", page: 1, pageSize: 20 },
        reader
      )
      assert.equal(candidates.total, 0)
      assert.deepEqual(candidates.items, [])
      const selected = await employeeOptions(
        kind,
        { ids: resource.id, page: 1, pageSize: 20 },
        reader
      )
      assert.equal(selected.total, 1)
      assert.equal(selected.items[0].name, resource.name)
    }
  })

  test("员工读取权限独立提供受限候选及选中名称，支持状态搜索分页且撤权下一请求生效", async () => {
    const reader = await seed("Restricted employee option reader")
    const readerRole = await role("Employee options read only")
    await identity("role", "set-permissions", readerRole.id, {
      permissions: ["platform.employee:read"],
    })
    await assign(reader, [readerRole.id])
    const editor = await seed("Employee options without read")
    const editorRole = await role("Employee options update only")
    await identity("role", "set-permissions", editorRole.id, {
      permissions: ["platform.employee:update"],
    })
    await assign(editor, [editorRole.id])
    for (const kind of ["department", "post", "role"] as const) {
      const prefix = "Employee-options-" + randomUUID()
      const input = kind === "department" ? treeValues : values
      const directory = kind === "role" ? identity<Catalog> : catalog
      const first = await directory(kind, "create", null, input(prefix + " A"))
      const second = await directory(
        kind,
        "create",
        null,
        input(
          prefix + " B",
          kind === "department" ? { parentId: first.id } : {}
        )
      )
      const inactive = await directory(
        kind,
        "create",
        null,
        input(prefix + " inactive", { status: "disabled" })
      )
      await assert.rejects(
        directory(
          kind,
          "list",
          null,
          kind === "department" ? {} : pageInput,
          editor
        ),
        { message: "FORBIDDEN" }
      )
      await assert.rejects(directory(kind, "get", first.id, {}, editor), {
        message: "FORBIDDEN",
      })
      await assert.rejects(
        employeeOptions(kind, { page: 1, pageSize: 20 }, editor),
        { message: "FORBIDDEN" }
      )
      const query = { q: prefix, status: "active", page: 1, pageSize: 1 }
      const firstPage = await employeeOptions<DepartmentOption>(
        kind,
        query,
        reader
      )
      const secondPage = await employeeOptions<DepartmentOption>(
        kind,
        { ...query, page: 2 },
        reader
      )
      assert.equal(firstPage.total, 2)
      assert.equal(firstPage.page, 1)
      assert.equal(firstPage.pageSize, 1)
      assert.equal(secondPage.total, 2)
      assert.deepEqual(
        [firstPage.items[0].id, secondPage.items[0].id].sort(),
        [first.id, second.id].sort()
      )
      for (const item of [...firstPage.items, ...secondPage.items]) {
        assert.deepEqual(
          Object.keys(item).sort(),
          (kind === "department"
            ? ["id", "key", "name", "status", "parentId", "hasChildren"]
            : ["id", "key", "name", "status"]
          ).sort()
        )
        if (kind === "department") {
          assert.equal(item.parentId, item.id === first.id ? null : first.id)
          assert.equal(item.hasChildren, item.id === first.id)
        }
      }
      const overflow = await employeeOptions(
        kind,
        { ...query, page: 100 },
        reader
      )
      assert.equal(overflow.total, 2)
      assert.deepEqual(overflow.items, [])
      const search = await employeeOptions(
        kind,
        { q: prefix + " B", page: 1, pageSize: 20 },
        reader
      )
      assert.equal(search.total, 1)
      assert.deepEqual(
        search.items.map((item) => item.id),
        [second.id]
      )
      const all = await employeeOptions(
        kind,
        { q: prefix, page: 1, pageSize: 20 },
        reader
      )
      assert.equal(all.total, 3)
      assert.deepEqual(
        all.items.map((item) => item.id).sort(),
        [first.id, second.id, inactive.id].sort()
      )
      assert.equal(
        all.items.find((item) => item.id === inactive.id)?.status,
        "disabled"
      )
      const selected = await employeeOptions(
        kind,
        { ids: second.id + "," + inactive.id, page: 1, pageSize: 20 },
        reader
      )
      assert.equal(selected.total, 2)
      assert.deepEqual(
        selected.items.map((item) => item.id).sort(),
        [second.id, inactive.id].sort()
      )
      const selectedActive = await employeeOptions(
        kind,
        {
          ids: second.id + "," + inactive.id,
          status: "active",
          page: 1,
          pageSize: 20,
        },
        reader
      )
      assert.equal(selectedActive.total, 1)
      assert.deepEqual(
        selectedActive.items.map((item) => item.id),
        [second.id]
      )
      for (const invalid of [
        { ids: "invalid-id" },
        { ids: Array.from({ length: 101 }, () => randomUUID()).join(",") },
      ]) {
        await assert.rejects(
          employeeOptions(kind, { ...invalid, page: 1, pageSize: 20 }, reader),
          { message: "VALIDATION_ERROR" }
        )
      }
    }
    await assert.rejects(identity("role", "list", null, pageInput, editor), {
      message: "FORBIDDEN",
    })
    await assert.rejects(identity("role", "get", editorRole.id, {}, editor), {
      message: "FORBIDDEN",
    })
    await identity("role", "set-permissions", readerRole.id, {
      permissions: [],
    })
    for (const kind of ["department", "post", "role"] as const) {
      await assert.rejects(
        employeeOptions(kind, { page: 1, pageSize: 20 }, reader),
        { message: "FORBIDDEN" }
      )
    }
  })

  test("员工受限候选拒绝匿名、无平台任职和已过期会话", async () => {
    const ordinary = await seed("No employee option assignment")
    const expired = await seed(
      "Expired employee option session",
      "platform_auditor"
    )
    await runtime.query(
      "UPDATE public.session SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expired.session]
    )
    for (const actor of [null, ordinary, expired]) {
      for (const kind of ["department", "post", "role"] as const) {
        await assert.rejects(
          employeeOptions(kind, { page: 1, pageSize: 20 }, actor),
          { message: "FORBIDDEN" }
        )
      }
    }
  })

  test("原生本人改名持有 user 行时，平台本人编辑等待后报告版本冲突而不死锁", async () => {
    const target = await seed("Concurrent self edit")
    const editor = await role("Employee profile editor")
    await identity("role", "set-permissions", editor.id, {
      permissions: ["platform.employee:update"],
    })
    const employee = await assign(target, [editor.id])
    const native = await runtime.connect()
    const platform = await runtime.connect()
    let pending: Promise<void> | undefined
    try {
      const pid = (await platform.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid
      await native.query("BEGIN")
      await native.query("SET LOCAL lock_timeout='3s'")
      await platform.query("SET lock_timeout='3s'")
      await native.query(
        'SELECT id FROM public."user" WHERE id=$1 FOR UPDATE',
        [target.id]
      )
      // 操作者就是被编辑账号，才能覆盖 user→本人状态行与平台鉴权之间的锁序竞争。
      pending = assert.rejects(
        platform.query(
          "SELECT public.platform_system_identity($1,$2,'employee','update',$1,$3::jsonb,$4)",
          [
            target.id,
            target.session,
            JSON.stringify({
              name: "Platform edit",
              departmentId: null,
              postIds: [],
              expectedVersion: employee.version,
            }),
            randomUUID(),
          ]
        ),
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
        { timeout: 1500, interval: 20 }
      )
      await native.query('UPDATE public."user" SET name=$1 WHERE id=$2', [
        "Native self name",
        target.id,
      ])
      await native.query("COMMIT")
      await pending
      assert.equal(
        (
          await owner.query('SELECT name FROM public."user" WHERE id=$1', [
            target.id,
          ])
        ).rows[0].name,
        "Native self name"
      )
    } finally {
      await native.query("ROLLBACK")
      await pending
      await platform.query("RESET lock_timeout")
      native.release()
      platform.release()
    }
  })

  test("停用、恢复、移除平台任职保留全局账号、会话和租户成员，恢复不复活撤销角色", async () => {
    const target = await seed("Platform employee only")
    const tenant = await tenantMembership(target)
    const assignedRole = await role("Restoration role")
    let employee = await assign(target, [assignedRole.id])
    employee = await identity("employee", "set-status", target.id, {
      status: "disabled",
      expectedVersion: employee.version,
    })
    assert.equal(employee.status, "disabled")
    assert.equal(
      (
        await owner.query(
          "SELECT status FROM public.platform_assignment WHERE user_id=$1",
          [target.id]
        )
      ).rows[0].status,
      "suspended"
    )
    await assertGlobalIdentityPreserved(target, tenant.member)
    assert.deepEqual(employee.roleIds, [])
    employee = await identity("employee", "set-status", target.id, {
      status: "active",
      expectedVersion: employee.version,
    })
    assert.deepEqual(employee.roleIds, [])
    await identity("employee", "delete", target.id)
    await assertGlobalIdentityPreserved(target, tenant.member)
    assert.equal(
      (
        await owner.query(
          "SELECT role_id FROM public.platform_assignment_role WHERE user_id=$1",
          [target.id]
        )
      ).rowCount,
      0
    )
    await assert.rejects(catalog("post", "list", null, pageInput, target), {
      message: "FORBIDDEN",
    })
  })

  test("批量移除平台员工保留所有全局身份和租户成员", async () => {
    const targets = [
      await seed("Batch employee one"),
      await seed("Batch employee two"),
    ]
    const memberships = []
    for (const target of targets) {
      await assign(target)
      memberships.push(await tenantMembership(target))
    }
    await assert.rejects(
      identity("employee", "batch-delete", null, {
        userIds: [targets[0].id, randomUUID()],
      }),
      { message: "NOT_FOUND" }
    )
    assert.equal(
      (await identity("employee", "get", targets[0].id)).status,
      "active"
    )
    const result = await identity<{ userIds: string[]; deleted: boolean }>(
      "employee",
      "batch-delete",
      null,
      { userIds: targets.map((target) => target.id) }
    )
    assert.equal(result.deleted, true)
    assert.deepEqual(
      [...result.userIds].sort(),
      targets.map((target) => target.id).sort()
    )
    for (const [index, target] of targets.entries())
      await assertGlobalIdentityPreserved(target, memberships[index].member)
  })

  test("角色权限并集按下一请求生效；权限与任职管理仅超级管理员可操作", async () => {
    const target = await seed("Permission target")
    const reader = await role("Post reader")
    const writer = await role("Department reader")
    await identity("role", "set-permissions", reader.id, {
      permissions: ["platform.post:read"],
    })
    await identity("role", "set-permissions", writer.id, {
      permissions: ["platform.department:read", "platform.employee:create"],
    })
    await assign(target, [reader.id, writer.id])
    await catalog("post", "list", null, pageInput, target)
    await catalog("department", "list", null, {}, target)
    let employee = await identity("employee", "get", target.id)
    employee = await identity("employee", "set-roles", target.id, {
      roleIds: [writer.id],
      expectedVersion: employee.version,
    })
    await assert.rejects(catalog("post", "list", null, pageInput, target), {
      message: "FORBIDDEN",
    })
    await identity("employee", "set-roles", target.id, {
      roleIds: [reader.id, writer.id],
      expectedVersion: employee.version,
    })
    await catalog("post", "list", null, pageInput, target)
    await assert.rejects(
      identity(
        "employee",
        "create",
        null,
        { mode: "existing", userId: (await seed("Unauthorized grant")).id },
        target
      ),
      { message: "FORBIDDEN" }
    )
    await assert.rejects(
      identity(
        "role",
        "set-permissions",
        reader.id,
        { permissions: [] },
        target
      ),
      { message: "FORBIDDEN" }
    )
    await identity("role", "set-permissions", reader.id, { permissions: [] })
    await assert.rejects(catalog("post", "list", null, pageInput, target), {
      message: "FORBIDDEN",
    })
    await catalog("department", "list", null, {}, target)
    await identity("role", "set-status", writer.id, { status: "disabled" })
    await assert.rejects(catalog("department", "list", null, {}, target), {
      message: "FORBIDDEN",
    })
    await identity("role", "set-status", writer.id, { status: "active" })
    await catalog("department", "list", null, {}, target)
  })

  test("自定义角色不能获得任职管理或未知权限，内置超级管理员不可删除或改权限", async () => {
    const custom = await role("Restricted custom role")
    const updated = await identity<Catalog>("role", "update", custom.id, {
      key: custom.key,
      name: "Updated custom role",
      status: "active",
      sort: 42,
    })
    assert.equal(updated.name, "Updated custom role")
    assert.equal(updated.sort, 42)
    for (const permissions of [
      ["platform.authorization:manage"],
      ["platform.unknown:read"],
    ]) {
      await assert.rejects(
        identity("role", "set-permissions", custom.id, { permissions })
      )
    }
    await assert.rejects(
      identity("role", "set-permissions", adminRole, { permissions: [] })
    )
    await assert.rejects(identity("role", "delete", adminRole))
    assert.deepEqual(
      (await identity<Catalog>("role", "get", custom.id)).permissions,
      []
    )
  })

  test("导出权限独立于目录读取，私有导出分页每次重新鉴权", async () => {
    const target = await seed("Post export only")
    const exporter = await role("Post exporter")
    await identity("role", "set-permissions", exporter.id, {
      permissions: ["platform.post:export"],
    })
    await assign(target, [exporter.id])
    await assert.rejects(catalog("post", "list", null, pageInput, target), {
      message: "FORBIDDEN",
    })
    const page = await catalog<Page<Catalog>>(
      "post",
      "export-page",
      null,
      pageInput,
      target
    )
    assert.ok(Array.isArray(page.items))
    assert.equal(page.page, 1)
    await identity("role", "set-permissions", exporter.id, { permissions: [] })
    await assert.rejects(
      catalog("post", "export-page", null, pageInput, target),
      {
        message: "FORBIDDEN",
      }
    )
  })

  test("角色已授权和待授权员工分别分页，分配撤销保留员工且引用角色不可删除", async () => {
    const selected = await role("Authorization selection role")
    const prefix = "Selection-" + randomUUID()
    const targets = [
      await seed(prefix + "-A"),
      await seed(prefix + "-B"),
      await seed(prefix + "-C"),
    ]
    for (const target of targets) await assign(target)
    await identity("role", "assign-employees", selected.id, {
      userIds: targets.slice(0, 2).map((target) => target.id),
    })
    const query = {
      q: prefix,
      assigned: true,
      page: 2,
      pageSize: 1,
      sortBy: "name",
      sortOrder: "asc",
    }
    const assigned = await identity<Page<Employee>>(
      "role",
      "employees",
      selected.id,
      query
    )
    assert.equal(assigned.total, 2)
    assert.equal(assigned.items[0].userId, targets[1].id)
    const candidates = await identity<Page<Employee>>(
      "role",
      "employees",
      selected.id,
      { ...query, assigned: false, page: 1 }
    )
    assert.equal(candidates.total, 1)
    assert.equal(candidates.items[0].userId, targets[2].id)
    const overflow = await identity<Page<Employee>>(
      "role",
      "employees",
      selected.id,
      { ...query, page: 100 }
    )
    assert.equal(overflow.total, 2)
    assert.deepEqual(overflow.items, [])
    await assert.rejects(identity("role", "delete", selected.id), {
      message: "RESOURCE_IN_USE",
    })
    await identity("role", "revoke-employees", selected.id, {
      userIds: targets.slice(0, 2).map((target) => target.id),
    })
    await identity("role", "delete", selected.id)
    for (const target of targets)
      assert.equal(
        (await identity("employee", "get", target.id)).status,
        "active"
      )
  })

  test("员工筛选稳定排序且越界页保留真实 total", async () => {
    const prefix = "Employee-page-" + randomUUID()
    const targets = [
      await seed(prefix + "-C"),
      await seed(prefix + "-A"),
      await seed(prefix + "-B"),
    ]
    for (const target of targets) await assign(target)
    const query = {
      q: prefix,
      page: 1,
      pageSize: 2,
      sortBy: "name",
      sortOrder: "asc",
    }
    const first = await identity<Page<Employee>>(
      "employee",
      "list",
      null,
      query
    )
    assert.equal(first.total, 3)
    assert.deepEqual(
      first.items.map((item) => item.name),
      [prefix + "-A", prefix + "-B"]
    )
    const second = await identity<Page<Employee>>("employee", "list", null, {
      ...query,
      page: 2,
    })
    assert.deepEqual(
      second.items.map((item) => item.name),
      [prefix + "-C"]
    )
    const overflow = await identity<Page<Employee>>("employee", "list", null, {
      ...query,
      page: 100,
    })
    assert.equal(overflow.total, 3)
    assert.deepEqual(overflow.items, [])
  })

  for (const resource of ["department"]) {
    test(`${resource} 按父节点加载，筛选保留后代分支和祖先，拒绝环及引用删除`, async () => {
      const input = treeValues
      const topInput = input("Tree root")
      const top = await catalog(resource, "create", null, topInput)
      const branchInput = input("Tree branch", { parentId: top.id })
      const branch = await catalog(resource, "create", null, branchInput)
      const matching = "Tree-leaf-" + randomUUID()
      const leaf = await catalog(
        resource,
        "create",
        null,
        input(matching, { parentId: branch.id })
      )
      const filtered = await catalog<Tree>(resource, "list", null, {
        parentId: top.id,
        q: matching,
      })
      assert.deepEqual(
        filtered.items.map((item) => item.id),
        [branch.id]
      )
      assert.equal(filtered.items[0].hasChildren, true)
      assert.deepEqual(
        filtered.ancestors.map((item) => item.id),
        [top.id]
      )
      const children = await catalog<Tree>(resource, "list", null, {
        parentId: branch.id,
        q: matching,
      })
      assert.deepEqual(
        children.items.map((item) => item.id),
        [leaf.id]
      )
      assert.deepEqual(
        children.ancestors.map((item) => item.id),
        [top.id, branch.id]
      )
      await assert.rejects(
        catalog(resource, "update", top.id, { ...topInput, parentId: leaf.id }),
        { message: "TREE_CYCLE" }
      )
      await assert.rejects(catalog(resource, "delete", top.id), {
        message: "RESOURCE_IN_USE",
      })
      await assert.rejects(
        catalog(resource, "update", top.id, {
          ...topInput,
          status: "disabled",
        }),
        { message: "RESOURCE_IN_USE" }
      )
      await catalog(resource, "delete", leaf.id)
      await catalog(resource, "delete", branch.id)
      await catalog(resource, "update", top.id, {
        ...topInput,
        status: "disabled",
      })
      await assert.rejects(
        catalog(
          resource,
          "create",
          null,
          input("Disabled parent child", { parentId: top.id })
        ),
        { message: "PARENT_DISABLED" }
      )
      await catalog(resource, "delete", top.id)
    })
  }

  test("动态菜单的存储、函数、动作和导出入口已移除", async () => {
    const upgraded = (
      await owner.query(
        "SELECT permissions FROM public.platform_role WHERE id=$1",
        [legacyMenuRoleId]
      )
    ).rows[0]
    assert.deepEqual(upgraded.permissions, ["platform.post:read"])
    const removed = await owner.query(`SELECT
      to_regclass('public.platform_menu') AS menu,
      to_regclass('public.platform_iframe_origin_allowlist') AS origins,
      to_regprocedure('public.platform_menu_registry()') AS registry,
      to_regprocedure('public.platform_system_navigation_children(uuid,text[])') AS navigation`)
    assert.deepEqual(removed.rows[0], {
      menu: null,
      origins: null,
      registry: null,
      navigation: null,
    })
    const actions = (
      await owner.query(
        "SELECT public.platform_permission_catalog() AS actions"
      )
    ).rows[0].actions as string[]
    assert.ok(!actions.some((action) => action.startsWith("platform.menu:")))
    await assert.rejects(catalog("menu", "list"), {
      message: "VALIDATION_ERROR",
    })
    await assert.rejects(catalog("menu", "navigation"), {
      message: "VALIDATION_ERROR",
    })
    await assert.rejects(
      owner.query("SELECT public.platform_task_action('export','menus')"),
      { message: "VALIDATION_ERROR" }
    )
    const target = await role("Reject removed permissions")
    await assert.rejects(
      identity("role", "set-permissions", target.id, {
        permissions: ["platform.menu:read"],
      }),
      { message: "VALIDATION_ERROR" }
    )
  })

  test("岗位 CRUD、启停、排序及分页按完整筛选计算 total", async () => {
    const prefix = "Post-page-" + randomUUID()
    const entries = []
    for (const sort of [20, 10, 30])
      entries.push(
        await catalog("post", "create", null, values(prefix + sort, { sort }))
      )
    const query = { ...pageInput, q: prefix, pageSize: 2 }
    const first = await catalog<Page<Catalog>>("post", "list", null, query)
    assert.equal(first.total, 3)
    assert.deepEqual(
      first.items.map((item) => item.sort),
      [10, 20]
    )
    const last = await catalog<Page<Catalog>>("post", "list", null, {
      ...query,
      page: 2,
    })
    assert.deepEqual(
      last.items.map((item) => item.sort),
      [30]
    )
    const overflow = await catalog<Page<Catalog>>("post", "list", null, {
      ...query,
      page: 100,
    })
    assert.equal(overflow.total, 3)
    assert.deepEqual(overflow.items, [])
    await assert.rejects(
      catalog(
        "post",
        "create",
        null,
        values("Duplicate post", { key: entries[0].key })
      ),
      { message: "KEY_ALREADY_EXISTS" }
    )
    const updated = await catalog("post", "update", entries[0].id, {
      key: entries[0].key,
      name: entries[0].name,
      sort: entries[0].sort,
      status: "disabled",
    })
    assert.equal(updated.status, "disabled")
    assert.equal(
      (
        await catalog<Page<Catalog>>("post", "list", null, {
          ...query,
          status: "active",
        })
      ).total,
      2
    )
    await catalog("post", "delete", entries[0].id)
    await assert.rejects(catalog("post", "get", entries[0].id), {
      message: "NOT_FOUND",
    })
  })

  test("字典条目 CRUD 重建缓存，刷新读取源数据，停用项和停用字典不可按 key 读取", async () => {
    const dictionaryInput = values("Cache dictionary", { remark: null })
    const dictionary = await catalog(
      "dictionary",
      "create",
      null,
      dictionaryInput
    )
    const firstInput = {
      dictionaryId: dictionary.id,
      value: "first",
      label: "First label",
      status: "active",
      sort: 20,
    }
    const first = await catalog("dictionary-item", "create", null, firstInput)
    await catalog("dictionary-item", "create", null, {
      dictionaryId: dictionary.id,
      value: "disabled",
      label: "Hidden label",
      status: "disabled",
      sort: 0,
    })
    const second = await catalog("dictionary-item", "create", null, {
      dictionaryId: dictionary.id,
      value: "second",
      label: "Second label",
      status: "active",
      sort: 10,
    })
    const read = () =>
      catalog<CachedDictionary>("dictionary", "by-key", null, {
        key: dictionary.key,
      })
    const other = await catalog(
      "dictionary",
      "create",
      null,
      values("Other dictionary", { remark: null })
    )
    await catalog("dictionary-item", "create", null, {
      dictionaryId: other.id,
      value: "unrelated",
      label: "Unrelated item",
      status: "active",
      sort: 0,
    })
    const filteredPage = await catalog<Page<Catalog>>(
      "dictionary-item",
      "list",
      null,
      {
        ...pageInput,
        dictionaryId: dictionary.id,
        status: "active",
      }
    )
    assert.equal(filteredPage.total, 2)
    assert.deepEqual(
      filteredPage.items.map((item) => item.id),
      [second.id, first.id]
    )
    const overflow = await catalog<Page<Catalog>>(
      "dictionary-item",
      "list",
      null,
      {
        ...pageInput,
        dictionaryId: dictionary.id,
        page: 100,
      }
    )
    assert.equal(overflow.total, 3)
    assert.deepEqual(overflow.items, [])
    const original = await read()
    assert.deepEqual(
      original.items.map((item) => item.value),
      ["second", "first"]
    )
    await assert.rejects(catalog("dictionary", "delete", dictionary.id), {
      message: "RESOURCE_IN_USE",
    })
    await assert.rejects(
      catalog("dictionary-item", "create", null, firstInput),
      { message: "KEY_ALREADY_EXISTS" }
    )
    await catalog("dictionary-item", "update", first.id, {
      ...firstInput,
      label: "Updated label",
    })
    const afterCrud = await read()
    assert.equal(
      afterCrud.items.find((item) => item.id === first.id)?.label,
      "Updated label"
    )
    assert.ok(afterCrud.version > original.version)
    // 绕过固定函数改源表只用于模拟缓存过期，确保 refresh 确实重建被读取的缓存。
    await owner.query(
      "UPDATE public.platform_dictionary_item SET label='Source changed' WHERE id=$1",
      [first.id]
    )
    assert.equal(
      (await read()).items.find((item) => item.id === first.id)?.label,
      "Updated label"
    )
    const refresh = await catalog<{ refreshed: boolean; version: number }>(
      "dictionary",
      "refresh"
    )
    assert.equal(refresh.refreshed, true)
    assert.ok(refresh.version > afterCrud.version)
    assert.equal(
      (await read()).items.find((item) => item.id === first.id)?.label,
      "Source changed"
    )
    await catalog("dictionary-item", "delete", second.id, {
      dictionaryId: dictionary.id,
    })
    assert.deepEqual(
      (await read()).items.map((item) => item.id),
      [first.id]
    )
    await catalog("dictionary", "update", dictionary.id, {
      ...dictionaryInput,
      status: "disabled",
    })
    await assert.rejects(read(), { message: "NOT_FOUND" })
  })

  test("参数按 key 读真实缓存，CRUD 和刷新递增版本且删除清理缓存", async () => {
    const input = values("Cache parameter", {
      value: "original string",
      remark: null,
    })
    const parameter = await catalog("parameter", "create", null, input)
    const read = () =>
      catalog<CachedParameter>("parameter", "by-key", null, {
        key: parameter.key,
      })
    const original = await read()
    assert.equal(original.value, "original string")
    await owner.query(
      "UPDATE public.platform_parameter SET value='source changed' WHERE id=$1",
      [parameter.id]
    )
    assert.equal((await read()).value, "original string")
    const refresh = await catalog<{ refreshed: boolean; version: number }>(
      "parameter",
      "refresh"
    )
    assert.equal(refresh.refreshed, true)
    assert.ok(refresh.version > original.version)
    assert.equal((await read()).value, "source changed")
    await catalog("parameter", "update", parameter.id, {
      ...input,
      value: "changed by CRUD",
    })
    assert.equal((await read()).value, "changed by CRUD")
    await catalog("parameter", "update", parameter.id, {
      ...input,
      status: "disabled",
    })
    await assert.rejects(read(), { message: "NOT_FOUND" })
    await catalog("parameter", "delete", parameter.id)
    assert.equal(
      (
        await owner.query(
          "SELECT key FROM public.platform_system_cache WHERE resource='parameter' AND key=$1",
          [parameter.key]
        )
      ).rowCount,
      0
    )
  })

  test("审计失败回滚员工、角色授权、目录和缓存写入，成功留痕同事务可查", async () => {
    const target = await seed("Atomic employee")
    const employee = await assign(target)
    const selected = await role("Atomic role")
    const input = values("Atomic parameter", { value: "before", remark: null })
    const parameter = await catalog("parameter", "create", null, input)
    const request = "force-platform-system-audit-failure"
    await owner.query(
      "CREATE FUNCTION public.reject_platform_system_test_audit() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''injected audit failure''; END;'"
    )
    await owner.query(
      "CREATE TRIGGER reject_platform_system_test_audit BEFORE INSERT ON public.audit_events FOR EACH ROW WHEN (NEW.request_id='force-platform-system-audit-failure') EXECUTE FUNCTION public.reject_platform_system_test_audit()"
    )
    try {
      const email = randomUUID() + "@test.example"
      await assert.rejects(
        identity(
          "employee",
          "create",
          null,
          {
            mode: "create",
            name: "Atomic new employee",
            email,
            passwordHash: await hashPassword("Atomic-Employee-123!"),
          },
          admin,
          request
        ),
        { message: "AUDIT_UNAVAILABLE" }
      )
      assert.equal(
        (
          await owner.query('SELECT id FROM public."user" WHERE email=$1', [
            email,
          ])
        ).rowCount,
        0
      )
      await assert.rejects(
        identity(
          "employee",
          "set-status",
          target.id,
          { status: "disabled", expectedVersion: employee.version },
          admin,
          request
        ),
        { message: "AUDIT_UNAVAILABLE" }
      )
      assert.equal(
        (await identity("employee", "get", target.id)).status,
        "active"
      )
      await assert.rejects(
        identity(
          "role",
          "set-permissions",
          selected.id,
          { permissions: ["platform.post:read"] },
          admin,
          request
        ),
        { message: "AUDIT_UNAVAILABLE" }
      )
      assert.deepEqual(
        (await identity<Catalog>("role", "get", selected.id)).permissions,
        []
      )
      const revision = (
        await owner.query(
          "SELECT version FROM public.platform_system_cache_revision WHERE resource='parameter'"
        )
      ).rows[0].version
      await assert.rejects(
        catalog(
          "parameter",
          "update",
          parameter.id,
          { ...input, value: "must roll back" },
          admin,
          request
        ),
        { message: "AUDIT_UNAVAILABLE" }
      )
      assert.equal(
        (
          await catalog<CachedParameter>("parameter", "by-key", null, {
            key: parameter.key,
          })
        ).value,
        "before"
      )
      assert.equal(
        (
          await owner.query(
            "SELECT version FROM public.platform_system_cache_revision WHERE resource='parameter'"
          )
        ).rows[0].version,
        revision
      )
      await assert.rejects(
        catalog(
          "department",
          "create",
          null,
          treeValues("Atomic department", { key: request }),
          admin,
          request
        ),
        { message: "AUDIT_UNAVAILABLE" }
      )
      assert.equal(
        (
          await owner.query(
            "SELECT id FROM public.platform_department WHERE key=$1",
            [request]
          )
        ).rowCount,
        0
      )
    } finally {
      await owner.query(
        "DROP TRIGGER reject_platform_system_test_audit ON public.audit_events"
      )
      await owner.query(
        "DROP FUNCTION public.reject_platform_system_test_audit()"
      )
    }
    const successRequest = randomUUID()
    const created = await catalog(
      "post",
      "create",
      null,
      values("Audited post"),
      admin,
      successRequest
    )
    const audit = (
      await owner.query(
        "SELECT scope,event_code,actor_id,resource_id,result FROM public.audit_events WHERE request_id=$1",
        [successRequest]
      )
    ).rows
    assert.deepEqual(audit, [
      {
        scope: "platform",
        event_code: "platform.post_created",
        actor_id: admin.id,
        resource_id: created.id,
        result: "succeeded",
      },
    ])
    await assert.rejects(
      runtime.query("DELETE FROM public.audit_events WHERE request_id=$1", [
        successRequest,
      ]),
      { code: "42501" }
    )
  })

  test("固定函数自身拒绝无效分页及不支持的资源操作", async () => {
    for (const query of [
      { page: 0, pageSize: 20 },
      { page: 1, pageSize: 101 },
    ]) {
      await assert.rejects(catalog("post", "list", null, query), {
        message: "VALIDATION_ERROR",
      })
      await assert.rejects(identity("employee", "list", null, query), {
        message: "VALIDATION_ERROR",
      })
    }
    await assert.rejects(catalog("unsupported", "list"), {
      message: "VALIDATION_ERROR",
    })
    await assert.rejects(identity("role", "unsupported"), {
      message: "VALIDATION_ERROR",
    })
  })
})
