import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { GenericContainer, Wait } from "testcontainers"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { redisResponseGate } from "../setup/worker-redis-gate.mjs"
import { createTaskTenantRunner } from "../../packages/database/dist/task-tenant.js"
const { createTaskProducer, createTaskEnvelope, taskJobId, readWorkerConfig } =
  createRequire(resolve("apps/api/package.json"))("@workspace/jobs")
import { counterTask } from "../setup/worker-task-fixture.mjs"

const { Queue } = createRequire(resolve("packages/jobs/package.json"))("bullmq")
const origin = "http://localhost:3200"
async function reserveRedisPort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

describe("组织任务真实生产者与独立 Worker", () => {
  const resources = new AsyncDisposableStack()
  let environment, redis, config, producer, queue
  const children = []
  beforeAll(async () => {
    environment = await startTestApplication()
    resources.defer(() => environment.close())
    const versions = JSON.parse(
      await readFile("docs/architecture/versions.json", "utf8")
    )
    redis = await new GenericContainer(versions.releaseFoundation.redis.image)
      .withCommand([
        "redis-server",
        "--appendonly",
        "yes",
        "--appendfsync",
        "always",
        "--maxmemory-policy",
        "noeviction",
      ])
      .withExposedPorts({ container: 6379, host: await reserveRedisPort() })
      .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
      .start()
    resources.defer(() => redis.stop())
    config = {
      ...readWorkerConfig({
        REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
      }),
      backoffMs: 50,
      lockDurationMs: 1000,
      stalledIntervalMs: 500,
      producerTimeoutMs: 700,
    }
    queue = new Queue(config.queueName, {
      connection: { host: redis.getHost(), port: redis.getMappedPort(6379) },
      prefix: config.queuePrefix,
    })
    queue.on("error", () => {})
    resources.defer(() => queue.close())
    producer = createTaskProducer({
      config,
      registry: [counterTask()],
      runInTenant: createTaskTenantRunner(environment.runtime.pool),
    })
    resources.defer(() => producer.close())
    resources.defer(async () => {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL")
          await child.closed
        }
    })
    // 独立测试表具有与生产业务相同的运行角色、FORCE RLS 和组织上下文约束。
    await environment.migrator.query(`
      CREATE TABLE worker_test_resources (organization_id uuid NOT NULL, id uuid NOT NULL, value integer NOT NULL DEFAULT 0, PRIMARY KEY(organization_id,id));
      CREATE TABLE worker_test_receipts (organization_id uuid NOT NULL, actor_id uuid NOT NULL, task_type text NOT NULL, idempotency_key text NOT NULL, intent_fingerprint text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(organization_id,actor_id,task_type,idempotency_key));
      ALTER TABLE worker_test_resources ENABLE ROW LEVEL SECURITY; ALTER TABLE worker_test_resources FORCE ROW LEVEL SECURITY;
      ALTER TABLE worker_test_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE worker_test_receipts FORCE ROW LEVEL SECURITY;
      CREATE POLICY worker_test_resources_scope ON worker_test_resources USING (organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK (organization_id=current_setting('app.organization_id',true)::uuid);
      CREATE POLICY worker_test_receipts_scope ON worker_test_receipts USING (organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK (organization_id=current_setting('app.organization_id',true)::uuid);
      GRANT SELECT,INSERT,UPDATE ON worker_test_resources TO app_runtime; GRANT SELECT,INSERT ON worker_test_receipts TO app_runtime;
    `)
  })
  afterAll(() => resources.disposeAsync())
  async function workspace() {
    const actor = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const organization = await environment.runtime.auth.api.createOrganization({
      headers: actor.headers,
      body: { name: "后台组织任务", slug: randomUUID() },
    })
    const resourceId = randomUUID()
    await environment.observer.query(
      "INSERT INTO worker_test_resources(organization_id,id) VALUES($1,$2)",
      [organization.id, resourceId]
    )
    return { actor, organization, resourceId }
  }
  const request = (fixture, amount = 2, more = {}) => ({
    type: "test.increment",
    input: { amount },
    idempotencyKey: randomUUID(),
    identity: {
      organizationId: fixture.organization.id,
      actorId: fixture.actor.user.id,
      resourceId: fixture.resourceId,
      locale: "ar",
      requestId: randomUUID(),
    },
    ...more,
  })
  async function start(gate, overrides = {}, fixtureEnvironment = {}) {
    const child = spawn(
      process.execPath,
      ["tests/setup/worker-process-runtime.mjs"],
      {
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: environment.config.databaseURL,
          WORKER_TEST_CONFIG: JSON.stringify({ ...config, ...overrides }),
          ...(gate ? { WORKER_TEST_GATE: gate } : {}),
          ...fixtureEnvironment,
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      }
    )
    child.messages = []
    child.output = ""
    child.stdout.on("data", (chunk) => {
      child.output += chunk
    })
    child.stderr.on("data", (chunk) => {
      child.output += chunk
    })
    child.on("message", (message) => child.messages.push(message))
    child.closed = new Promise((resolve) =>
      child.on("close", (code, signal) => resolve({ code, signal }))
    )
    children.push(child)
    await expect
      .poll(() => child.messages.some((message) => message.kind === "ready"), {
        timeout: 15_000,
      })
      .toBe(true)
    return child
  }
  async function stop(child, signal = "SIGTERM") {
    child.kill(signal)
    return child.closed
  }
  async function state(id, expected) {
    await expect
      .poll(async () => (await queue.getJob(id))?.getState(), {
        timeout: 15_000,
      })
      .toBe(expected)
    return queue.getJob(id)
  }
  async function facts(fixture) {
    const resource = await environment.observer.query(
      "SELECT value FROM worker_test_resources WHERE organization_id=$1 AND id=$2",
      [fixture.organization.id, fixture.resourceId]
    )
    const audits = await environment.observer.query(
      "SELECT count(*)::integer AS count FROM audit_events WHERE resource_id=$1 AND event_code='worker.fixture_committed'",
      [fixture.resourceId]
    )
    return { value: resource.rows[0].value, audits: audits.rows[0].count }
  }
  async function versionHeaders(fixture) {
    const { rows } = await environment.observer.query(
      "SELECT authorization_version FROM organization_status WHERE organization_id=$1",
      [fixture.organization.id]
    )
    const headers = new Headers(fixture.actor.headers)
    headers.set(
      "X-Expected-Authz-Version",
      String(rows[0].authorization_version)
    )
    return headers
  }
  async function delegated() {
    const fixture = await workspace()
    const actor = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const role = (
      await environment.runtime.auth.api.createOrgRole({
        headers: fixture.actor.headers,
        body: {
          organizationId: fixture.organization.id,
          role: "worker-" + randomUUID().slice(0, 8),
          permission: { project: ["update"] },
        },
      })
    ).roleData
    const membership = await environment.runtime.auth.api.addMember({
      headers: fixture.actor.headers,
      body: {
        organizationId: fixture.organization.id,
        userId: actor.user.id,
        role: role.role,
      },
    })
    return { ...fixture, actor, owner: fixture, role, membership }
  }
  test("正式入队经独立进程授权，在同一组织事务提交一次业务与审计", async () => {
    const fixture = await workspace(),
      worker = await start()
    try {
      const submitted = await producer.submit(request(fixture))
      expect(submitted.status).toBe("enqueued")
      const job = await state(submitted.jobId, "completed")
      expect(job.returnvalue).toMatchObject({
        business: "committed",
        result: { value: 2, locale: "ar" },
      })
      expect(await facts(fixture)).toEqual({ value: 2, audits: 1 })
    } finally {
      expect(await stop(worker)).toEqual({ code: 0, signal: null })
    }
  })

  test("排队中同键同意图复用、异体冲突；Job 清理后持久化事实仍阻止重复副作用", async () => {
    const fixture = await workspace(),
      value = request(fixture)
    const submitted = await producer.submit(value)
    expect(submitted.status).toBe("enqueued")
    const repeated = await producer.submit({
      ...value,
      identity: { ...value.identity, requestId: randomUUID() },
    })
    expect(repeated).toMatchObject({
      status: "already_exists",
      jobId: submitted.jobId,
      state: "waiting",
    })
    await expect(
      producer.submit({ ...value, input: { amount: 3 } })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
    const secondResource = randomUUID()
    await environment.observer.query(
      "INSERT INTO worker_test_resources(organization_id,id) VALUES($1,$2)",
      [fixture.organization.id, secondResource]
    )
    await expect(
      producer.submit({
        ...value,
        identity: { ...value.identity, resourceId: secondResource },
      })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
    const worker = await start()
    try {
      const completed = await state(submitted.jobId, "completed")
      expect(await producer.submit(value)).toMatchObject({
        status: "already_completed",
        jobId: submitted.jobId,
        result: { value: 2 },
      })
      await expect(
        producer.submit({ ...value, input: { amount: 3 } })
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
      await completed.remove()
      expect(await queue.getJob(submitted.jobId)).toBeUndefined()
      expect(await producer.submit(value)).toMatchObject({
        status: "already_completed",
        jobId: submitted.jobId,
      })
      // 外部重新投递同一真实任务，确认处理器幂等仍成立，不能仅由生产者短路证明。
      await queue.add(value.type, createTaskEnvelope([counterTask()], value), {
        jobId: submitted.jobId,
      })
      expect(
        (await state(submitted.jobId, "completed")).returnvalue
      ).toMatchObject({ business: "already_committed", result: { value: 2 } })
      expect(await facts(fixture)).toEqual({ value: 2, audits: 1 })
    } finally {
      await stop(worker)
    }
  })

  test("处理中同键异体永久冲突，原 Job 数据及已提交业务保持不变", async () => {
    const fixture = await workspace(),
      value = request(fixture),
      submitted = await producer.submit(value)
    const worker = await start("after_commit")
    try {
      await expect
        .poll(
          () =>
            worker.messages.some(
              (message) =>
                message.kind === "committed" &&
                message.resourceId === fixture.resourceId
            ),
          { timeout: 10_000 }
        )
        .toBe(true)
      const active = await state(submitted.jobId, "active")
      const originalData = active.data
      // 业务事务已提交但真实队列确认仍等待：生产者可重新查权，不能将 active 去重解释为同意图。
      await expect(
        producer.submit({ ...value, input: { amount: 3 } })
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
      expect((await state(submitted.jobId, "active")).data).toEqual(
        originalData
      )
      expect(await facts(fixture)).toEqual({ value: 2, audits: 1 })
      worker.send({ kind: "release", jobId: "after_commit" })
      expect(
        (await state(submitted.jobId, "completed")).returnvalue
      ).toMatchObject({
        business: "committed",
        result: { value: 2 },
      })
    } finally {
      worker.send({ kind: "release", jobId: "after_commit" })
      expect(await stop(worker)).toEqual({ code: 0, signal: null })
    }
  })

  test("排队后角色撤权，独立进程永久拒绝且不恢复旧任务", async () => {
    const fixture = await delegated(),
      value = request(fixture)
    const submitted = await producer.submit(value)
    await environment.runtime.auth.api.updateOrgRole({
      headers: await versionHeaders(fixture.owner),
      body: {
        organizationId: fixture.organization.id,
        roleId: fixture.role.id,
        data: { permission: { project: ["read"] } },
      },
    })
    const worker = await start()
    try {
      const failed = await state(submitted.jobId, "failed")
      expect(failed.failedReason).toBe("PERMISSION_DENIED")
      expect(failed.attemptsMade).toBe(1)
      expect(await facts(fixture)).toEqual({ value: 0, audits: 0 })
      await environment.runtime.auth.api.updateOrgRole({
        headers: await versionHeaders(fixture.owner),
        body: {
          organizationId: fixture.organization.id,
          roleId: fixture.role.id,
          data: { permission: { project: ["update"] } },
        },
      })
      expect(await producer.submit(value)).toMatchObject({
        status: "already_exists",
        jobId: submitted.jobId,
        state: "failed",
      })
      expect(await facts(fixture)).toEqual({ value: 0, audits: 0 })
    } finally {
      await stop(worker)
    }
  })

  test("排队后移除成员，任务不能借 actorId 或旧 Cookie 恢复成员关系", async () => {
    const fixture = await delegated(),
      submitted = await producer.submit(request(fixture))
    await environment.runtime.auth.api.removeMember({
      headers: await versionHeaders(fixture.owner),
      body: {
        organizationId: fixture.organization.id,
        memberIdOrEmail: fixture.membership.id,
      },
    })
    const worker = await start()
    try {
      expect((await state(submitted.jobId, "failed")).failedReason).toBe(
        "MEMBERSHIP_REQUIRED"
      )
      expect(await facts(fixture)).toEqual({ value: 0, audits: 0 })
    } finally {
      await stop(worker)
    }
  })

  test("平台正式停用后排队的成员业务任务被拒绝", async () => {
    const fixture = await workspace(),
      submitted = await producer.submit(request(fixture))
    const operator = await platformOperator(environment, origin)
    const { rows } = await environment.observer.query(
      "SELECT status_version FROM organization_status WHERE organization_id=$1",
      [fixture.organization.id]
    )
    const suspended = await fetch(
      environment.baseURL +
        `/api/v1/platform/organizations/${fixture.organization.id}/suspend`,
      {
        method: "POST",
        headers: {
          ...Object.fromEntries(operator.headers),
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          reason: "Worker current authorization acceptance",
          expectedVersion: rows[0].status_version,
        }),
      }
    )
    expect(suspended.status).toBe(200)
    const worker = await start()
    try {
      expect((await state(submitted.jobId, "failed")).failedReason).toBe(
        "ORGANIZATION_SUSPENDED"
      )
      expect(await facts(fixture)).toEqual({ value: 0, audits: 0 })
    } finally {
      await stop(worker)
    }
  })

  test("暂时失败有界重试后提交一次，耗尽重试保留失败且业务不变", async () => {
    const fixture = await workspace(),
      worker = await start()
    try {
      const retry = await producer.submit(
        request(fixture, 2, { input: { amount: 2, failAttempts: 1 } })
      )
      const completed = await state(retry.jobId, "completed")
      expect(completed.attemptsMade).toBe(2)
      expect(await facts(fixture)).toEqual({ value: 2, audits: 1 })
      const other = await workspace()
      const exhausted = await producer.submit(
        request(other, 2, { input: { amount: 2, failAttempts: 3 } })
      )
      const failed = await state(exhausted.jobId, "failed")
      expect(failed.attemptsMade).toBe(3)
      expect(failed.failedReason).toBe("EXECUTION_FAILED")
      expect(await facts(other)).toEqual({ value: 0, audits: 0 })
    } finally {
      await stop(worker)
    }
  })

  test("成功审计真实写入失败使业务及幂等回执一同回滚", async () => {
    const fixture = await workspace(),
      submitted = await producer.submit(request(fixture))
    await environment.migrator.query(
      "REVOKE INSERT ON public.audit_events FROM app_runtime"
    )
    const worker = await start()
    try {
      const failed = await state(submitted.jobId, "failed")
      expect(failed.failedReason).toBe("EXECUTION_FAILED")
      expect(await facts(fixture)).toEqual({ value: 0, audits: 0 })
      const receipts = await environment.observer.query(
        "SELECT count(*)::integer AS count FROM worker_test_receipts WHERE organization_id=$1",
        [fixture.organization.id]
      )
      expect(receipts.rows[0].count).toBe(0)
    } finally {
      await stop(worker)
      await environment.migrator.query(
        "GRANT INSERT ON public.audit_events TO app_runtime"
      )
    }
  })

  test("消费者独立拒绝非法输入、未知任务、被篡改身份和跨组织资源，不自动重试", async () => {
    const fixture = await workspace(),
      other = await workspace(),
      worker = await start()
    try {
      const examples = [
        {
          code: "INVALID_TASK",
          change: (value) => ({
            ...value,
            identity: { ...value.identity, actorId: null },
          }),
        },
        {
          code: "UNKNOWN_TASK",
          change: (value) => ({ ...value, type: "test.unknown" }),
        },
        {
          code: "TASK_IDENTITY_MISMATCH",
          jobId: "1".repeat(64),
          change: (value) => value,
        },
        {
          code: "TASK_IDENTITY_MISMATCH",
          change: (value) => ({
            ...value,
            input: { amount: 8, failAttempts: 0 },
          }),
        },
      ]
      for (const example of examples) {
        const value = request(fixture),
          raw = createTaskEnvelope([counterTask()], value)
        const id =
          example.jobId ??
          taskJobId(value.identity, value.type, value.idempotencyKey)
        await queue.add(raw.type, example.change(raw), {
          jobId: id,
          attempts: 3,
          backoff: { type: "fixed", delay: 50 },
        })
        const failed = await state(id, "failed")
        expect(failed.failedReason).toBe(example.code)
        expect(failed.attemptsMade).toBe(1)
      }
      const foreign = request(fixture, 2, {
        identity: {
          ...request(fixture).identity,
          resourceId: other.resourceId,
        },
      })
      await expect(producer.submit(foreign)).rejects.toMatchObject({
        code: "RESOURCE_DENIED",
      })
      const id = taskJobId(
        foreign.identity,
        foreign.type,
        foreign.idempotencyKey
      )
      await queue.add(
        foreign.type,
        createTaskEnvelope([counterTask()], foreign),
        { jobId: id, attempts: 3 }
      )
      expect((await state(id, "failed")).failedReason).toBe("RESOURCE_DENIED")
      expect(await facts(fixture)).toEqual({ value: 0, audits: 0 })
      expect(await facts(other)).toEqual({ value: 0, audits: 0 })
    } finally {
      await stop(worker)
    }
  })

  test("真实 SIGKILL 在提交前释放事务；重启重新领取后只提交一次", async () => {
    const fixture = await workspace(),
      submitted = await producer.submit(request(fixture))
    const worker = await start("before_commit")
    await expect
      .poll(
        () =>
          worker.messages.some(
            (message) =>
              message.kind === "gate" && message.jobId === submitted.jobId
          ),
        { timeout: 10_000 }
      )
      .toBe(true)
    expect(await facts(fixture)).toEqual({ value: 0, audits: 0 })
    expect(await stop(worker, "SIGKILL")).toEqual({
      code: null,
      signal: "SIGKILL",
    })
    const restarted = await start()
    try {
      expect(restarted.pid).not.toBe(worker.pid)
      await state(submitted.jobId, "completed")
      expect(await facts(fixture)).toEqual({ value: 2, audits: 1 })
    } finally {
      await stop(restarted)
    }
  })

  test("真实 SIGKILL 在提交后确认前发生，重新领取识别业务回执而不重复写入", async () => {
    const fixture = await workspace(),
      submitted = await producer.submit(request(fixture))
    const worker = await start("after_commit")
    await expect
      .poll(
        () =>
          worker.messages.some(
            (message) =>
              message.kind === "committed" &&
              message.resourceId === fixture.resourceId
          ),
        { timeout: 10_000 }
      )
      .toBe(true)
    expect(await facts(fixture)).toEqual({ value: 2, audits: 1 })
    expect(await stop(worker, "SIGKILL")).toEqual({
      code: null,
      signal: "SIGKILL",
    })
    const restarted = await start()
    try {
      expect(
        (await state(submitted.jobId, "completed")).returnvalue
      ).toMatchObject({ business: "already_committed" })
      expect(await facts(fixture)).toEqual({ value: 2, audits: 1 })
    } finally {
      await stop(restarted)
    }
  })

  test("已提交后进程死亡再撤权，只拒绝本次尝试并保留原业务成功事实", async () => {
    const fixture = await delegated(),
      submitted = await producer.submit(request(fixture))
    const worker = await start("after_commit")
    await expect
      .poll(
        () =>
          worker.messages.some(
            (message) =>
              message.kind === "committed" &&
              message.resourceId === fixture.resourceId
          ),
        { timeout: 10_000 }
      )
      .toBe(true)
    await stop(worker, "SIGKILL")
    await environment.runtime.auth.api.updateOrgRole({
      headers: await versionHeaders(fixture.owner),
      body: {
        organizationId: fixture.organization.id,
        roleId: fixture.role.id,
        data: { permission: { project: ["read"] } },
      },
    })
    const restarted = await start()
    try {
      expect((await state(submitted.jobId, "failed")).failedReason).toBe(
        "PERMISSION_DENIED"
      )
      expect(await facts(fixture)).toEqual({ value: 2, audits: 1 })
    } finally {
      await stop(restarted)
    }
  })

  test("SIGTERM 等待活动事务并停止领取新任务，重启继续处理等待任务", async () => {
    const fixture = await workspace(),
      other = await workspace(),
      submitted = await producer.submit(request(fixture))
    const worker = await start("before_commit", { concurrency: 1 })
    await expect
      .poll(() => worker.messages.some((message) => message.kind === "gate"), {
        timeout: 10_000,
      })
      .toBe(true)
    worker.kill("SIGTERM")
    await expect
      .poll(() => worker.messages.some((message) => message.kind === "closing"))
      .toBe(true)
    const waiting = await producer.submit(request(other, 4))
    expect(await (await queue.getJob(waiting.jobId)).getState()).toBe("waiting")
    worker.send({ kind: "release", jobId: submitted.jobId })
    expect(await worker.closed).toEqual({ code: 0, signal: null })
    expect(await facts(fixture)).toEqual({ value: 2, audits: 1 })
    expect(await facts(other)).toEqual({ value: 0, audits: 0 })
    const restarted = await start()
    try {
      await state(waiting.jobId, "completed")
      expect(await facts(other)).toEqual({ value: 4, audits: 1 })
    } finally {
      await stop(restarted)
    }
  })

  test("不存在的组织是永久授权拒绝，不消耗暂时失败重试", async () => {
    const fixture = await workspace(),
      value = request(fixture)
    value.identity.organizationId = randomUUID()
    const id = taskJobId(value.identity, value.type, value.idempotencyKey)
    await queue.add(value.type, createTaskEnvelope([counterTask()], value), {
      jobId: id,
      attempts: 3,
      backoff: { type: "fixed", delay: 50 },
    })
    const worker = await start()
    try {
      const failed = await state(id, "failed")
      expect(failed.failedReason).toBe("MEMBERSHIP_REQUIRED")
      expect(failed.attemptsMade).toBe(1)
      expect(await facts(fixture)).toEqual({ value: 0, audits: 0 })
    } finally {
      await stop(worker)
    }
  })

  test("真实 Redis 已收到任务但响应丢失时报告未知，重复提交保留任务身份", async () => {
    const warm = await workspace(),
      fixture = await workspace()
    const gate = await redisResponseGate(
      redis.getHost(),
      redis.getMappedPort(6379)
    )
    const gated = createTaskProducer({
      config: { ...config, redisUrl: gate.url },
      registry: [counterTask()],
      runInTenant: createTaskTenantRunner(environment.runtime.pool),
      log: () => {},
    })
    try {
      expect((await gated.submit(request(warm))).status).toBe("enqueued")
      const value = request(fixture),
        begun = Date.now()
      gate.block(taskJobId(value.identity, value.type, value.idempotencyKey))
      const uncertain = await gated.submit(value)
      expect(uncertain.status).toBe("unknown")
      expect(Date.now() - begun).toBeLessThan(3000)
      expect(await queue.getJob(uncertain.jobId)).toBeDefined()
      gate.release()
      expect(await producer.submit(value)).toMatchObject({
        status: "already_exists",
        jobId: uncertain.jobId,
      })
      const worker = await start()
      try {
        await state(uncertain.jobId, "completed")
        expect(await facts(fixture)).toEqual({ value: 2, audits: 1 })
      } finally {
        await stop(worker)
      }
    } finally {
      await gated.close()
      await gate.close()
    }
  })

  test("两个真实 Worker 并发处理不同组织，不串上下文或重复成功审计", async () => {
    const a = await workspace(),
      b = await workspace()
    const workers = await Promise.all([start(), start()])
    try {
      const submissions = await Promise.all([
        ...Array.from({ length: 6 }, () => producer.submit(request(a, 2))),
        ...Array.from({ length: 5 }, () => producer.submit(request(b, 3))),
      ])
      await Promise.all(
        submissions.map((submission) => state(submission.jobId, "completed"))
      )
      expect(await facts(a)).toEqual({ value: 12, audits: 6 })
      expect(await facts(b)).toEqual({ value: 15, audits: 5 })
    } finally {
      await Promise.all(workers.map((worker) => stop(worker)))
    }
  })

  test("两个存活 Worker 重叠领取同一业务意图，事务与回执只提交一次业务和成功审计", async () => {
    const fixture = await workspace(),
      submitted = await producer.submit(request(fixture))
    const first = await start("before_commit", { concurrency: 1 })
    let second
    try {
      await expect
        .poll(
          () =>
            first.messages.some(
              (message) =>
                message.kind === "gate" && message.jobId === submitted.jobId
            ),
          { timeout: 10_000 }
        )
        .toBe(true)
      expect(await facts(fixture)).toEqual({ value: 0, audits: 0 })
      // 暂停整个真实进程使租约无法续期；旧事务仍存活，第二实例必须与它协调业务幂等。
      expect(first.kill("SIGSTOP")).toBe(true)
      second = await start(undefined, { concurrency: 1 })
      await expect
        .poll(
          () =>
            second.messages.some(
              (message) =>
                message.kind === "log" &&
                message.event.event === "task_started" &&
                message.event.jobId === submitted.jobId
            ),
          { timeout: 15_000 }
        )
        .toBe(true)
      expect(
        (await state(submitted.jobId, "active")).attemptsStarted
      ).toBeGreaterThanOrEqual(2)
      expect(first.exitCode).toBeNull()
      expect(first.signalCode).toBeNull()
      expect(second.pid).not.toBe(first.pid)
      first.send({ kind: "release", jobId: submitted.jobId })
      expect(first.kill("SIGCONT")).toBe(true)
      expect(
        (await state(submitted.jobId, "completed")).returnvalue
      ).toMatchObject({
        business: "already_committed",
        result: { value: 2 },
      })
      expect(await facts(fixture)).toEqual({ value: 2, audits: 1 })
      const receipts = await environment.observer.query(
        "SELECT count(*)::integer AS count FROM worker_test_receipts WHERE organization_id=$1 AND actor_id=$2 AND task_type='test.increment'",
        [fixture.organization.id, fixture.actor.user.id]
      )
      expect(receipts.rows[0].count).toBe(1)
    } finally {
      first.kill("SIGCONT")
      first.send({ kind: "release", jobId: submitted.jobId })
      expect(await stop(first)).toEqual({ code: 0, signal: null })
      if (second) expect(await stop(second)).toEqual({ code: 0, signal: null })
    }
  })

  test("Redis 正常持久化重启保留排队任务，消费者连接恢复后继续执行", async () => {
    const fixture = await workspace(),
      submitted = await producer.submit(request(fixture))
    await redis.restart()
    expect(await queue.getJob(submitted.jobId)).toBeDefined()
    const worker = await start()
    try {
      await state(submitted.jobId, "completed")
      expect(await facts(fixture)).toEqual({ value: 2, audits: 1 })
      await redis.restart()
      const value = request(fixture, 3)
      let next
      // 生产者不在断线期间离线排队；调用方按同一意图确认/重试，消费者自行恢复连接。
      await expect
        .poll(
          async () => {
            next = await producer.submit(value)
            return next.status !== "unknown"
          },
          { timeout: 10_000 }
        )
        .toBe(true)
      await state(next.jobId, "completed")
      expect(await facts(fixture)).toEqual({ value: 5, audits: 2 })
    } finally {
      await stop(worker)
    }
  })

  test("关闭期限耗尽时非零退出，活动事务回滚且重启仍可恢复", async () => {
    const fixture = await workspace(),
      submitted = await producer.submit(request(fixture))
    const worker = await start("before_commit", { shutdownMs: 300 })
    await expect
      .poll(() => worker.messages.some((message) => message.kind === "gate"), {
        timeout: 10_000,
      })
      .toBe(true)
    expect(await stop(worker)).toEqual({ code: 1, signal: null })
    expect(await facts(fixture)).toEqual({ value: 0, audits: 0 })
    const restarted = await start()
    try {
      await state(submitted.jobId, "completed")
      expect(await facts(fixture)).toEqual({ value: 2, audits: 1 })
    } finally {
      await stop(restarted)
    }
  })

  test("排队后退出浏览器会话不取消仍有当前成员权限的任务", async () => {
    const fixture = await workspace(),
      submitted = await producer.submit(request(fixture))
    await environment.runtime.auth.api.signOut({
      headers: fixture.actor.headers,
    })
    const worker = await start()
    try {
      await state(submitted.jobId, "completed")
      expect(await facts(fixture)).toEqual({ value: 2, audits: 1 })
    } finally {
      await stop(worker)
    }
  })

  test("执行异常的原始秘密不进入结构化日志或 Redis 失败原因", async () => {
    const fixture = await workspace(),
      canary = "private-test-credential-canary"
    const worker = await start(
      undefined,
      {},
      { WORKER_TEST_FAILURE_HINT: canary }
    )
    try {
      const submitted = await producer.submit(
        request(fixture, 2, { input: { amount: 2, failAttempts: 3 } })
      )
      const failed = await state(submitted.jobId, "failed")
      expect(failed.failedReason).toBe("EXECUTION_FAILED")
      expect(JSON.stringify(failed.stacktrace)).not.toContain(canary)
      expect(JSON.stringify(worker.messages)).not.toContain(canary)
      expect(worker.output).not.toContain(canary)
      expect(await facts(fixture)).toEqual({ value: 0, audits: 0 })
    } finally {
      await stop(worker)
    }
  })

  test("未提交时进程死亡随后撤权，重新领取不能补做原业务", async () => {
    const fixture = await delegated(),
      submitted = await producer.submit(request(fixture))
    const worker = await start("before_commit")
    await expect
      .poll(() => worker.messages.some((message) => message.kind === "gate"), {
        timeout: 10_000,
      })
      .toBe(true)
    await stop(worker, "SIGKILL")
    await environment.runtime.auth.api.updateOrgRole({
      headers: await versionHeaders(fixture.owner),
      body: {
        organizationId: fixture.organization.id,
        roleId: fixture.role.id,
        data: { permission: { project: ["read"] } },
      },
    })
    const restarted = await start()
    try {
      expect((await state(submitted.jobId, "failed")).failedReason).toBe(
        "PERMISSION_DENIED"
      )
      expect(await facts(fixture)).toEqual({ value: 0, audits: 0 })
    } finally {
      await stop(restarted)
    }
  })
})
