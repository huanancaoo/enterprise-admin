import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createHash, randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import {
  configureApiClient,
  executeFileBatch,
  getFileBatch,
} from "../../packages/api-client/src/index.ts"
import { createTenantRunner } from "../../packages/database/dist/tenant.js"
import { fileRepository } from "../../packages/database/dist/repositories/files.js"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startFilesEnvironment } from "../setup/files-environment.mjs"

const require = createRequire(resolve("apps/api/package.json"))
const {
  TenantContextService,
} = require("../../apps/api/dist/tenancy/tenant-context.service.js")
const {
  RequestLanguage,
} = require("../../apps/api/dist/http/request-language.js")
const origin = "http://localhost:3200"
const sha = (value) => createHash("sha256").update(value).digest("hex")

for (const kind of ["Local", "RustFS"])
  describe(kind + ": formal ordered file batches", () => {
    const resources = new AsyncDisposableStack()
    let environment
    beforeAll(async () => {
      environment = await startFilesEnvironment(kind, resources)
    })
    afterAll(() => resources.disposeAsync())
    const run = (fixture, callback) =>
      createTenantRunner(environment.runtime.pool)(
        fixture.context,
        callback,
        "write"
      )
    const request = (fixture, suffix, options = {}, actor = fixture.actor) =>
      fetch(
        environment.filesBaseURL +
          `/api/v1/organizations/${fixture.organization.id}/files${suffix}`,
        {
          ...options,
          headers: { ...Object.fromEntries(actor.headers), ...options.headers },
        }
      )
    const post = (fixture, entry, action, fields = {}, actor = fixture.actor) =>
      request(
        fixture,
        `/entries/${entry.id}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operationId: randomUUID(),
            expectedRevision: entry.revision,
            ...fields,
          }),
        },
        actor
      )
    const address = (fixture, area, segments) => ({
      owner: { kind: "organization", id: fixture.organization.id },
      area,
      segments,
    })
    const bytes = async (location) => {
      const read = await environment.physical.read(location)
      return read.missing ? null : Buffer.from(read.base64, "base64")
    }
    const entry = (fixture, id) =>
      createTenantRunner(environment.runtime.pool)(fixture.context, (tx) =>
        fileRepository.findEntry(tx, id)
      )
    const receipt = async (fixture, id) => {
      const response = await request(fixture, `/operations/${id}`)
      expect(response.status).toBe(200)
      return response.json()
    }
    const usage = async (fixture) =>
      (
        await environment.observer.query(
          "SELECT * FROM file_storage_usage WHERE organization_id=$1",
          [fixture.organization.id]
        )
      ).rows[0]
    async function success(
      fixture,
      value,
      action,
      fields = {},
      actor = fixture.actor
    ) {
      const response = await post(fixture, value, action, fields, actor),
        body = await response.json()
      expect(response.status, JSON.stringify(body)).toBe(200)
      expect(body).toMatchObject({
        action,
        phase: "completed",
        errorCode: null,
      })
      expect(body.committedAt).not.toBeNull()
      return { receipt: body, entry: await entry(fixture, value.id) }
    }
    async function workspace() {
      const actor = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      const organization =
        await environment.runtime.auth.api.createOrganization({
          headers: actor.headers,
          body: { name: "路径验证", slug: randomUUID() },
        })
      const fixture = { actor, organization }
      const response = await request(fixture, "/workspace")
      expect(response.status).toBe(200)
      const { root } = await response.json()
      const context = await environment.app
        .get(TenantContextService)
        .resolve(
          actor.headers,
          organization.id,
          { file: ["read"], folder: ["read"] },
          randomUUID(),
          new RequestLanguage("zh-CN")
        )
      await environment.physical.ensureOwner({
        kind: "organization",
        id: organization.id,
      })
      return { ...fixture, root, context }
    }
    async function folder(fixture, name, parent = fixture.root) {
      const response = await request(fixture, "/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationId: randomUUID(),
          parentId: parent.id,
          name,
        }),
      })
      const body = await response.json()
      expect(response.status, JSON.stringify(body)).toBe(200)
      return entry(fixture, body.result.entryId)
    }
    // 通过真实 Repo 与物理对象建立文件，以便独立验收批量操作的正式 HTTP 链路。
    async function upload(
      fixture,
      name,
      parent = fixture.root,
      body = Buffer.from("真实文件字节")
    ) {
      const fileId = randomUUID(),
        versionId = randomUUID(),
        location = address(fixture, "files", [...parent.path, name])
      const prepared = await run(fixture, async (tx) => {
        const { operation } = await fileRepository.beginOperation(tx, {
          id: randomUUID(),
          action: "upload",
          requestHash: sha(name),
          input: { name },
          expiresAt: new Date(Date.now() + 86400000),
        })
        await fileRepository.reserveUpload(tx, operation.id, {
          parentId: parent.id,
          name,
          declaredBytes: body.length,
        })
        const [object] = await fileRepository.addObjects(tx, operation.id, [
          {
            entryId: fileId,
            versionId,
            directory: false,
            targetArea: "files",
            targetPath: location.segments,
            expectedBytes: body.length,
          },
        ])
        return { operation, object }
      })
      const facts = await environment.physical.write(location, body)
      const value = await run(fixture, async (tx) => {
        await fileRepository.recordPreparedObject(
          tx,
          prepared.operation.id,
          prepared.object.id,
          { ...facts, transientBytes: 0 }
        )
        const value = await fileRepository.commitUpload(
          tx,
          prepared.operation.id,
          {
            fileId,
            versionId,
            objectId: prepared.object.id,
            parentId: parent.id,
            name,
            contentType: "application/octet-stream",
          }
        )
        await fileRepository.finishOperation(
          tx,
          prepared.operation.id,
          new Date()
        )
        return value
      })
      return { ...value, versionId, location, facts, body }
    }
    const selected = (value, revision = value.revision) => ({
      entryId: value.id,
      expectedRevision: revision,
      operationId: randomUUID(),
    })
    const input = (action, values, fields = {}) => ({
      batchId: randomUUID(),
      action,
      items: values.map((value) => selected(value)),
      ...fields,
    })
    const execute = (fixture, value, actor = fixture.actor) =>
      request(
        fixture,
        "/batches",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(value),
        },
        actor
      )
    async function batch(fixture, value, actor = fixture.actor) {
      const response = await execute(fixture, value, actor),
        body = await response.json()
      expect(response.status, JSON.stringify(body)).toBe(200)
      expect(body.batchId).toBe(value.batchId)
      return body
    }
    async function get(fixture, id, actor = fixture.actor) {
      const response = await request(fixture, "/batches/" + id, {}, actor),
        body = await response.json()
      expect(response.status, JSON.stringify(body)).toBe(200)
      return body
    }
    async function plan(fixture, value) {
      return run(fixture, (tx) =>
        fileRepository.beginBatch(tx, {
          id: value.batchId,
          action: value.action,
          parentId: value.parentId,
          requestHash: sha(
            JSON.stringify({
              action: value.action,
              parentId: value.parentId ?? null,
              items: value.items,
            })
          ),
          items: value.items,
        })
      )
    }
    const countOperations = async (ids) =>
      (
        await environment.observer.query(
          "SELECT count(*)::int AS count FROM file_operations WHERE id=ANY($1::uuid[])",
          [ids]
        )
      ).rows[0].count

    test("正式生成SDK执行批量移动并通过同一batchId读取固定版本与根映射", async () => {
      const f = await workspace(),
        tree = await folder(f, "sdk-tree"),
        child = await upload(f, "sdk.bin", tree),
        target = await folder(f, "sdk-target")
      const value = input("move", [child, tree], { parentId: target.id })
      configureApiClient({
        baseUrl: environment.filesBaseURL,
        getHeaders: () => f.actor.headers,
      })
      const result = await executeFileBatch(f.organization.id, value)
      expect(result.status).toBe(200)
      expect(result.data.items).toMatchObject([
        {
          index: 0,
          entryId: child.id,
          requestedOperationId: value.items[0].operationId,
          rootIndex: 1,
          operationId: value.items[1].operationId,
          state: "covered",
          operation: { phase: "completed" },
        },
        {
          index: 1,
          entryId: tree.id,
          rootIndex: 1,
          state: "completed",
          operation: { phase: "completed" },
        },
      ])
      const saved = await getFileBatch(f.organization.id, value.batchId)
      expect(saved.status).toBe(200)
      expect(saved.data).toEqual(result.data)
      expect((await entry(f, child.id)).currentVersionId).toBe(child.versionId)
      expect(
        await bytes(address(f, "files", [target.name, tree.name, child.name]))
      ).toEqual(child.body)
      expect(await bytes(child.location)).toBeNull()
    })

    test("固定 child-before-parent 分组与请求序号，根冲突和 revision 失败独立于成功根", async () => {
      const f = await workspace(),
        tree = await folder(f, "tree"),
        child = await upload(f, "child.bin", tree),
        blocked = await upload(f, "blocked.bin"),
        stale = await folder(f, "stale"),
        target = await folder(f, "target")
      await upload(f, blocked.name, target)
      const value = input("move", [child, tree, blocked, stale], {
        parentId: target.id,
      })
      value.items[3].expectedRevision = 9
      const result = await batch(f, value)
      expect(result.items.map((item) => item.state)).toEqual([
        "covered",
        "completed",
        "failed",
        "failed",
      ])
      expect(result.items.map((item) => item.rootIndex)).toEqual([1, 1, 2, 3])
      expect(result.items.map((item) => item.index)).toEqual([0, 1, 2, 3])
      expect(result.items[0]).toMatchObject({
        requestedOperationId: value.items[0].operationId,
        operationId: value.items[1].operationId,
      })
      expect(result.items[2].error.code).toBe("FILE_NAME_CONFLICT")
      expect(result.items[3].error.code).toBe("VERSION_CONFLICT")
      expect(await countOperations([value.items[0].operationId])).toBe(0)
      expect(
        await bytes(address(f, "files", [target.name, tree.name, child.name]))
      ).toEqual(child.body)
      expect(await bytes(child.location)).toBeNull()
      expect(await bytes(blocked.location)).toEqual(blocked.body)
      expect((await entry(f, stale.id)).revision).toBe(1)
      expect(await batch(f, value)).toEqual(result)
      expect(await get(f, value.batchId)).toEqual(result)
      const changed = structuredClone(value)
      changed.items[3].expectedRevision = 1
      const response = await execute(f, changed)
      expect(response.status).toBe(409)
      expect((await response.json()).code).toBe("IDEMPOTENCY_KEY_REUSED")
      const audits = await environment.observer.query(
        "SELECT count(*)::int AS count FROM audit_events WHERE operation_id=$1 AND event_code='folder.moved'",
        [value.items[1].operationId]
      )
      expect(audits.rows[0].count).toBe(1)
    })

    test("批量 trash、restore、purge 按子树一次处理，真实目录对象和容量一致", async () => {
      const f = await workspace(),
        tree = await folder(f, "tree"),
        child = await upload(f, "child.bin", tree),
        solo = await upload(f, "solo.bin")
      for (const action of ["trash", "restore", "trash", "purge"]) {
        const values = await Promise.all(
          [child, tree, solo].map((value) => entry(f, value.id))
        )
        const result = await batch(f, input(action, values))
        expect(result.items.map((item) => item.state)).toEqual([
          "covered",
          "completed",
          "completed",
        ])
        expect(result.items[0].operation).toEqual(result.items[1].operation)
        expect(result.items[1].operation.result.affectedEntries).toBe(2)
        const current = await entry(f, child.id)
        expect(current.state).toBe(
          action === "restore"
            ? "active"
            : action === "purge"
              ? "purged"
              : "trashed"
        )
        expect(Number((await usage(f)).used_bytes)).toBe(
          action === "purge" ? 0 : child.body.length + solo.body.length
        )
        expect(Number((await usage(f)).transient_bytes)).toBe(0)
      }
      expect(await bytes(child.location)).toBeNull()
      expect(await bytes(solo.location)).toBeNull()
      expect(
        await environment.physical.directoryExists(
          address(f, "trash", [tree.id])
        )
      ).toBe(false)
      expect(
        await environment.physical.directoryExists(
          address(f, "trash", [solo.id])
        )
      ).toBe(false)
    })

    test("同一批并发明确 POST 复用固定 root UUID，每个根仅发布一次", async () => {
      const f = await workspace(),
        one = await folder(f, "one"),
        two = await folder(f, "two"),
        target = await folder(f, "target")
      const value = input("move", [one, two], { parentId: target.id })
      const responses = await Promise.all(
        Array.from({ length: 4 }, () => batch(f, value))
      )
      expect(
        responses.every((result) =>
          result.items.every((item) => item.state === "completed")
        )
      ).toBe(true)
      expect(
        responses.every(
          (result) => JSON.stringify(result) === JSON.stringify(responses[0])
        )
      ).toBe(true)
      const audits = await environment.observer.query(
        "SELECT operation_id,count(*)::int AS count FROM audit_events WHERE operation_id=ANY($1::text[]) AND event_code='folder.moved' GROUP BY operation_id",
        [value.items.map((item) => item.operationId)]
      )
      expect(audits.rows).toHaveLength(2)
      expect(audits.rows.every((row) => row.count === 1)).toBe(true)
      expect((await entry(f, one.id)).path).toEqual([target.name, one.name])
      expect((await entry(f, two.id)).path).toEqual([target.name, two.name])
    })

    test("持久计划的 GET 纯查询 pending，不执行；明确 POST 才开始固定根", async () => {
      const f = await workspace(),
        tree = await folder(f, "tree"),
        child = await upload(f, "child.bin", tree),
        target = await folder(f, "target")
      const value = input("move", [child, tree], { parentId: target.id })
      await plan(f, value)
      const before = await get(f, value.batchId)
      expect(before.items.map((item) => item.state)).toEqual([
        "covered",
        "pending",
      ])
      expect(before.items.every((item) => item.operation === null)).toBe(true)
      expect(
        await countOperations(value.items.map((item) => item.operationId))
      ).toBe(0)
      expect(await bytes(child.location)).toEqual(child.body)
      expect((await entry(f, tree.id)).parentId).toBe(f.root.id)
      expect((await batch(f, value)).items.map((item) => item.state)).toEqual([
        "covered",
        "completed",
      ])
      expect(
        await countOperations(value.items.map((item) => item.operationId))
      ).toBe(1)
    })

    test("计划后被覆盖后代移出不能重新解释 grouping，原根明确 VERSION_CONFLICT", async () => {
      const f = await workspace(),
        tree = await folder(f, "tree"),
        child = await upload(f, "child.bin", tree),
        target = await folder(f, "target"),
        outside = await folder(f, "outside")
      const value = input("move", [child, tree], { parentId: target.id })
      await plan(f, value)
      await success(f, child, "move", { parentId: outside.id })
      const result = await batch(f, value)
      expect(result.items.map((item) => item.rootIndex)).toEqual([1, 1])
      expect(result.items.map((item) => item.state)).toEqual([
        "covered",
        "failed",
      ])
      expect(result.items[1].error.code).toBe("VERSION_CONFLICT")
      expect((await entry(f, tree.id)).path).toEqual([tree.name])
      expect((await entry(f, child.id)).path).toEqual([
        outside.name,
        child.name,
      ])
      expect(await countOperations([value.items[0].operationId])).toBe(0)
      expect(await get(f, value.batchId)).toEqual(result)
    })

    test("逐根当前动作权限；目录子树不叠加 file 权限，拒绝项经明确 POST 可继续", async () => {
      const f = await workspace(),
        tree = await folder(f, "tree"),
        child = await upload(f, "child.bin", tree),
        solo = await upload(f, "solo.bin"),
        target = await folder(f, "target")
      const writer = await signUpVerified(
          environment.baseURL,
          origin,
          environment.migrator
        ),
        reader = await signUpVerified(
          environment.baseURL,
          origin,
          environment.migrator
        )
      const role = (
        await environment.runtime.auth.api.createOrgRole({
          headers: f.actor.headers,
          body: {
            organizationId: f.organization.id,
            role: "folders-only",
            permission: { folder: ["update"] },
          },
        })
      ).roleData
      for (const [actor, name] of [
        [writer, "folders-only"],
        [reader, "member"],
      ])
        await environment.runtime.auth.api.addMember({
          headers: f.actor.headers,
          body: {
            organizationId: f.organization.id,
            userId: actor.user.id,
            role: name,
          },
        })
      const value = input("move", [tree, solo], { parentId: target.id })
      const first = await batch(f, value, writer)
      expect(first.items.map((item) => item.state)).toEqual([
        "completed",
        "unavailable",
      ])
      expect(first.items[1].error.code).toBe("FORBIDDEN")
      expect(await countOperations([value.items[1].operationId])).toBe(0)
      expect(
        await bytes(address(f, "files", [target.name, tree.name, child.name]))
      ).toEqual(child.body)
      expect((await request(f, "/workspace", {}, writer)).status).toBe(403)
      expect((await execute(f, value, reader)).status).toBe(403)
      const readOnly = await get(f, value.batchId, reader)
      expect(readOnly.items.map((item) => item.state)).toEqual([
        "completed",
        "pending",
      ])
      const alternateActor = await execute(f, value)
      expect(alternateActor.status).toBe(409)
      expect((await alternateActor.json()).code).toBe("IDEMPOTENCY_KEY_REUSED")
      const version = (
        await environment.observer.query(
          "SELECT authorization_version FROM organization_status WHERE organization_id=$1",
          [f.organization.id]
        )
      ).rows[0].authorization_version
      const headers = new Headers(f.actor.headers)
      headers.set("X-Expected-Authz-Version", String(version))
      await environment.runtime.auth.api.updateOrgRole({
        headers,
        body: {
          organizationId: f.organization.id,
          roleId: role.id,
          data: { permission: { folder: ["update"], file: ["update"] } },
        },
      })
      const resumed = await batch(f, value, writer)
      expect(resumed.items.map((item) => item.state)).toEqual([
        "completed",
        "completed",
      ])
      expect(resumed.items[0].operation).toEqual(first.items[0].operation)
      expect(
        await bytes(address(f, "files", [target.name, solo.name]))
      ).toEqual(solo.body)
    })

    test("明确 ≤100 限额和身份唯一性，跨组织 selected/目标逐根拒绝", async () => {
      const f = await workspace(),
        local = await folder(f, "local"),
        foreign = await workspace(),
        outside = await folder(foreign, "outside"),
        target = await folder(f, "target")
      const valid = input("move", [local], { parentId: target.id })
      for (const invalid of [
        {
          ...valid,
          items: Array.from({ length: 101 }, () => ({
            entryId: randomUUID(),
            expectedRevision: 1,
            operationId: randomUUID(),
          })),
        },
        {
          ...valid,
          items: [
            valid.items[0],
            { ...valid.items[0], operationId: randomUUID() },
          ],
        },
        {
          ...valid,
          items: [valid.items[0], { ...valid.items[0], entryId: randomUUID() }],
        },
        {
          ...valid,
          items: [{ ...valid.items[0], expectedRevision: 2_147_483_648 }],
        },
        { ...valid, action: "rename", name: "other" },
      ])
        expect((await execute(f, invalid)).status).toBe(400)
      expect(
        (
          await environment.observer.query(
            "SELECT count(*)::int AS count FROM file_operation_batches WHERE id=$1",
            [valid.batchId]
          )
        ).rows[0].count
      ).toBe(0)
      const scoped = await batch(
        f,
        input("move", [local, outside], { parentId: target.id })
      )
      expect(scoped.items.map((item) => item.state)).toEqual([
        "completed",
        "failed",
      ])
      expect(scoped.items[1].error.code).toBe("NOT_FOUND")
      const wrongTarget = await batch(
        f,
        input("move", [await entry(f, local.id)], { parentId: foreign.root.id })
      )
      expect(wrongTarget.items[0].state).toBe("failed")
      expect(wrongTarget.items[0].error.code).toBe("NOT_FOUND")
      expect(
        (await request(foreign, "/batches/" + scoped.batchId)).status
      ).toBe(404)
      const max = {
        batchId: randomUUID(),
        action: "trash",
        items: Array.from({ length: 100 }, () => ({
          entryId: randomUUID(),
          expectedRevision: 1,
          operationId: randomUUID(),
        })),
      }
      const result = await batch(f, max)
      expect(result.items).toHaveLength(100)
      expect(
        result.items.every(
          (item) => item.state === "failed" && item.error.code === "NOT_FOUND"
        )
      ).toBe(true)
      expect(
        await countOperations(max.items.map((item) => item.operationId))
      ).toBe(0)
    })

    test("根 UUID 已用于另一请求时保留原收据，不把已有完成事实伪造成本批成功", async () => {
      const f = await workspace(),
        one = await folder(f, "one"),
        target = await folder(f, "target"),
        operationId = randomUUID()
      const previous = await success(f, one, "rename", {
        name: "renamed",
        operationId,
      })
      const value = input("move", [previous.entry], { parentId: target.id })
      value.items[0].operationId = operationId
      const result = await batch(f, value)
      expect(result.items[0]).toMatchObject({
        state: "failed",
        operation: null,
        error: { code: "IDEMPOTENCY_KEY_REUSED" },
      })
      expect(await receipt(f, operationId)).toEqual(previous.receipt)
      expect((await entry(f, one.id)).path).toEqual(["renamed"])
      expect(await get(f, value.batchId)).toEqual(result)
    })

    test("首根已提交清理失败不会冒充失败或阻止后根完成；GET 只投影实际阶段", async () => {
      const f = await workspace(),
        one = await upload(f, "one.bin"),
        two = await upload(f, "two.bin"),
        target = await folder(f, "target")
      const value = input("move", [one, two], { parentId: target.id }),
        opId = value.items[0].operationId
      const identifier = "batch_cleanup_" + randomUUID().replaceAll("-", "")
      await environment.observer.query(
        `CREATE FUNCTION public.${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_id='${opId}' AND NEW.source_deleted_at IS NOT NULL THEN RAISE EXCEPTION 'batch source acknowledgement unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${identifier} BEFORE UPDATE ON file_operation_objects FOR EACH ROW EXECUTE FUNCTION public.${identifier}()`
      )
      try {
        const result = await batch(f, value)
        expect(result.items.map((item) => item.state)).toEqual([
          "cleaning",
          "completed",
        ])
        expect(result.items[0].operation.committedAt).not.toBeNull()
        expect(result.items[0].operation.completedAt).toBeNull()
        expect(await get(f, value.batchId)).toEqual(result)
        expect(
          await bytes(address(f, "files", [target.name, one.name]))
        ).toEqual(one.body)
        expect(
          await bytes(address(f, "files", [target.name, two.name]))
        ).toEqual(two.body)
      } finally {
        await environment.observer.query(
          `DROP TRIGGER ${identifier} ON file_operation_objects; DROP FUNCTION public.${identifier}()`
        )
      }
      expect(
        await environment.maintenance("reconcileOrganization", {
          organizationId: f.organization.id,
          kind: "operation",
          id: opId,
        })
      ).toBe(true)
      const completed = await get(f, value.batchId)
      expect(completed.items.map((item) => item.state)).toEqual([
        "completed",
        "completed",
      ])
      expect(await batch(f, value)).toEqual(completed)
      expect(Number((await usage(f)).transient_bytes)).toBe(0)
    })
  })
