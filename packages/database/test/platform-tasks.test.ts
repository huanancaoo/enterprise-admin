import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers"
import { Pool } from "pg"
import { platformPermissions } from "@workspace/permissions"

type Task = {
  id: string
  actorId: string
  kind: "export" | "employee-import"
  resource: string
  status: string
  resultAvailable: boolean
  result: Record<string, unknown> | null
  errorCode: string | null
}

// fixture 只替代身份引擎和员工领域入口；正式任务 SQL、RLS、事务和收据都在真实 PostgreSQL 上执行。
// 全迁移中的真实员工 CRUD 组合由集成验收另行覆盖，不能由这个 fixture 推断。
describe("平台任务固定函数与行收据", { concurrent: false }, () => {
  let container: StartedTestContainer | undefined
  let owner: Pool
  let runtime: Pool
  const actor = randomUUID()
  const session = randomUUID()
  const other = randomUUID()
  const otherSession = randomUUID()
  const inputResource = randomUUID()
  const outputResource = randomUUID()
  const otherInput = randomUUID()
  const otherOutput = randomUUID()
  const permissions: string[] = [...platformPermissions]
  const summary = {
    total: 1,
    created: 1,
    updated: 0,
    granted: 0,
    skipped: 0,
    failed: 0,
    issues: [],
  }

  async function command(
    operation: string,
    input: Record<string, unknown> = {},
    id: string | null = null,
    request: string = randomUUID(),
    user = actor,
    activeSession = session
  ) {
    const response = await runtime.query(
      "SELECT public.platform_task_command($1,$2,$3,$4,$5::jsonb,$6) AS result",
      [user, activeSession, operation, id, JSON.stringify(input), request]
    )
    return response.rows[0].result
  }

  const exportInput = (
    key = randomUUID(),
    fingerprint = "a".repeat(64),
    filters: Record<string, unknown> = {}
  ) => ({
    kind: "export",
    resource: "employees",
    idempotencyKey: key,
    intentFingerprint: fingerprint,
    input: { filters },
    credentialCiphertext: null,
  })

  const importInput = (
    key = randomUUID(),
    resource = inputResource,
    updateExisting = true
  ) => ({
    kind: "employee-import",
    resource: "employees",
    idempotencyKey: key,
    intentFingerprint: "b".repeat(64),
    input: { inputResourceId: resource, updateExisting },
    credentialCiphertext: "aes-gcm:v1:opaque-fixture",
  })

  async function importTask(updateExisting = true): Promise<Task> {
    const task = await command(
      "submit",
      importInput(randomUUID(), inputResource, updateExisting)
    )
    await command("claim", {}, task.id)
    return task
  }

  async function row(
    task: Task,
    number: number,
    employee: Record<string, unknown>,
    updateExisting = true
  ) {
    const response = await runtime.query(
      "SELECT public.platform_task_employee_row($1,$2,$3,$4,$5::jsonb,$6) AS result",
      [
        actor,
        session,
        task.id,
        number,
        JSON.stringify({
          employee,
          passwordHash: "fixture-password-hash",
          updateExisting,
        }),
        randomUUID(),
      ]
    )
    return response.rows[0].result
  }

  const employee = (
    email = `employee-${randomUUID()}@example.test`,
    name = "Employee",
    roles: string[] = []
  ) => ({
    email,
    name,
    departmentId: null,
    postIds: [],
    roleIds: roles,
  })

  async function setPermissions(actions: readonly string[], active = true) {
    await owner.query(
      "UPDATE public.task_test_access SET actions=$2,active=$3 WHERE user_id=$1",
      [actor, actions, active]
    )
  }

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
        POSTGRES_DB: "tasks_test",
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
      database: "tasks_test",
      password,
    }
    owner = new Pool({ ...connection, user: "bootstrap_admin" })
    const authorizationMigration = await readFile(
      "migrations/0094_platform-file-access.sql",
      "utf8"
    )
    // 使用正式数据库目录约束身份 fixture，未注册动作不能被宽松权限桩掩盖。
    const catalogSql = authorizationMigration.split(
      "--> statement-breakpoint"
    )[0]
    await owner.query(catalogSql!)
    await owner.query(`
      CREATE ROLE app_runtime LOGIN PASSWORD '${password}';
      CREATE ROLE platform_executor NOLOGIN;
      CREATE ROLE platform_runtime NOLOGIN;
      CREATE ROLE platform_deployer NOLOGIN;
      GRANT USAGE ON SCHEMA public TO app_runtime,platform_executor;
      CREATE TABLE public.task_test_access(user_id uuid PRIMARY KEY,session_id uuid NOT NULL,active boolean NOT NULL,actions text[] NOT NULL);
      CREATE TABLE public.task_test_employees(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text NOT NULL UNIQUE,name text NOT NULL,
        email_verified boolean NOT NULL DEFAULT true,active boolean NOT NULL DEFAULT true,
        employee boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,
        roles jsonb NOT NULL DEFAULT '[]',writes integer NOT NULL DEFAULT 1);
      CREATE FUNCTION public.require_platform_action(p_actor uuid,p_session uuid,p_action text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM public.task_test_access WHERE user_id=p_actor AND session_id=p_session AND active
          AND p_action=ANY(actions) AND p_action=ANY(public.platform_permission_catalog()))
        THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
      END; $f$;
      CREATE FUNCTION public.lock_platform_authorization() RETURNS void
      LANGUAGE sql SET search_path=pg_catalog AS $f$ SELECT pg_advisory_xact_lock(20261017,1); $f$;
      CREATE FUNCTION public.require_active_account(p_user uuid) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
      BEGIN
        IF EXISTS(SELECT 1 FROM public.task_test_employees WHERE id=p_user AND NOT active) THEN RAISE EXCEPTION 'ACCOUNT_SUSPENDED'; END IF;
      END; $f$;
      CREATE FUNCTION public.platform_system_identity(p_actor uuid,p_session uuid,p_resource text,p_operation text,p_id uuid,p_input jsonb,p_request text)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
      DECLARE v_employee public.task_test_employees%ROWTYPE;
      BEGIN
        PERFORM public.require_platform_action(p_actor,p_session,'platform.authorization:manage');
        IF p_input->>'email'='fail-infrastructure@example.test' THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE'; END IF;
        IF p_operation='import-lookup' THEN
          SELECT * INTO v_employee FROM public.task_test_employees WHERE email=lower(p_input->>'email');
          IF NOT FOUND THEN RETURN jsonb_build_object('userId',NULL,'employeeId',NULL,'expectedVersion',NULL,'emailVerified',false); END IF;
          RETURN jsonb_build_object('userId',v_employee.id,'employeeId',CASE WHEN v_employee.employee THEN v_employee.id END,
            'expectedVersion',CASE WHEN v_employee.employee THEN v_employee.version END,'emailVerified',v_employee.email_verified);
        ELSIF p_operation='create' THEN
          IF p_input->>'mode'='create' THEN
            INSERT INTO public.task_test_employees(email,name,roles) VALUES(p_input->>'email',p_input->>'name',p_input->'roleIds') RETURNING * INTO v_employee;
          ELSE
            UPDATE public.task_test_employees SET employee=true,roles=p_input->'roleIds',version=version+1,writes=writes+1
              WHERE id=(p_input->>'userId')::uuid RETURNING * INTO v_employee;
          END IF;
        ELSIF p_operation='get' THEN
          SELECT * INTO v_employee FROM public.task_test_employees WHERE id=p_id;
        ELSIF p_operation='update' THEN
          UPDATE public.task_test_employees SET name=p_input->>'name',version=version+1,writes=writes+1
            WHERE id=p_id AND version=(p_input->>'expectedVersion')::integer RETURNING * INTO v_employee;
          IF NOT FOUND THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
        ELSIF p_operation='set-roles' THEN
          IF p_input->'roleIds' ? 'blocked' THEN RAISE EXCEPTION 'LAST_PLATFORM_SUPERADMIN'; END IF;
          UPDATE public.task_test_employees SET roles=p_input->'roleIds',version=version+1,writes=writes+1
            WHERE id=p_id AND version=(p_input->>'expectedVersion')::integer RETURNING * INTO v_employee;
          IF NOT FOUND THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
        ELSE RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
        RETURN jsonb_build_object('userId',v_employee.id,'status',CASE WHEN v_employee.active THEN 'active' ELSE 'disabled' END,'version',v_employee.version);
      END; $f$;
      REVOKE ALL ON FUNCTION public.require_platform_action(uuid,uuid,text),public.lock_platform_authorization(),
        public.require_active_account(uuid),public.platform_system_identity(uuid,uuid,text,text,uuid,jsonb,text) FROM PUBLIC,app_runtime;
      GRANT EXECUTE ON FUNCTION public.require_platform_action(uuid,uuid,text),public.lock_platform_authorization(),
        public.require_active_account(uuid),public.platform_system_identity(uuid,uuid,text,text,uuid,jsonb,text) TO platform_executor;
      CREATE TABLE public.platform_resources(id uuid PRIMARY KEY,uploaded_by uuid NOT NULL,purpose text NOT NULL);
      REVOKE ALL ON public.platform_resources FROM PUBLIC,app_runtime;
      GRANT SELECT ON public.platform_resources TO platform_executor;
      CREATE TABLE public.audit_events(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),scope text NOT NULL,event_code text NOT NULL,
        actor_id uuid,resource_type text,resource_id uuid,result text NOT NULL,request_id text NOT NULL,
        organization_id uuid,tenant_visible boolean NOT NULL DEFAULT false,fields jsonb NOT NULL,occurred_at timestamptz NOT NULL,
        CONSTRAINT task_test_audit_available CHECK(request_id<>'fail-audit'));
      ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY;
    `)
    const migration = await readFile(
      "migrations/0073_platform-tasks-resources.sql",
      "utf8"
    )
    const taskSql = migration.match(
      /-- platform-tasks:start\n([\s\S]*?)-- platform-tasks:end/
    )
    if (!taskSql) throw new Error("正式迁移缺少平台任务 SQL 边界标记")
    await owner.query(taskSql[1])
    await owner.query(
      await readFile(
        "migrations/0079_platform-task-submission-authorization.sql",
        "utf8"
      )
    )
    await owner.query(
      "INSERT INTO public.task_test_access VALUES($1,$2,true,$3),($4,$5,true,$3)",
      [actor, session, permissions, other, otherSession]
    )
    await owner.query(
      "INSERT INTO public.platform_resources VALUES($1,$2,'task-input'),($3,$2,'task-output'),($4,$5,'task-input'),($6,$5,'task-output')",
      [inputResource, actor, outputResource, otherInput, other, otherOutput]
    )
    runtime = new Pool({ ...connection, user: "app_runtime" })
  })

  afterAll(async () => {
    await runtime?.end()
    await owner?.end()
    await container?.stop()
  })

  test("正式权限目录不含任务创建动作，导入和导出仍可按原业务动作提交", async () => {
    const catalog = await owner.query(
      "SELECT public.platform_permission_catalog() AS permissions"
    )
    expect(catalog.rows[0].permissions.sort()).toEqual(
      [...platformPermissions].sort()
    )
    expect(catalog.rows[0].permissions).not.toContain("platform.task:create")
    expect(await command("submit", exportInput())).toMatchObject({
      kind: "export",
      status: "pending",
    })
    expect(await command("submit", importInput())).toMatchObject({
      kind: "employee-import",
      status: "pending",
    })
  })

  test.each([
    ["导出缺少任务读取权", "export", ["platform.employee:export"]],
    ["导出缺少原业务动作", "export", ["platform.task:read"]],
    ["导入缺少任务读取权", "import", ["platform.authorization:manage"]],
    ["导入缺少任职管理权", "import", ["platform.task:read"]],
  ] as const)("%s时提交被拒且没有任务记录", async (_label, kind, actions) => {
    await setPermissions(actions)
    const input = kind === "export" ? exportInput() : importInput()
    try {
      await expect(command("submit", input)).rejects.toThrow("FORBIDDEN")
      const stored = await owner.query(
        "SELECT count(*)::integer AS count FROM public.platform_tasks WHERE actor_id=$1 AND idempotency_key=$2",
        [actor, input.idempotencyKey]
      )
      expect(stored.rows[0].count).toBe(0)
    } finally {
      await setPermissions(permissions)
    }
  })

  test("runtime 无任务表直读写权限，辅助函数不向 runtime 或 PUBLIC 开放", async () => {
    for (const table of ["platform_tasks", "platform_task_rows"]) {
      for (const action of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const response = await owner.query(
          "SELECT has_table_privilege('app_runtime',$1,$2) AS allowed",
          [`public.${table}`, action]
        )
        expect(response.rows[0].allowed).toBe(false)
      }
      await expect(
        runtime.query(`SELECT * FROM public.${table}`)
      ).rejects.toMatchObject({ code: "42501" })
      const flags = await owner.query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
        [`public.${table}`]
      )
      expect(flags.rows[0]).toEqual({
        relrowsecurity: true,
        relforcerowsecurity: true,
      })
    }
    for (const helper of [
      "public.append_platform_task_audit(uuid,uuid,text,text)",
      "public.platform_task_action(text,text)",
      "public.platform_task_projection(public.platform_tasks)",
      "public.platform_task_audit_event_codes()",
    ]) {
      const response = await owner.query(
        "SELECT has_function_privilege('app_runtime',$1,'EXECUTE') AS allowed",
        [helper]
      )
      expect(response.rows[0].allowed).toBe(false)
    }
    const functions = await owner.query(`
      SELECT prosecdef,proconfig,pg_get_userbyid(proowner) AS owner
      FROM pg_proc WHERE oid IN (
        'public.platform_task_command(uuid,uuid,text,uuid,jsonb,text)'::regprocedure,
        'public.platform_tasks_pending(uuid,integer)'::regprocedure,
        'public.platform_task_employee_row(uuid,uuid,uuid,integer,jsonb,text)'::regprocedure)
    `)
    expect(functions.rows).toHaveLength(3)
    for (const fn of functions.rows) {
      expect(fn.owner).toBe("platform_executor")
      expect(fn.prosecdef).toBe(true)
      expect(fn.proconfig).toEqual([
        "search_path=pg_catalog",
        "row_security=on",
      ])
    }
  })

  test("提交幂等、不同意图冲突，find/list/get 只返回本人安全投影", async () => {
    const input = exportInput(randomUUID(), "c".repeat(64), {
      eventCode: "platform.employee_created",
    })
    const first = await command("submit", input)
    expect(await command("submit", input)).toEqual(first)
    expect(
      await command("find", { idempotencyKey: input.idempotencyKey })
    ).toEqual(first)
    expect(await command("find", { idempotencyKey: randomUUID() })).toBeNull()
    await expect(
      command("submit", { ...input, intentFingerprint: "d".repeat(64) })
    ).rejects.toThrow("IDEMPOTENCY_KEY_REUSED")
    const page = await command("list", { page: 1, pageSize: 100 })
    expect(page.items).toContainEqual(first)
    expect(page.total).toBeGreaterThanOrEqual(1)
    expect(await command("get", {}, first.id)).toEqual(first)
    expect(Object.keys(first).sort()).toEqual(
      [
        "id",
        "actorId",
        "kind",
        "resource",
        "status",
        "createdAt",
        "updatedAt",
        "errorCode",
        "resultAvailable",
        "result",
      ].sort()
    )
    await expect(
      command("get", {}, first.id, randomUUID(), other, otherSession)
    ).rejects.toThrow("NOT_FOUND")
    const events = await owner.query(
      "SELECT event_code,fields FROM public.audit_events WHERE resource_id=$1",
      [first.id]
    )
    expect(events.rows).toEqual([
      { event_code: "platform.task_submitted", fields: {} },
    ])
  })

  test("导入输入必须属于本人且用途正确，同意图重试无需再次携带密文和文件", async () => {
    await expect(
      command("submit", importInput(randomUUID(), otherInput))
    ).rejects.toThrow("NOT_FOUND")
    await expect(
      command("submit", importInput(randomUUID(), outputResource))
    ).rejects.toThrow("NOT_FOUND")
    const input = importInput()
    const task = await command("submit", input)
    const retry = await command("submit", {
      ...input,
      input: {},
      credentialCiphertext: null,
    })
    expect(retry).toEqual(task)
    const empty = await command("list", { page: 999_999, pageSize: 100 })
    expect(empty.items).toEqual([])
    expect(empty.total).toBeGreaterThan(0)
  })

  test("claim 返回内部输入，queued 不会覆盖已运行状态，终态 claim 不返回密文", async () => {
    const task = await command("submit", importInput())
    await expect(
      command("claim", {}, task.id, randomUUID(), actor, otherSession)
    ).rejects.toThrow("NOT_FOUND")
    expect((await command("queued", {}, task.id)).status).toBe("queued")
    const claimed = await command("claim", {}, task.id)
    expect(claimed).toMatchObject({
      status: "running",
      sessionId: session,
      input: { inputResourceId: inputResource, updateExisting: true },
      credentialCiphertext: "aes-gcm:v1:opaque-fixture",
    })
    expect((await command("queued", {}, task.id)).status).toBe("running")
    await command(
      "complete",
      { resultResourceId: outputResource, result: summary },
      task.id
    )
    const terminal = await command("claim", {}, task.id)
    expect(terminal.status).toBe("completed")
    expect(terminal).not.toHaveProperty("credentialCiphertext")
    expect(terminal).not.toHaveProperty("input")
    const stored = await owner.query(
      "SELECT credential_ciphertext FROM public.platform_tasks WHERE id=$1",
      [task.id]
    )
    expect(stored.rows[0].credential_ciphertext).toBeNull()
  })

  test("并发重试同一行只创建一次，收据不存员工输入或密码哈希", async () => {
    const task = await importTask()
    const input = employee()
    const results = await Promise.all([
      row(task, 2, input),
      row(task, 2, input),
    ])
    expect(results).toEqual([{ outcome: "created" }, { outcome: "created" }])
    const written = await owner.query(
      "SELECT writes FROM public.task_test_employees WHERE email=$1",
      [input.email]
    )
    expect(written.rows).toEqual([{ writes: 1 }])
    const receipts = await owner.query(
      "SELECT row_number,status,result FROM public.platform_task_rows WHERE task_id=$1",
      [task.id]
    )
    expect(receipts.rows).toEqual([
      { row_number: 2, status: "created", result: { outcome: "created" } },
    ])
    const persisted = await owner.query(
      "SELECT input,result FROM public.platform_tasks WHERE id=$1",
      [task.id]
    )
    expect(JSON.stringify([persisted.rows, receipts.rows])).not.toContain(
      input.email
    )
    expect(JSON.stringify([persisted.rows, receipts.rows])).not.toContain(
      "fixture-password-hash"
    )
  })

  test("更新已有员工和角色共用版本，角色写失败回滚资料并记录失败行", async () => {
    const task = await importTask()
    const input = employee()
    await row(task, 2, input)
    expect(
      await row(task, 3, { ...input, name: "Updated", roleIds: ["operator"] })
    ).toEqual({ outcome: "updated" })
    expect(
      await row(task, 4, {
        ...input,
        name: "Must rollback",
        roleIds: ["blocked"],
      })
    ).toEqual({
      outcome: "failed",
      code: "ASSIGNMENT_NOT_ALLOWED",
    })
    const state = await owner.query(
      "SELECT name,roles,version,writes FROM public.task_test_employees WHERE email=$1",
      [input.email]
    )
    expect(state.rows).toEqual([
      { name: "Updated", roles: ["operator"], version: 3, writes: 3 },
    ])
    expect(await row(task, 4, { ...input, name: "Retry" })).toEqual({
      outcome: "failed",
      code: "ASSIGNMENT_NOT_ALLOWED",
    })
  })

  test("未验证账号不授任职，已有验证账号授任职，关闭更新选项时跳过已有员工", async () => {
    const unverified = employee()
    const verified = employee()
    await owner.query(
      "INSERT INTO public.task_test_employees(email,name,email_verified,employee) VALUES($1,$2,false,false),($3,$4,true,false)",
      [unverified.email, unverified.name, verified.email, verified.name]
    )
    const task = await importTask(false)
    expect(await row(task, 2, unverified, false)).toEqual({
      outcome: "failed",
      code: "ACCOUNT_NOT_VERIFIED",
    })
    expect(await row(task, 3, verified, false)).toEqual({ outcome: "granted" })
    expect(await row(task, 4, { ...verified, name: "Ignored" }, false)).toEqual(
      {
        outcome: "skipped",
      }
    )
  })

  test("基础设施故障不转换成行错误，也不留下收据", async () => {
    const task = await importTask()
    await expect(
      row(task, 2, employee("fail-infrastructure@example.test"))
    ).rejects.toThrow("AUDIT_UNAVAILABLE")
    const receipts = await owner.query(
      "SELECT count(*)::integer AS count FROM public.platform_task_rows WHERE task_id=$1",
      [task.id]
    )
    expect(receipts.rows[0].count).toBe(0)
  })

  test("撤销原动作后执行和下载均拒绝，但原绑定失败结算仍清除密文", async () => {
    const task = await importTask()
    await setPermissions(["platform.task:read", "platform.task:download"])
    try {
      await expect(command("claim", {}, task.id)).rejects.toThrow("FORBIDDEN")
      await expect(
        command(
          "complete",
          { resultResourceId: outputResource, result: summary },
          task.id
        )
      ).rejects.toThrow("FORBIDDEN")
      await expect(
        command(
          "fail",
          { status: "rejected", errorCode: "FORBIDDEN" },
          task.id,
          randomUUID(),
          actor,
          otherSession
        )
      ).rejects.toThrow("NOT_FOUND")
      expect(
        await command(
          "fail",
          { status: "rejected", errorCode: "FORBIDDEN" },
          task.id
        )
      ).toMatchObject({
        status: "rejected",
        resultAvailable: false,
        errorCode: "FORBIDDEN",
      })
      const stored = await owner.query(
        "SELECT credential_ciphertext FROM public.platform_tasks WHERE id=$1",
        [task.id]
      )
      expect(stored.rows[0].credential_ciphertext).toBeNull()
      const audit = await owner.query(
        "SELECT event_code,result,fields FROM public.audit_events WHERE resource_id=$1 ORDER BY occurred_at",
        [task.id]
      )
      expect(audit.rows.at(-1)).toEqual({
        event_code: "platform.task_failed",
        result: "denied",
        fields: {},
      })
    } finally {
      await setPermissions(permissions)
    }
  })

  test("只有本人当前具备下载和原导出动作才能下载，产物不能绑定他人资源", async () => {
    const task = await command("submit", exportInput())
    await command("claim", {}, task.id)
    await expect(
      command(
        "complete",
        { resultResourceId: otherOutput, result: null },
        task.id
      )
    ).rejects.toThrow("NOT_FOUND")
    await command(
      "complete",
      { resultResourceId: outputResource, result: null },
      task.id
    )
    expect(await command("download", {}, task.id)).toEqual({
      resultResourceId: outputResource,
    })
    for (const revoked of [
      "platform.task:download",
      "platform.employee:export",
    ]) {
      await setPermissions(
        permissions.filter((permission) => permission !== revoked)
      )
      try {
        await expect(command("download", {}, task.id)).rejects.toThrow(
          "FORBIDDEN"
        )
      } finally {
        await setPermissions(permissions)
      }
    }
    await expect(
      command("download", {}, task.id, randomUUID(), other, otherSession)
    ).rejects.toThrow("NOT_FOUND")
  })

  test("成功审计失败时提交与完成都回滚，终态结果禁止夹带未批准字段", async () => {
    const input = exportInput()
    await expect(command("submit", input, null, "fail-audit")).rejects.toThrow(
      "AUDIT_UNAVAILABLE"
    )
    expect(
      await command("find", { idempotencyKey: input.idempotencyKey })
    ).toBeNull()
    const task = await importTask()
    await expect(
      command(
        "complete",
        {
          resultResourceId: outputResource,
          result: { ...summary, email: "private@example.test" },
        },
        task.id
      )
    ).rejects.toThrow("VALIDATION_ERROR")
    await expect(
      command(
        "complete",
        { resultResourceId: outputResource, result: summary },
        task.id,
        "fail-audit"
      )
    ).rejects.toThrow("AUDIT_UNAVAILABLE")
    expect((await command("get", {}, task.id)).status).toBe("running")
    const stored = await owner.query(
      "SELECT credential_ciphertext FROM public.platform_tasks WHERE id=$1",
      [task.id]
    )
    expect(stored.rows[0].credential_ciphertext).toBe(
      "aes-gcm:v1:opaque-fixture"
    )
  })

  test("Worker 命令和导入行先等授权锁，再锁任务行", async () => {
    const queued = await command("submit", exportInput())
    const claimed = await command("submit", exportInput())
    const completed = await command("submit", exportInput())
    await command("claim", {}, completed.id)
    const imported = await importTask()
    const commandSql =
      "SELECT public.platform_task_command($1,$2,$3,$4,$5::jsonb,$6)"
    const operations = [
      {
        id: queued.id,
        sql: commandSql,
        values: [actor, session, "queued", queued.id, "{}", randomUUID()],
      },
      {
        id: claimed.id,
        sql: commandSql,
        values: [actor, session, "claim", claimed.id, "{}", randomUUID()],
      },
      {
        id: completed.id,
        sql: commandSql,
        values: [
          actor,
          session,
          "complete",
          completed.id,
          JSON.stringify({ resultResourceId: outputResource, result: null }),
          randomUUID(),
        ],
      },
      {
        id: imported.id,
        sql: "SELECT public.platform_task_employee_row($1,$2,$3,$4,$5::jsonb,$6)",
        values: [
          actor,
          session,
          imported.id,
          2,
          JSON.stringify({
            employee: employee(),
            passwordHash: "fixture-password-hash",
            updateExisting: true,
          }),
          randomUUID(),
        ],
      },
    ]
    for (const operation of operations) {
      const authority = await owner.connect()
      const worker = await runtime.connect()
      let running: Promise<unknown> | undefined
      try {
        await authority.query("BEGIN")
        await authority.query("SELECT pg_advisory_xact_lock(20261017,1)")
        const identity = await worker.query("SELECT pg_backend_pid() AS pid")
        running = worker.query(operation.sql, operation.values)
        await expect
          .poll(async () => {
            const state = await owner.query(
              "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
              [identity.rows[0].pid]
            )
            return state.rows[0]?.wait_event_type
          })
          .toBe("Lock")
        // 若 Worker 先锁任务行，这个 NOWAIT 会失败，重复 submit 就存在相反锁序。
        await owner.query(
          "SELECT id FROM public.platform_tasks WHERE id=$1 FOR UPDATE NOWAIT",
          [operation.id]
        )
      } finally {
        await authority.query("ROLLBACK")
        try {
          await running
        } finally {
          worker.release()
          authority.release()
        }
      }
    }
  })

  test("恢复查询遍历所有未终态并支持 UUID 游标，终态不再进入恢复", async () => {
    const created: Task[] = []
    for (let index = 0; index < 3; index += 1) {
      created.push(await command("submit", exportInput()))
    }
    await command("queued", {}, created[1]!.id)
    await command("claim", {}, created[2]!.id)
    const seen = new Set<string>()
    let after: string | null = null
    for (;;) {
      const response = await runtime.query(
        "SELECT public.platform_tasks_pending($1,2) AS result",
        [after]
      )
      const batch = response.rows[0].result as {
        scope: string
        taskId: string
        actorId: string
        sessionId: string
        requestId: string
      }[]
      if (!batch.length) break
      for (const item of batch) {
        expect(item.scope).toBe("platform")
        expect(item.actorId).toBe(actor)
        expect(item.sessionId).toBe(session)
        expect(seen.has(item.taskId)).toBe(false)
        seen.add(item.taskId)
      }
      after = batch.at(-1)!.taskId
    }
    for (const task of created) expect(seen.has(task.id)).toBe(true)
    const terminal = await owner.query(
      "SELECT id FROM public.platform_tasks WHERE status IN ('completed','failed','rejected')"
    )
    for (const task of terminal.rows) expect(seen.has(task.id)).toBe(false)
  })
})
