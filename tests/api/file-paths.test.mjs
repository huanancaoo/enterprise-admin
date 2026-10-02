import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createHash, randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { createTenantRunner } from "../../packages/database/dist/tenant.js"
import { fileRepository } from "../../packages/database/dist/repositories/files.js"
import { projectRepository } from "../../packages/database/dist/repositories/projects.js"
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
  describe(kind + ": formal file path writes", () => {
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
    test("回收站元数据仅向恢复或清除权限开放，正文仍不可读且清除后身份不可读取", async () => {
      const f = await workspace(),
        source = await folder(f, "回收目录"),
        child = await upload(f, "原内容.txt", source),
        reader = await signUpVerified(
          environment.baseURL,
          origin,
          environment.migrator
        )
      await environment.runtime.auth.api.addMember({
        headers: f.actor.headers,
        body: {
          organizationId: f.organization.id,
          userId: reader.user.id,
          role: "member",
        },
      })
      expect(
        (await request(f, `/entries/${child.id}`, {}, reader)).status
      ).toBe(200)
      const trashed = await success(f, source, "trash")
      const rootMetadata = await request(f, `/entries/${source.id}`)
      expect(rootMetadata.status).toBe(200)
      const current = await rootMetadata.json()
      expect(current).toMatchObject({
        id: source.id,
        state: "trashed",
        revision: trashed.entry.revision,
      })
      const fileMetadata = await request(f, `/entries/${child.id}`)
      expect(fileMetadata.status).toBe(200)
      expect(await fileMetadata.json()).toMatchObject({
        id: child.id,
        state: "trashed",
        currentVersion: { id: child.currentVersionId },
      })
      expect(
        (await request(f, `/entries/${child.id}`, {}, reader)).status
      ).toBe(403)
      expect(
        (await request(f, `/entries/${source.id}`, {}, reader)).status
      ).toBe(403)
      expect(
        (
          await request(
            f,
            `/entries/${child.id}/versions/${child.currentVersionId}/content`
          )
        ).status
      ).toBe(404)
      const restored = await success(f, current, "restore")
      expect(restored.entry.state).toBe("active")
      expect(
        (await request(f, `/entries/${child.id}`, {}, reader)).status
      ).toBe(200)
      const again = await success(f, restored.entry, "trash")
      await success(f, again.entry, "purge")
      expect((await request(f, `/entries/${source.id}`)).status).toBe(404)
      expect((await request(f, `/entries/${child.id}`)).status).toBe(404)
    })

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
    // 文件上传正式入口由另一批交付；此 fixture 只建立真实 Repo + 物理对象，测试路径写的正式 HTTP 链路。
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
    async function overwrite(
      fixture,
      file,
      body = Buffer.from("新版本原字节")
    ) {
      const versionId = randomUUID(),
        leaseId = randomUUID(),
        history = address(fixture, "history", [file.versionId])
      const prepared = await run(fixture, async (tx) => {
        const { operation } = await fileRepository.beginOperation(tx, {
          id: randomUUID(),
          action: "overwrite",
          requestHash: sha(body),
          input: { fileId: file.id },
          expiresAt: new Date(Date.now() + 86400000),
        })
        await fileRepository.claimOperation(
          tx,
          operation.id,
          leaseId,
          new Date()
        )
        await fileRepository.reserveUpload(tx, operation.id, {
          parentId: file.parentId,
          name: file.name,
          declaredBytes: body.length,
          overwriteId: file.id,
          expectedRevision: file.revision,
        })
        const [archive, replacement] = await fileRepository.addObjects(
          tx,
          operation.id,
          [
            {
              entryId: file.id,
              versionId: file.versionId,
              directory: false,
              sourceArea: "files",
              sourcePath: file.path,
              targetArea: "history",
              targetPath: history.segments,
              expectedBytes: file.facts.bytes,
              expectedSha256: file.facts.sha256,
            },
            {
              entryId: file.id,
              versionId,
              directory: false,
              targetArea: "files",
              targetPath: file.path,
              expectedBytes: body.length,
            },
          ]
        )
        return { operation, archive, replacement }
      })
      await environment.physical.copy(file.location, history, file.facts)
      await run(fixture, async (tx) => {
        await fileRepository.recordPreparedObject(
          tx,
          prepared.operation.id,
          prepared.archive.id,
          { ...file.facts, transientBytes: file.facts.bytes },
          leaseId
        )
        await fileRepository.recordSourceDeletionIntent(
          tx,
          prepared.operation.id,
          prepared.archive.id,
          leaseId
        )
      })
      await environment.physical.remove(file.location)
      await run(fixture, (tx) =>
        fileRepository.recordObjectDeleted(
          tx,
          prepared.operation.id,
          prepared.archive.id,
          "source",
          new Date()
        )
      )
      const facts = await environment.physical.write(file.location, body)
      const value = await run(fixture, async (tx) => {
        await fileRepository.recordPreparedObject(
          tx,
          prepared.operation.id,
          prepared.replacement.id,
          { ...facts, transientBytes: 0 },
          leaseId
        )
        const value = await fileRepository.commitUpload(
          tx,
          prepared.operation.id,
          {
            fileId: file.id,
            versionId,
            objectId: prepared.replacement.id,
            parentId: file.parentId,
            name: file.name,
            contentType: "application/octet-stream",
            expectedRevision: file.revision,
          }
        )
        await fileRepository.finishOperation(
          tx,
          prepared.operation.id,
          new Date()
        )
        return value
      })
      return {
        ...value,
        versionId,
        location: file.location,
        facts,
        body,
        history,
      }
    }

    async function fault(operationId, eventCode, work) {
      const identifier = "reject_path_" + randomUUID().replaceAll("-", "")
      await environment.observer.query(
        `CREATE FUNCTION public.${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_id='${operationId}' AND NEW.event_code='${eventCode}' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION public.${identifier}()`
      )
      try {
        return await work()
      } finally {
        await environment.observer.query(
          `DROP TRIGGER ${identifier} ON audit_events; DROP FUNCTION public.${identifier}()`
        )
      }
    }

    test("混合子树重命名、移动、回收、还原与永久删除同步真实层级和容量", async () => {
      const f = await workspace(),
        tree = await folder(f, "合同"),
        nested = await folder(f, "子目录", tree),
        empty = await folder(f, "空目录", nested),
        target = await folder(f, "目标")
      const a = await upload(f, "报告.bin", tree),
        b = await upload(f, "资料.bin", nested)
      let current = (await success(f, tree, "rename", { name: "新合同" })).entry
      expect(
        await environment.physical.directoryExists(
          address(f, "files", ["合同"])
        )
      ).toBe(false)
      expect(
        await bytes(address(f, "files", ["新合同", "子目录", b.name]))
      ).toEqual(b.body)
      current = (await success(f, current, "move", { parentId: target.id }))
        .entry
      expect(
        await environment.physical.directoryExists(
          address(f, "files", ["目标", "新合同", "子目录", "空目录"])
        )
      ).toBe(true)
      current = (await success(f, current, "trash")).entry
      expect(current.state).toBe("trashed")
      expect(await bytes(address(f, "trash", [tree.id, a.versionId]))).toEqual(
        a.body
      )
      expect(
        await environment.physical.directoryExists(
          address(f, "trash", [tree.id, empty.id])
        )
      ).toBe(true)
      expect(Number((await usage(f)).used_bytes)).toBe(
        a.body.length + b.body.length
      )
      current = (await success(f, current, "restore")).entry
      expect(current.path).toEqual(["目标", "新合同"])
      expect(
        await environment.physical.directoryExists(
          address(f, "trash", [tree.id])
        )
      ).toBe(false)
      expect(
        await bytes(address(f, "files", [...current.path, "子目录", b.name]))
      ).toEqual(b.body)
      current = (await success(f, current, "trash")).entry
      const purged = await success(f, current, "purge")
      expect(purged.entry.state).toBe("purged")
      expect(purged.receipt.result.affectedEntries).toBe(5)
      expect(
        await bytes(address(f, "trash", [tree.id, b.versionId]))
      ).toBeNull()
      expect(
        await environment.physical.directoryExists(
          address(f, "trash", [tree.id])
        )
      ).toBe(false)
      expect(Number((await usage(f)).used_bytes)).toBe(0)
      const facts = await environment.observer.query(
        "SELECT count(*)::int AS total FROM audit_events WHERE operation_id=$1 AND event_code='folder.purged'",
        [purged.receipt.id]
      )
      expect(facts.rows[0].total).toBe(1)
    })

    test("单文件内部回收目录按持久计划创建清理，抽出文件不删除仍有兄弟的批次", async () => {
      const f = await workspace(),
        file = await upload(f, "single.bin")
      let current = (await success(f, file, "trash")).entry
      expect(
        await bytes(address(f, "trash", [file.id, file.versionId]))
      ).toEqual(file.body)
      current = (await success(f, current, "restore")).entry
      expect(
        await environment.physical.directoryExists(
          address(f, "trash", [file.id])
        )
      ).toBe(false)
      current = (await success(f, current, "trash")).entry
      await success(f, current, "purge")
      expect(
        await environment.physical.directoryExists(
          address(f, "trash", [file.id])
        )
      ).toBe(false)
      const parent = await folder(f, "batch"),
        first = await upload(f, "first", parent),
        second = await upload(f, "second", parent)
      await success(f, parent, "trash")
      await success(f, await entry(f, first.id), "restore", {
        parentId: f.root.id,
        name: "extracted",
      })
      expect(await bytes(address(f, "files", ["extracted"]))).toEqual(
        first.body
      )
      expect(
        await bytes(address(f, "trash", [parent.id, second.versionId]))
      ).toEqual(second.body)
      expect(
        await environment.physical.directoryExists(
          address(f, "trash", [parent.id])
        )
      ).toBe(true)
    })

    test("空变更、陈旧revision、循环、共享同名、跨组织、root和完整路径约束在I/O前拒绝", async () => {
      const f = await workspace(),
        other = await workspace(),
        parent = await folder(f, "parent"),
        child = await folder(f, "child", parent),
        collision = await upload(f, "collision")
      for (const [value, action, fields, status, code] of [
        [parent, "rename", { name: parent.name }, 400, "VALIDATION_ERROR"],
        [parent, "move", { parentId: f.root.id }, 400, "VALIDATION_ERROR"],
        [
          { ...parent, revision: 99 },
          "rename",
          { name: "changed" },
          409,
          "VERSION_CONFLICT",
        ],
        [parent, "move", { parentId: child.id }, 409, "FILE_FOLDER_CYCLE"],
        [parent, "rename", { name: collision.name }, 409, "FILE_NAME_CONFLICT"],
        [parent, "move", { parentId: other.root.id }, 404, "NOT_FOUND"],
        [f.root, "trash", {}, 409, "FILE_ROOT_PROTECTED"],
        [
          parent,
          "rename",
          { name: "中".repeat(83) },
          400,
          "FILE_NAME_TOO_LONG",
        ],
      ]) {
        const response = await post(f, value, action, fields)
        const body = await response.json()
        expect(response.status, JSON.stringify(body)).toBe(status)
        expect(body.code).toBe(code)
      }
      await folder(f, "c".repeat(20), parent)
      const long = await folder(f, "a".repeat(246)),
        deep = await folder(f, "b".repeat(246), long)
      const overflow = await post(f, parent, "move", { parentId: deep.id })
      expect(overflow.status).toBe(400)
      expect((await overflow.json()).code).toBe("FILE_PATH_TOO_LONG")
      expect(
        await environment.physical.directoryExists(
          address(f, "files", ["parent", "child"])
        )
      ).toBe(true)
      expect((await entry(f, parent.id)).revision).toBe(1)
    })

    test("还原同名冲突支持明确新目标，回收期限已过必须拒绝", async () => {
      const f = await workspace(),
        old = await folder(f, "same")
      const trashed = (await success(f, old, "trash")).entry
      await folder(f, "same")
      const conflict = await post(f, trashed, "restore")
      expect(conflict.status).toBe(409)
      expect((await conflict.json()).code).toBe("FILE_NAME_CONFLICT")
      const restored = (
        await success(f, trashed, "restore", {
          parentId: f.root.id,
          name: "restored",
        })
      ).entry
      const expired = (await success(f, restored, "trash")).entry
      await environment.observer.query(
        "UPDATE file_entries SET expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
        [f.organization.id, expired.id]
      )
      const response = await post(f, expired, "restore")
      expect(response.status).toBe(409)
      expect((await response.json()).code).toBe("FILE_RESTORE_EXPIRED")
      expect((await entry(f, expired.id)).state).toBe("trashed")
    })

    test("影响预检返回精确子树和引用数量，引用阻止整树回收而不泄露引用内容", async () => {
      const f = await workspace(),
        tree = await folder(f, "referenced"),
        empty = await folder(f, "empty", tree),
        file = await upload(f, "file", tree)
      const project = await run(f, (tx) =>
        projectRepository.create(tx, {
          name: "真实引用",
          description: null,
          contentLocale: "zh-CN",
        })
      )
      const business = {
        projectId: project.id,
        kind: "project_attachment",
        locale: null,
      }
      await run(f, (tx) =>
        fileRepository.replaceReferences(tx, business, [
          {
            fileId: file.id,
            versionId: file.versionId,
            referenceKey: randomUUID(),
            position: 0,
          },
        ])
      )
      const impact = await request(f, `/entries/${tree.id}/impact?action=trash`)
      expect(impact.status).toBe(200)
      expect(await impact.json()).toEqual({
        entryId: tree.id,
        revision: tree.revision,
        fileCount: 1,
        folderCount: 2,
        bytes: file.body.length,
        referenceCount: 1,
      })
      expect((await request(f, `/entries/${tree.id}/impact`)).status).toBe(400)
      const rejected = await post(f, tree, "trash")
      expect(rejected.status).toBe(409)
      expect((await rejected.json()).code).toBe("FILE_REFERENCED")
      expect(await bytes(file.location)).toEqual(file.body)
      expect((await entry(f, empty.id)).state).toBe("active")
      await run(f, (tx) => fileRepository.replaceReferences(tx, business, []))
      const trashed = (await success(f, tree, "trash")).entry
      const purge = await request(f, `/entries/${tree.id}/impact?action=purge`)
      expect((await purge.json()).referenceCount).toBe(0)
      await success(f, trashed, "purge")
    })

    test("目录aggregate使用目录权限，restore/purge用对应回收动作且不授正文读取", async () => {
      const f = await workspace(),
        actor = await signUpVerified(
          environment.baseURL,
          origin,
          environment.migrator
        )
      await environment.runtime.auth.api.createOrgRole({
        headers: f.actor.headers,
        body: {
          organizationId: f.organization.id,
          role: "paths-only",
          permission: {
            folder: ["update", "delete"],
            file: ["restore", "purge"],
          },
        },
      })
      await environment.runtime.auth.api.addMember({
        headers: f.actor.headers,
        body: {
          organizationId: f.organization.id,
          userId: actor.user.id,
          role: "paths-only",
        },
      })
      const tree = await folder(f, "protected"),
        file = await upload(f, "content", tree)
      expect(
        (await post(f, file, "rename", { name: "denied" }, actor)).status
      ).toBe(403)
      let current = (
        await success(f, tree, "rename", { name: "allowed" }, actor)
      ).entry
      current = (await success(f, current, "trash", {}, actor)).entry
      current = (await success(f, current, "restore", {}, actor)).entry
      expect(
        (
          await request(
            f,
            `/entries/${file.id}/versions/${file.versionId}/content`,
            {},
            actor
          )
        ).status
      ).toBe(403)
      current = (await success(f, current, "trash", {}, actor)).entry
      await success(f, current, "purge", {}, actor)
      expect((await request(f, "/workspace", {}, actor)).status).toBe(403)
    })

    test("每个动作重试返回原收据，已永久清除条目仍校验原请求身份", async () => {
      const f = await workspace(),
        tree = await folder(f, "retry"),
        destination = await folder(f, "destination")
      let current = tree
      for (const [action, fields] of [
        ["rename", { name: "retry-new" }],
        ["move", { parentId: destination.id }],
        ["trash", {}],
        ["restore", {}],
        ["trash", {}],
        ["purge", {}],
      ]) {
        const operationId = randomUUID(),
          input = { operationId, ...fields }
        const first = await post(f, current, action, input),
          body = await first.json()
        expect(first.status, JSON.stringify(body)).toBe(200)
        const repeated = await post(f, current, action, input)
        expect(repeated.status).toBe(200)
        expect(await repeated.json()).toEqual(body)
        const changed = await post(
          f,
          { ...current, revision: current.revision + 1 },
          action,
          input
        )
        expect(changed.status).toBe(409)
        expect((await changed.json()).code).toBe("IDEMPOTENCY_KEY_REUSED")
        expect(await receipt(f, operationId)).toEqual(body)
        current = await entry(f, tree.id)
      }
    })

    test("重命名审计失败回滚元数据并清理已复制目标，原字节完整保留", async () => {
      const f = await workspace(),
        tree = await folder(f, "source"),
        file = await upload(f, "file", tree),
        operationId = randomUUID()
      await fault(operationId, "folder.renamed", async () => {
        const response = await post(f, tree, "rename", {
          name: "target",
          operationId,
        })
        expect(response.status).toBe(500)
        expect((await response.json()).code).toBe("INTERNAL_ERROR")
        expect(await receipt(f, operationId)).toMatchObject({
          phase: "failed",
          committedAt: null,
          errorCode: "INTERNAL_ERROR",
        })
      })
      expect(await bytes(file.location)).toEqual(file.body)
      expect(
        await environment.physical.directoryExists(
          address(f, "files", ["target"])
        )
      ).toBe(false)
      expect(await entry(f, tree.id)).toMatchObject({
        name: "source",
        revision: 1,
        busyOperationId: null,
      })
      expect(Number((await usage(f)).transient_bytes)).toBe(0)
    })

    test("purge实际删除后审计失败仍保留容量和处理中事实，系统按原意图续跑结算一次", async () => {
      const f = await workspace(),
        file = await upload(f, "purge.bin"),
        trashed = (await success(f, file, "trash")).entry,
        operationId = randomUUID()
      await fault(operationId, "file.purged", async () => {
        const response = await post(f, trashed, "purge", { operationId })
        expect(response.status).toBe(500)
        const operation = await receipt(f, operationId)
        expect(operation.committedAt).toBeNull()
        expect(operation.phase).not.toBe("failed")
        expect((await entry(f, file.id)).busyOperationId).toBe(operationId)
        expect(Number((await usage(f)).used_bytes)).toBe(file.body.length)
        expect(
          await bytes(address(f, "trash", [file.id, file.versionId]))
        ).toBeNull()
      })
      expect(
        await environment.maintenance("reconcileOrganization", {
          organizationId: f.organization.id,
          kind: "operation",
          id: operationId,
        })
      ).toBe(true)
      expect(await receipt(f, operationId)).toMatchObject({
        phase: "completed",
        action: "purge",
        errorCode: null,
      })
      expect((await entry(f, file.id)).state).toBe("purged")
      expect(Number((await usage(f)).used_bytes)).toBe(0)
      expect(
        await environment.maintenance("reconcileOrganization", {
          organizationId: f.organization.id,
          kind: "operation",
          id: operationId,
        })
      ).toBe(false)
      const audits = await environment.observer.query(
        "SELECT actor_type,actor_id,event_code FROM audit_events WHERE operation_id=$1 AND event_code='file.purged'",
        [operationId]
      )
      expect(audits.rows).toHaveLength(1)
      expect(audits.rows[0].actor_type).toBe("system")
    })

    test("重命名保留不可变历史版本和引用，永久删除包含历史真实对象且释放全部版本容量", async () => {
      const f = await workspace(),
        original = await upload(f, "versioned.bin"),
        current = await overwrite(f, original)
      const project = await run(f, (tx) =>
        projectRepository.create(tx, {
          name: "历史引用",
          description: null,
          contentLocale: "zh-CN",
        })
      )
      const business = {
        projectId: project.id,
        kind: "project_attachment",
        locale: null,
      }
      await run(f, (tx) =>
        fileRepository.replaceReferences(tx, business, [
          {
            fileId: current.id,
            versionId: original.versionId,
            referenceKey: "old-attachment",
            position: 0,
          },
        ])
      )
      let value = (await success(f, current, "rename", { name: "renamed.bin" }))
        .entry
      const read = await request(
        f,
        `/entries/${value.id}/versions/${original.versionId}/content`
      )
      expect(read.status).toBe(200)
      expect(Buffer.from(await read.arrayBuffer())).toEqual(original.body)
      const impact = await request(
        f,
        `/entries/${value.id}/impact?action=trash`
      )
      expect(await impact.json()).toMatchObject({
        bytes: original.body.length + current.body.length,
        referenceCount: 1,
      })
      expect((await post(f, value, "trash")).status).toBe(409)
      await run(f, (tx) => fileRepository.replaceReferences(tx, business, []))
      value = (await success(f, value, "trash")).entry
      await success(f, value, "purge")
      expect(await bytes(current.history)).toBeNull()
      expect(
        await bytes(address(f, "trash", [value.id, current.versionId]))
      ).toBeNull()
      expect(Number((await usage(f)).used_bytes)).toBe(0)
      const versions = await environment.observer.query(
        "SELECT purged_at FROM file_versions WHERE organization_id=$1 AND file_id=$2",
        [f.organization.id, value.id]
      )
      expect(versions.rows).toHaveLength(2)
      expect(versions.rows.every((row) => row.purged_at !== null)).toBe(true)
    })

    test("提交后源删除确认落库失败返回已提交收据，维护重跑只清理精确旧源", async () => {
      const f = await workspace(),
        tree = await folder(f, "old"),
        file = await upload(f, "file", tree),
        operationId = randomUUID()
      const identifier = "reject_cleanup_" + randomUUID().replaceAll("-", "")
      await environment.observer.query(
        `CREATE FUNCTION public.${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_id='${operationId}' AND NEW.source_deleted_at IS NOT NULL THEN RAISE EXCEPTION 'source deletion acknowledgement unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${identifier} BEFORE UPDATE ON file_operation_objects FOR EACH ROW EXECUTE FUNCTION public.${identifier}()`
      )
      try {
        const response = await post(f, tree, "rename", {
            operationId,
            name: "new",
          }),
          result = await response.json()
        expect(response.status, JSON.stringify(result)).toBe(200)
        expect(result.committedAt).not.toBeNull()
        expect(await receipt(f, operationId)).toMatchObject({
          phase: "cleaning",
          completedAt: null,
        })
        expect((await entry(f, tree.id)).name).toBe("new")
        expect(await bytes(address(f, "files", ["new", file.name]))).toEqual(
          file.body
        )
        expect(await bytes(file.location)).toBeNull()
      } finally {
        await environment.observer.query(
          `DROP TRIGGER ${identifier} ON file_operation_objects; DROP FUNCTION public.${identifier}()`
        )
      }
      expect(
        await environment.maintenance("reconcileOrganization", {
          organizationId: f.organization.id,
          kind: "operation",
          id: operationId,
        })
      ).toBe(true)
      expect(await receipt(f, operationId)).toMatchObject({
        phase: "completed",
        errorCode: null,
      })
      expect(
        await environment.physical.directoryExists(address(f, "files", ["old"]))
      ).toBe(false)
      expect(await bytes(address(f, "files", ["new", file.name]))).toEqual(
        file.body
      )
      expect(Number((await usage(f)).transient_bytes)).toBe(0)
      expect(Number((await usage(f)).used_bytes)).toBe(file.body.length)
    })
  })
