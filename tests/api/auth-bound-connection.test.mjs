import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDatabase } from "../../packages/database/dist/index.js"
import { createTenantRunner } from "../../packages/database/dist/tenant.js"
import { fileRepository } from "../../packages/database/dist/repositories/files.js"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startTestApplication } from "../setup/test-runtime.mjs"

describe("Files final native authorization on the owned database connection", () => {
  const origin = "http://localhost:3200"
  let environment, physicalPool
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    physicalPool = createDatabase(environment.config.databaseURL).pool
  })
  afterAll(async () => {
    await physicalPool?.end()
    await environment?.close()
  })

  it("completes canonical permission and error language checks while ten native writes wait on its status lock", async () => {
    const { runtime, baseURL, migrator } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Bound authorization", slug: randomUUID() },
    })
    const admins = []
    for (let i = 0; i < runtime.pool.options.max; i++) {
      const admin = await signUpVerified(baseURL, origin, migrator)
      await runtime.auth.api.addMember({
        headers: owner.headers,
        body: { organizationId: org.id, userId: admin.user.id, role: "admin" },
      })
      admins.push(admin)
    }
    expect(admins).toHaveLength(10)
    const actor = (
      await migrator.query(
        `SELECT m.id AS membership_id, s.id AS session_id
         FROM member m JOIN session s ON s.user_id=m.user_id
         WHERE m.organization_id=$1 AND m.user_id=$2`,
        [org.id, owner.user.id]
      )
    ).rows[0]
    const previousSession = (
      await migrator.query(
        "UPDATE session SET expires_at=now()+interval '1 hour',updated_at=now()-interval '2 days' WHERE id=$1 RETURNING updated_at",
        [actor.session_id]
      )
    ).rows[0]
    const context = {
      organizationId: org.id,
      userId: owner.user.id,
      membershipId: actor.membership_id,
      requestId: randomUUID(),
      locale: "zh-CN",
    }
    const client = await physicalPool.connect()
    const roles = admins.map(() => `pending-${randomUUID()}`)
    const operationId = randomUUID()
    let pending = []
    const checks = []
    const completeWhileLocked = async (work) => {
      checks.push(work)
      let timer
      try {
        return await Promise.race([
          work,
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error("bound authorization borrowed the saturated pool")
                ),
              3000
            )
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
    }
    try {
      await createTenantRunner(client)(context, async (tx) => {
        await fileRepository.lockOrganization(tx)
        await fileRepository.requireCurrentActor(tx, actor.session_id)
        await fileRepository.beginOperation(tx, {
          id: operationId,
          action: "create-folder",
          input: {},
          requestHash: "a".repeat(64),
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        const before = (
          await client.query(
            "SELECT pg_backend_pid() AS pid,txid_current() AS txid"
          )
        ).rows[0]
        pending = admins.map((admin, i) =>
          runtime.auth.api.createOrgRole({
            headers: admin.headers,
            body: {
              organizationId: org.id,
              role: roles[i],
              permission: { project: ["read"] },
            },
          })
        )
        // 必须观察到真实原生事务占满 pool 并等待行锁，不能用人工借连接替代竞争。
        let waiting = 0
        for (let i = 0; i < 300; i++) {
          await client.query("SELECT pg_stat_clear_snapshot()")
          waiting = Number(
            (
              await client.query(
                `SELECT count(*) AS total FROM pg_stat_activity
                 WHERE usename=current_user AND pid<>pg_backend_pid()
                   AND wait_event_type='Lock' AND query LIKE '%require_active_organization%'`
              )
            ).rows[0].total
          )
          if (waiting === 10) break
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(
          waiting,
          JSON.stringify(
            (
              await client.query(
                "SELECT wait_event_type,query FROM pg_stat_activity WHERE usename=current_user AND pid<>pg_backend_pid()"
              )
            ).rows
          )
        ).toBe(10)
        expect(runtime.pool.totalCount).toBe(10)
        expect(runtime.pool.idleCount).toBe(0)
        expect(runtime.pool.waitingCount).toBe(0)
        await expect(
          completeWhileLocked(
            runtime.auth.withDatabaseClient(client, () =>
              runtime.auth.api.hasPermission({
                headers: owner.headers,
                body: {
                  organizationId: org.id,
                  permissions: { project: ["create"] },
                },
              })
            )
          )
        ).resolves.toMatchObject({ success: true })
        // 错误投影也会读取平台默认语言，必须沿用绑定连接。
        await expect(
          completeWhileLocked(
            runtime.auth.withDatabaseClient(client, () =>
              runtime.auth.api.hasPermission({
                headers: owner.headers,
                body: {
                  organizationId: randomUUID(),
                  permissions: { project: ["read"] },
                },
              })
            )
          )
        ).rejects.toMatchObject({
          statusCode: 403,
          body: { code: "FORBIDDEN" },
        })
        const marker = new Error("caller-owned failure")
        await expect(
          runtime.auth.withDatabaseClient(client, async () => {
            throw marker
          })
        ).rejects.toBe(marker)
        const after = (
          await client.query(
            "SELECT pg_backend_pid() AS pid,txid_current() AS txid"
          )
        ).rows[0]
        expect(after).toEqual(before)
        expect(
          await fileRepository.findOperation(tx, operationId)
        ).toMatchObject({ id: operationId })
        expect(runtime.pool.waitingCount).toBe(0)
        expect(
          (
            await client.query("SELECT updated_at FROM session WHERE id=$1", [
              actor.session_id,
            ])
          ).rows[0].updated_at
        ).toEqual(previousSession.updated_at)
        // 外部事务的回滚权属于 Files；绑定方法不能提前提交其已有事实。
        throw marker
      }).catch((error) => {
        if (error.message !== "caller-owned failure") throw error
      })
      const results = await Promise.all(pending)
      expect(results).toHaveLength(10)
      expect(
        (
          await migrator.query(
            "SELECT role FROM organization_role WHERE organization_id=$1 AND role=ANY($2::text[])",
            [org.id, roles]
          )
        ).rows
      ).toHaveLength(10)
      expect(
        await createTenantRunner(client)(context, (tx) =>
          fileRepository.findOperation(tx, operationId)
        )
      ).toBeUndefined()
      await expect(
        runtime.auth.api.hasPermission({
          headers: owner.headers,
          body: {
            organizationId: org.id,
            permissions: { project: ["create"] },
          },
        })
      ).resolves.toMatchObject({ success: true })
    } finally {
      await client.query("ROLLBACK")
      await Promise.allSettled([...pending, ...checks])
      client.release()
    }
  })
})
