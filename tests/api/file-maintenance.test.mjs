import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createHash, randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { resolve } from "node:path"
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
const original = Buffer.from("旧版本必须保持实际字节")

for (const kind of ["Local", "RustFS"])
  describe(kind + ": production lifecycle maintenance", () => {
    const resources = new AsyncDisposableStack()
    let environment
    beforeAll(async () => {
      environment = await startFilesEnvironment(kind, resources)
    })
    afterAll(() => resources.disposeAsync())
    const run = (context, callback) =>
      createTenantRunner(environment.runtime.pool)(context, callback, "write")
    const begin = (tx, action, input = {}) =>
      fileRepository.beginOperation(tx, {
        id: randomUUID(),
        action,
        input,
        requestHash: sha(JSON.stringify(input)),
        expiresAt: new Date(Date.now() + 86400000),
      })
    const address = (fixture, area, segments) => ({
      owner: { kind: "organization", id: fixture.organization.id },
      area,
      segments,
    })
    const physicalBytes = async (location) => {
      const read = await environment.physical.read(location)
      return read.missing ? null : Buffer.from(read.base64, "base64")
    }
    const state = async (fixture, operationId) => {
      const [operations, usage, entries] = await Promise.all([
        environment.observer.query(
          "SELECT * FROM file_operations WHERE organization_id=$1 AND id=$2",
          [fixture.organization.id, operationId]
        ),
        environment.observer.query(
          "SELECT * FROM file_storage_usage WHERE organization_id=$1",
          [fixture.organization.id]
        ),
        environment.observer.query(
          "SELECT * FROM file_entries WHERE organization_id=$1 AND name<>''",
          [fixture.organization.id]
        ),
      ])
      return {
        operation: operations.rows[0],
        usage: usage.rows[0],
        entries: entries.rows,
      }
    }
    const cleanup = (fixture, id, kind = "operation") =>
      environment.maintenance("reconcileOrganization", {
        organizationId: fixture.organization.id,
        kind,
        id,
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
          body: { name: "维护验证", slug: randomUUID() },
        })
      const context = await environment.app
        .get(TenantContextService)
        .resolve(
          actor.headers,
          organization.id,
          { file: ["read"], folder: ["read"] },
          randomUUID(),
          new RequestLanguage("zh-CN")
        )
      const { root } = await run(context, (tx) =>
        fileRepository.ensureWorkspace(tx)
      )
      const fixture = { actor, organization, context, root }
      await environment.physical.ensureOwner({
        kind: "organization",
        id: organization.id,
      })
      return fixture
    }
    async function upload(fixture, name = "original.bin", body = original) {
      const fileId = randomUUID(),
        versionId = randomUUID()
      const location = address(fixture, "files", [name])
      const prepared = await run(fixture.context, async (tx) => {
        const { operation } = await begin(tx, "upload", {
          name,
          bytes: body.length,
        })
        await fileRepository.reserveUpload(tx, operation.id, {
          parentId: fixture.root.id,
          name,
          declaredBytes: body.length,
        })
        const [object] = await fileRepository.addObjects(tx, operation.id, [
          {
            entryId: fileId,
            versionId,
            directory: false,
            targetArea: "files",
            targetPath: [name],
            expectedBytes: body.length,
          },
        ])
        return { operation, object }
      })
      const facts = await environment.physical.write(location, body)
      const entry = await run(fixture.context, async (tx) => {
        await fileRepository.recordPreparedObject(
          tx,
          prepared.operation.id,
          prepared.object.id,
          { ...facts, transientBytes: 0 }
        )
        const entry = await fileRepository.commitUpload(
          tx,
          prepared.operation.id,
          {
            fileId,
            versionId,
            objectId: prepared.object.id,
            parentId: fixture.root.id,
            name,
            contentType: "application/octet-stream",
          }
        )
        await fileRepository.finishOperation(
          tx,
          prepared.operation.id,
          new Date()
        )
        return entry
      })
      return { entry, fileId, versionId, location, facts, body }
    }
    async function pathOperation(fixture, file, action, changes = {}) {
      return run(fixture.context, async (tx) => {
        const { operation } = await begin(tx, action, {
          entryId: file.fileId,
          ...changes,
        })
        return {
          operation,
          ...(await fileRepository.preparePathOperation(tx, operation.id, {
            entryId: file.fileId,
            expectedRevision: file.entry.revision,
            now: new Date(),
            ...changes,
          })),
        }
      })
    }
    async function prepareTargets(fixture, prepared) {
      for (const object of [...prepared.objects].sort((a, b) =>
        a.directory !== b.directory
          ? a.directory
            ? -1
            : 1
          : (a.targetPath?.length ?? 0) - (b.targetPath?.length ?? 0)
      )) {
        if (!object.targetArea) continue
        const target = address(fixture, object.targetArea, object.targetPath)
        if (object.directory) await environment.physical.createDirectory(target)
        else
          await environment.physical.copy(
            address(fixture, object.sourceArea, object.sourcePath),
            target,
            { bytes: object.expectedBytes, sha256: object.expectedSha256 }
          )
        await run(fixture.context, (tx) =>
          fileRepository.recordPreparedObject(
            tx,
            prepared.operation.id,
            object.id,
            {
              bytes: object.expectedBytes,
              sha256: object.expectedSha256,
              transientBytes: object.directory ? 0 : object.expectedBytes,
            }
          )
        )
      }
    }
    async function expire(fixture, id) {
      await environment.observer.query(
        "UPDATE file_operations SET expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
        [fixture.organization.id, id]
      )
    }
    async function overwrite(fixture, file, publish) {
      const body = Buffer.from("未发布的新内容比旧内容不同")
      const versionId = randomUUID(),
        history = address(fixture, "history", [file.versionId])
      const prepared = await run(fixture.context, async (tx) => {
        const { operation } = await begin(tx, "overwrite", {
          fileId: file.fileId,
          bytes: body.length,
        })
        await fileRepository.reserveUpload(tx, operation.id, {
          parentId: fixture.root.id,
          name: file.entry.name,
          declaredBytes: body.length,
          overwriteId: file.fileId,
          expectedRevision: file.entry.revision,
        })
        const [archive, replacement] = await fileRepository.addObjects(
          tx,
          operation.id,
          [
            {
              entryId: file.fileId,
              versionId: file.versionId,
              directory: false,
              sourceArea: "files",
              sourcePath: file.entry.path,
              targetArea: "history",
              targetPath: history.segments,
              expectedBytes: file.facts.bytes,
              expectedSha256: file.facts.sha256,
            },
            {
              entryId: file.fileId,
              versionId,
              directory: false,
              targetArea: "files",
              targetPath: file.entry.path,
              expectedBytes: body.length,
            },
          ]
        )
        return { operation, archive, replacement }
      })
      await environment.physical.copy(file.location, history, file.facts)
      await run(fixture.context, (tx) =>
        fileRepository.recordPreparedObject(
          tx,
          prepared.operation.id,
          prepared.archive.id,
          { ...file.facts, transientBytes: file.facts.bytes }
        )
      )
      await environment.physical.remove(file.location)
      await run(fixture.context, (tx) =>
        fileRepository.recordObjectDeleted(
          tx,
          prepared.operation.id,
          prepared.archive.id,
          "source",
          new Date()
        )
      )
      const facts = await environment.physical.write(file.location, body)
      await run(fixture.context, (tx) =>
        fileRepository.recordPreparedObject(
          tx,
          prepared.operation.id,
          prepared.replacement.id,
          { ...facts, transientBytes: 0 }
        )
      )
      if (publish) {
        await run(fixture.context, (tx) =>
          fileRepository.commitUpload(tx, prepared.operation.id, {
            fileId: file.fileId,
            versionId,
            objectId: prepared.replacement.id,
            parentId: fixture.root.id,
            name: file.entry.name,
            contentType: "application/octet-stream",
            expectedRevision: file.entry.revision,
          })
        )
        await cleanup(fixture, prepared.operation.id)
      }
      return { ...prepared, history, body, versionId }
    }

    test("发布后的源实际删除才释放命名与临时容量，重建运行时和重复执行不重复结算", async () => {
      const fixture = await workspace(),
        file = await upload(fixture)
      const prepared = await pathOperation(fixture, file, "rename", {
        name: "renamed.bin",
      })
      await prepareTargets(fixture, prepared)
      await run(fixture.context, (tx) =>
        fileRepository.commitPathOperation(
          tx,
          prepared.operation.id,
          new Date()
        )
      )
      const pending = await state(fixture, prepared.operation.id)
      expect(Number(pending.usage.transient_bytes)).toBe(original.length)
      expect(pending.entries[0].busy_operation_id).toBe(prepared.operation.id)
      expect(await physicalBytes(file.location)).toEqual(original)
      expect(await cleanup(fixture, prepared.operation.id)).toBe(true)
      expect(await physicalBytes(file.location)).toBeNull()
      expect(
        await physicalBytes(address(fixture, "files", ["renamed.bin"]))
      ).toEqual(original)
      const done = await state(fixture, prepared.operation.id)
      expect(done.operation.phase).toBe("completed")
      expect(done.entries[0].busy_operation_id).toBeNull()
      expect(Number(done.usage.transient_bytes)).toBe(0)
      expect(Number(done.usage.used_bytes)).toBe(original.length)
      expect(await cleanup(fixture, prepared.operation.id)).toBe(false)
      const events = await environment.observer.query(
        "SELECT count(*)::int AS count FROM audit_events WHERE operation_id=$1 AND event_code='file.operation_cleaned'",
        [prepared.operation.id]
      )
      expect(events.rows[0].count).toBe(1)
    })

    test("到期未发布上传删除确切对象后释放预留，相邻文件不受影响", async () => {
      const fixture = await workspace(),
        kept = await upload(fixture, "adjacent.bin")
      const target = address(fixture, "files", ["unpublished.bin"])
      const operation = await run(fixture.context, async (tx) => {
        const { operation } = await begin(tx, "upload")
        await fileRepository.reserveUpload(tx, operation.id, {
          parentId: fixture.root.id,
          name: "unpublished.bin",
          declaredBytes: original.length,
        })
        await fileRepository.addObjects(tx, operation.id, [
          {
            entryId: randomUUID(),
            versionId: randomUUID(),
            directory: false,
            targetArea: "files",
            targetPath: target.segments,
            expectedBytes: original.length,
          },
        ])
        return operation
      })
      await environment.physical.write(target, original)
      await expire(fixture, operation.id)
      expect(await cleanup(fixture, operation.id)).toBe(true)
      expect(await physicalBytes(target)).toBeNull()
      expect(await physicalBytes(kept.location)).toEqual(original)
      const done = await state(fixture, operation.id)
      expect(done.operation.phase).toBe("failed")
      expect(done.operation.committed_at).toBeNull()
      expect(Number(done.usage.reserved_bytes)).toBe(0)
      expect(done.entries).toHaveLength(1)
    })

    test("未发布覆盖先删除新目标再恢复旧字节，后续目标清理不能误删旧版本", async () => {
      const fixture = await workspace(),
        file = await upload(fixture)
      const prepared = await overwrite(fixture, file, false)
      expect(await physicalBytes(file.location)).toEqual(prepared.body)
      await expire(fixture, prepared.operation.id)
      expect(await cleanup(fixture, prepared.operation.id)).toBe(true)
      expect(await physicalBytes(file.location)).toEqual(original)
      expect(await physicalBytes(prepared.history)).toBeNull()
      const done = await state(fixture, prepared.operation.id)
      expect(done.operation.phase).toBe("failed")
      expect(done.entries[0].current_version_id).toBe(file.versionId)
      expect(done.entries[0].busy_operation_id).toBeNull()
      expect(Number(done.usage.used_bytes)).toBe(original.length)
      expect(Number(done.usage.reserved_bytes)).toBe(0)
      expect(Number(done.usage.transient_bytes)).toBe(0)
    })

    test("到期历史只清理旧版本并释放其容量，当前版本与界面路径保持", async () => {
      const fixture = await workspace(),
        file = await upload(fixture)
      const prepared = await overwrite(fixture, file, true)
      const observer = await environment.observer.connect()
      try {
        await observer.query("BEGIN")
        // 保留期限在生产中不可修改；只在测试事务内提前日期，结束前恢复同一个约束。
        await observer.query(
          "ALTER TABLE file_versions DISABLE TRIGGER file_versions_immutable"
        )
        await observer.query(
          "UPDATE file_versions SET expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
          [fixture.organization.id, file.versionId]
        )
        await observer.query(
          "ALTER TABLE file_versions ENABLE TRIGGER file_versions_immutable"
        )
        await observer.query("COMMIT")
      } catch (error) {
        await observer.query("ROLLBACK")
        throw error
      } finally {
        observer.release()
      }
      expect(await cleanup(fixture, file.versionId, "history")).toBe(true)
      expect(await physicalBytes(prepared.history)).toBeNull()
      expect(await physicalBytes(file.location)).toEqual(prepared.body)
      const versions = await environment.observer.query(
        "SELECT id,purged_at FROM file_versions WHERE organization_id=$1 AND file_id=$2 ORDER BY created_at",
        [fixture.organization.id, file.fileId]
      )
      expect(
        versions.rows.find((version) => version.id === file.versionId).purged_at
      ).not.toBeNull()
      expect(
        versions.rows.find((version) => version.id === prepared.versionId)
          .purged_at
      ).toBeNull()
      const usage = await environment.observer.query(
        "SELECT used_bytes,transient_bytes FROM file_storage_usage WHERE organization_id=$1",
        [fixture.organization.id]
      )
      expect(Number(usage.rows[0].used_bytes)).toBe(prepared.body.length)
      expect(Number(usage.rows[0].transient_bytes)).toBe(0)
    })

    test("已停用组织的单file回收批次删除真实文件及内部目录后由系统结算", async () => {
      const fixture = await workspace(),
        file = await upload(fixture)
      const prepared = await pathOperation(fixture, file, "trash")
      await prepareTargets(fixture, prepared)
      await run(fixture.context, (tx) =>
        fileRepository.commitPathOperation(
          tx,
          prepared.operation.id,
          new Date()
        )
      )
      expect(await cleanup(fixture, prepared.operation.id)).toBe(true)
      const trashRoot = address(fixture, "trash", [file.fileId])
      expect(await environment.physical.directoryExists(trashRoot)).toBe(true)
      await environment.observer.query(
        "UPDATE file_entries SET expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
        [fixture.organization.id, file.fileId]
      )
      await environment.observer.query(
        "UPDATE organization_status SET status='SUSPENDED' WHERE organization_id=$1",
        [fixture.organization.id]
      )
      expect(await cleanup(fixture, file.fileId, "trash")).toBe(true)
      expect(await environment.physical.directoryExists(trashRoot)).toBe(false)
      expect(
        await physicalBytes(
          address(fixture, "trash", [file.fileId, file.versionId])
        )
      ).toBeNull()
      const usage = await environment.observer.query(
        "SELECT used_bytes FROM file_storage_usage WHERE organization_id=$1",
        [fixture.organization.id]
      )
      expect(Number(usage.rows[0].used_bytes)).toBe(0)
      const event = await environment.observer.query(
        "SELECT actor_type,actor_id,tenant_visible FROM audit_events WHERE organization_id=$1 AND event_code='file.purged'",
        [fixture.organization.id]
      )
      expect(event.rows).toEqual([
        { actor_type: "system", actor_id: null, tenant_visible: true },
      ])
    })

    test("物理删除后审计失败保留busy并记录错误，重跑不二次扣容量", async () => {
      const fixture = await workspace(),
        file = await upload(fixture)
      const prepared = await pathOperation(fixture, file, "rename", {
        name: "target.bin",
      })
      await prepareTargets(fixture, prepared)
      await run(fixture.context, (tx) =>
        fileRepository.commitPathOperation(
          tx,
          prepared.operation.id,
          new Date()
        )
      )
      const identifier = "maintenance_audit_" + randomUUID().replaceAll("-", "")
      await environment.observer.query(
        `CREATE FUNCTION public.${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_id='${prepared.operation.id}' AND NEW.event_code='file.operation_cleaned' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END; $$; CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION public.${identifier}()`
      )
      try {
        expect(await cleanup(fixture, prepared.operation.id)).toBe(false)
        const pending = await state(fixture, prepared.operation.id)
        expect(pending.operation.error_code).toBe("AUDIT_UNAVAILABLE")
        expect(pending.entries[0].busy_operation_id).toBe(prepared.operation.id)
        expect(await physicalBytes(file.location)).toBeNull()
      } finally {
        await environment.observer.query(
          `DROP TRIGGER ${identifier} ON audit_events; DROP FUNCTION public.${identifier}()`
        )
      }
      expect(await cleanup(fixture, prepared.operation.id)).toBe(true)
      const done = await state(fixture, prepared.operation.id)
      expect(done.operation.phase).toBe("completed")
      expect(Number(done.usage.used_bytes)).toBe(original.length)
      expect(Number(done.usage.transient_bytes)).toBe(0)
    })

    test("最终Session失效的未发布个人上传无需伪造身份，立即清理固定mediaId", async () => {
      const fixture = await workspace(),
        userId = fixture.actor.user.id
      const session = (
        await environment.runtime.auth.api.getSession({
          headers: fixture.actor.headers,
        })
      ).session.id
      const operationId = randomUUID(),
        leaseId = randomUUID()
      const begun = await environment.runtime.pool.query(
        "SELECT public.begin_personal_media_upload($1,$2,$3,$4,$5,$6) AS result",
        [
          userId,
          session,
          operationId,
          sha(original),
          original.length,
          randomUUID(),
        ]
      )
      const mediaId = begun.rows[0].result.operation.media_id
      await environment.runtime.pool.query(
        "SELECT public.claim_personal_media_upload($1,$2,$3,$4)",
        [userId, session, operationId, leaseId]
      )
      const target = {
        owner: { kind: "personal", id: userId },
        area: "files",
        segments: [mediaId],
      }
      await environment.physical.ensureOwner(target.owner)
      await environment.physical.write(target, original)
      await environment.observer.query(
        "UPDATE session SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [session]
      )
      await environment.runtime.pool.query(
        "SELECT public.handoff_personal_media_upload_failure($1,$2,$3,$4)",
        [userId, operationId, leaseId, "UNAUTHENTICATED"]
      )
      expect(
        await environment.maintenance("reconcilePersonal", {
          userId,
          kind: "upload",
          id: operationId,
        })
      ).toBe(true)
      expect(await physicalBytes(target)).toBeNull()
      const done = await environment.observer.query(
        "SELECT phase,error_code,cleaned_at FROM personal_media_operations WHERE user_id=$1 AND id=$2",
        [userId, operationId]
      )
      expect(done.rows[0].phase).toBe("failed")
      expect(done.rows[0].error_code).toBe("UNAUTHENTICATED")
      expect(done.rows[0].cleaned_at).not.toBeNull()
      expect(
        await environment.maintenance("reconcilePersonal", {
          userId,
          kind: "upload",
          id: operationId,
        })
      ).toBe(false)
    })
  })
