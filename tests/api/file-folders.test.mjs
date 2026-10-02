import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startFilesEnvironment } from "../setup/files-environment.mjs"

const require = createRequire(resolve("apps/api/package.json"))
const {
  FilePhysicalScope,
} = require("../../apps/api/dist/files/file-physical-scope.js")
const origin = "http://localhost:3200"

for (const kind of ["Local", "RustFS"])
  describe(kind + ": formal file folder writes", () => {
    const resources = new AsyncDisposableStack()
    let environment
    beforeAll(async () => {
      environment = await startFilesEnvironment(kind, resources)
    })
    afterAll(() => resources.disposeAsync())

    const request = (fixture, suffix, actor = fixture.actor, options = {}) =>
      fetch(
        environment.filesBaseURL +
          `/api/v1/organizations/${fixture.organization.id}/files${suffix}`,
        {
          ...options,
          headers: { ...Object.fromEntries(actor.headers), ...options.headers },
        }
      )
    const create = (fixture, input, actor = fixture.actor) =>
      request(fixture, "/folders", actor, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      })
    const input = (fixture, name, parentId = fixture.root.id) => ({
      operationId: randomUUID(),
      parentId,
      name,
    })
    async function workspace() {
      const actor = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      const organization =
        await environment.runtime.auth.api.createOrganization({
          headers: actor.headers,
          body: { name: "真实文件夹", slug: randomUUID() },
        })
      const fixture = { actor, organization }
      const response = await request(fixture, "/workspace")
      expect(response.status).toBe(200)
      return { ...fixture, ...(await response.json()) }
    }
    const location = (fixture, segments) => ({
      owner: { kind: "organization", id: fixture.organization.id },
      area: "files",
      segments,
    })
    const operation = async (fixture, id, actor = fixture.actor) => {
      const response = await request(fixture, "/operations/" + id, actor)
      expect(response.status).toBe(200)
      return response.json()
    }
    async function assertFailed(fixture, value, code) {
      const receipt = await operation(fixture, value.operationId)
      expect(receipt).toMatchObject({
        phase: "failed",
        committedAt: null,
        errorCode: code,
      })
      const facts = await environment.observer.query(
        "SELECT (SELECT count(*) FROM file_namespace_reservations WHERE operation_id=$1)::int AS reservations, (SELECT count(*) FROM file_entries WHERE busy_operation_id=$1)::int AS busy",
        [value.operationId]
      )
      expect(facts.rows[0]).toEqual({ reservations: 0, busy: 0 })
    }

    test("正式创建空目录、子目录和246字节名称，刷新可见真实层级且容量不变", async () => {
      const fixture = await workspace()
      const parent = input(fixture, "合同")
      const response = await create(fixture, parent)
      expect(response.status).toBe(200)
      const receipt = await response.json()
      expect(receipt).toMatchObject({
        phase: "completed",
        action: "create-folder",
        errorCode: null,
      })
      expect(receipt.result.revision).toBe(1)
      expect(
        await environment.physical.directoryExists(location(fixture, ["合同"]))
      ).toBe(true)
      const child = input(fixture, "عقود", receipt.result.entryId)
      expect((await create(fixture, child)).status).toBe(200)
      const boundary = input(fixture, "中".repeat(82), receipt.result.entryId)
      expect((await create(fixture, boundary)).status).toBe(200)
      expect(
        await environment.physical.directoryExists(
          location(fixture, ["合同", boundary.name])
        )
      ).toBe(true)
      const tooLong = input(fixture, "中".repeat(83))
      expect((await create(fixture, tooLong)).status).toBe(400)
      const listing = await request(
        fixture,
        `?parentId=${receipt.result.entryId}`
      )
      expect(listing.status).toBe(200)
      const page = await listing.json()
      expect(page.items.map((entry) => entry.name).sort()).toEqual(
        [boundary.name, child.name].sort()
      )
      const breadcrumbs = await request(
        fixture,
        `/folders/${receipt.result.entryId}/breadcrumbs`
      )
      expect(
        (await breadcrumbs.json()).items.map((entry) => entry.name)
      ).toEqual(["", "合同"])
      const refreshed = await request(fixture, "/workspace")
      expect((await refreshed.json()).usage).toMatchObject({
        usedBytes: 0,
        reservedBytes: 0,
        transientBytes: 0,
      })
    })

    test("同一身份重复创建返回原收据；不同输入拒绝且仅有一个目录和成功审计", async () => {
      const fixture = await workspace(),
        value = input(fixture, "重复确认")
      const first = await create(fixture, value)
      const receipt = await first.json()
      expect(first.status).toBe(200)
      const replay = await create(fixture, value)
      expect(replay.status).toBe(200)
      expect(await replay.json()).toEqual(receipt)
      const conflict = await create(fixture, { ...value, name: "不同输入" })
      expect(conflict.status).toBe(409)
      expect((await conflict.json()).code).toBe("IDEMPOTENCY_KEY_REUSED")
      const facts = await environment.observer.query(
        "SELECT count(*)::int AS count FROM audit_events WHERE event_code='folder.created' AND operation_id=$1",
        [value.operationId]
      )
      expect(facts.rows[0].count).toBe(1)
      expect(await operation(fixture, value.operationId)).toEqual(receipt)
    })

    test("同级冲突与跨组织目标保留失败事实，修改名称必须使用新的身份", async () => {
      const fixture = await workspace(),
        other = await workspace()
      expect((await create(fixture, input(fixture, "同名"))).status).toBe(200)
      const duplicate = input(fixture, "同名")
      const conflict = await create(fixture, duplicate)
      expect(conflict.status).toBe(409)
      expect((await conflict.json()).code).toBe("FILE_NAME_CONFLICT")
      await assertFailed(fixture, duplicate, "FILE_NAME_CONFLICT")
      expect(
        (await create(fixture, { ...duplicate, name: "已修正" })).status
      ).toBe(409)
      expect((await create(fixture, input(fixture, "已修正"))).status).toBe(200)
      const foreign = input(fixture, "外部目标", other.root.id)
      expect((await create(fixture, foreign)).status).toBe(404)
      await assertFailed(fixture, foreign, "NOT_FOUND")
      expect(
        await environment.physical.directoryExists(
          location(other, ["外部目标"])
        )
      ).toBe(false)
    })

    test("只具有创建动作的当前成员可查询自己的操作；只读、他人事实和撤权均按实际权限拒绝", async () => {
      const fixture = await workspace()
      const writer = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      const member = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      const role = (
        await environment.runtime.auth.api.createOrgRole({
          headers: fixture.actor.headers,
          body: {
            organizationId: fixture.organization.id,
            role: "folders-only",
            permission: { folder: ["create"] },
          },
        })
      ).roleData
      for (const [actor, roleName] of [
        [writer, "folders-only"],
        [member, "member"],
      ])
        await environment.runtime.auth.api.addMember({
          headers: fixture.actor.headers,
          body: {
            organizationId: fixture.organization.id,
            userId: actor.user.id,
            role: roleName,
          },
        })
      expect(
        (await create(fixture, input(fixture, "只读拒绝"), member)).status
      ).toBe(403)
      expect(
        (
          await fetch(
            environment.filesBaseURL +
              `/api/v1/organizations/${fixture.organization.id}/files/folders`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(input(fixture, "匿名拒绝")),
            }
          )
        ).status
      ).toBe(401)
      const value = input(fixture, "仅创建")
      expect((await create(fixture, value, writer)).status).toBe(200)
      expect((await operation(fixture, value.operationId, writer)).phase).toBe(
        "completed"
      )
      expect((await request(fixture, "/workspace", writer)).status).toBe(403)
      const owned = input(fixture, "其他成员操作")
      expect((await create(fixture, owned)).status).toBe(200)
      expect(
        (await request(fixture, "/operations/" + owned.operationId, writer))
          .status
      ).toBe(403)
      const authorization = await environment.observer.query(
        "SELECT authorization_version FROM organization_status WHERE organization_id=$1",
        [fixture.organization.id]
      )
      const versionHeaders = new Headers(fixture.actor.headers)
      versionHeaders.set(
        "X-Expected-Authz-Version",
        String(authorization.rows[0].authorization_version)
      )
      await environment.runtime.auth.api.updateOrgRole({
        headers: versionHeaders,
        body: {
          organizationId: fixture.organization.id,
          roleId: role.id,
          data: { permission: { project: ["read"] } },
        },
      })
      expect(
        (await create(fixture, input(fixture, "既有Cookie撤权"), writer)).status
      ).toBe(403)
      expect(
        (await request(fixture, "/operations/" + value.operationId, writer))
          .status
      ).toBe(403)
    })

    test("等待物理锁期间会话撤销后不能受理；旧请求不创建目录或操作事实", async () => {
      const fixture = await workspace(),
        value = input(fixture, "撤销等待")
      const scope = new FilePhysicalScope(environment.config.databaseURL)
      resources.defer(() => scope[Symbol.asyncDispose]())
      const started = Promise.withResolvers(),
        release = Promise.withResolvers()
      const holder = scope.run(location(fixture, []).owner, async () => {
        started.resolve()
        await release.promise
      })
      await started.promise
      const response = create(fixture, value)
      try {
        await vi.waitFor(async () => {
          const waiting = await environment.observer.query(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name='enterprise-admin:files-physical-scope' AND wait_event='advisory'"
          )
          expect(waiting.rows[0].count).toBe(1)
        })
        await environment.observer.query(
          "DELETE FROM session WHERE user_id=$1",
          [fixture.actor.user.id]
        )
      } finally {
        release.resolve()
        await holder
      }
      expect((await response).status).toBe(401)
      expect(
        await environment.physical.directoryExists(
          location(fixture, [value.name])
        )
      ).toBe(false)
      const facts = await environment.observer.query(
        "SELECT count(*)::int AS count FROM file_operations WHERE id=$1",
        [value.operationId]
      )
      expect(facts.rows[0].count).toBe(0)
    })

    test("发布审计失败后恢复未创建状态，旧身份保持失败；新身份可重新使用名称", async () => {
      const fixture = await workspace(),
        value = input(fixture, "审计阻止发布")
      const identifier = "folder_failure_" + randomUUID().replaceAll("-", "")
      await environment.observer.query(
        `CREATE FUNCTION public.${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_id='${value.operationId}' AND NEW.event_code='folder.created' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END; $$; CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION public.${identifier}()`
      )
      try {
        expect((await create(fixture, value)).status).toBe(500)
        await assertFailed(fixture, value, "INTERNAL_ERROR")
        expect(
          await environment.physical.directoryExists(
            location(fixture, [value.name])
          )
        ).toBe(false)
        const entries = await environment.observer.query(
          "SELECT count(*)::int AS count FROM file_entries WHERE organization_id=$1 AND name=$2",
          [fixture.organization.id, value.name]
        )
        expect(entries.rows[0].count).toBe(0)
      } finally {
        await environment.observer.query(
          `DROP TRIGGER ${identifier} ON audit_events; DROP FUNCTION public.${identifier}()`
        )
      }
      expect((await create(fixture, value)).status).toBe(200)
      expect((await operation(fixture, value.operationId)).phase).toBe("failed")
      expect((await create(fixture, input(fixture, value.name))).status).toBe(
        200
      )
    })

    test("十个组织同时受理时，持物理锁的事务不会占满身份连接池", async () => {
      const fixture = await workspace()
      const fixtures = [fixture]
      for (let index = 1; index < 10; index++) {
        const organization =
          await environment.runtime.auth.api.createOrganization({
            headers: fixture.actor.headers,
            body: { name: "并行目录" + index, slug: randomUUID() },
          })
        const sibling = { actor: fixture.actor, organization }
        const response = await request(sibling, "/workspace")
        expect(response.status).toBe(200)
        fixtures.push({ ...sibling, ...(await response.json()) })
      }
      const replies = await Promise.all(
        fixtures.map((value, index) =>
          create(value, input(value, "并行" + index))
        )
      )
      for (const response of replies) {
        expect(response.status).toBe(200)
        expect((await response.json()).phase).toBe("completed")
      }
      for (const [index, value] of fixtures.entries())
        expect(
          await environment.physical.directoryExists(
            location(value, ["并行" + index])
          )
        ).toBe(true)
    })
  })
