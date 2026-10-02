import { createHash, randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startFilesProcessEnvironment } from "../setup/files-process-environment.mjs"

const origin = "http://localhost:3200"
const sha = (value) => createHash("sha256").update(value).digest("hex")

for (const kind of ["Local", "RustFS"])
  describe(kind + ": retention survives actual API SIGKILL", () => {
    const resources = new AsyncDisposableStack()
    let environment
    beforeAll(async () => {
      try {
        environment = await startFilesProcessEnvironment(kind, resources)
      } catch (error) {
        await resources.disposeAsync()
        throw error
      }
    })
    afterAll(() => resources.disposeAsync())
    const request = (fixture, path, options = {}) =>
      fetch(
        environment.filesBaseURL +
          `/api/v1/organizations/${fixture.organization.id}${path}`,
        {
          ...options,
          signal: AbortSignal.timeout(30_000),
          headers: {
            ...Object.fromEntries(fixture.actor.headers),
            ...options.headers,
          },
        }
      )
    const json = (body) => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
          body: { name: "保留任务真实进程恢复", slug: randomUUID() },
        })
      const fixture = { actor, organization }
      const response = await request(fixture, "/files/workspace")
      expect(response.status).toBe(200)
      return { ...fixture, root: (await response.json()).root }
    }
    async function upload(fixture, name, body, previous) {
      const form = new FormData()
      for (const [key, value] of Object.entries({
        operationId: randomUUID(),
        ...(previous
          ? { expectedRevision: previous.revision }
          : { parentId: fixture.root.id, name }),
        contentSha256: sha(body),
        declaredBytes: body.length,
      }))
        form.append(key, String(value))
      form.append("file", new Blob([body], { type: "text/plain" }), name)
      const response = await request(
        fixture,
        previous
          ? `/files/entries/${previous.entryId}/overwrite`
          : "/files/uploads",
        { method: "POST", body: form }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      const receipt = await response.json()
      expect(receipt.phase).toBe("completed")
      return receipt.result
    }
    async function project(fixture, file) {
      const response = await request(
        fixture,
        "/projects",
        json({
          name: "固定旧版本引用",
          description: null,
          contentLocale: "zh-CN",
          attachments: [{ fileId: file.entryId, versionId: file.versionId }],
        })
      )
      expect(response.status, await response.clone().text()).toBe(201)
      return response.json()
    }
    async function content(fixture, file, expected) {
      const response = await request(
        fixture,
        `/files/entries/${file.entryId}/versions/${file.versionId}/content`
      )
      expect(response.status).toBe(200)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(expected)
    }
    async function version(fixture, id) {
      return (
        await environment.observer.query(
          "SELECT * FROM file_versions WHERE organization_id=$1 AND id=$2",
          [fixture.organization.id, id]
        )
      ).rows[0]
    }
    const address = (fixture, value) => ({
      owner: { kind: "organization", id: fixture.organization.id },
      area: value.storage_area,
      segments: value.storage_path,
    })
    async function state(fixture, operationId) {
      const queries = await Promise.all([
        environment.observer.query(
          "SELECT * FROM file_operations WHERE organization_id=$1 AND id=$2",
          [fixture.organization.id, operationId]
        ),
        environment.observer.query(
          "SELECT * FROM file_operation_objects WHERE organization_id=$1 AND operation_id=$2 ORDER BY id",
          [fixture.organization.id, operationId]
        ),
        environment.observer.query(
          "SELECT id,kind,state,current_version_id,busy_operation_id,revision FROM file_entries WHERE organization_id=$1 ORDER BY id",
          [fixture.organization.id]
        ),
        environment.observer.query(
          "SELECT id,file_id,purged_at,storage_area,storage_path FROM file_versions WHERE organization_id=$1 ORDER BY id",
          [fixture.organization.id]
        ),
        environment.observer.query(
          "SELECT used_bytes,reserved_bytes,transient_bytes FROM file_storage_usage WHERE organization_id=$1",
          [fixture.organization.id]
        ),
        environment.observer.query(
          "SELECT event_code,actor_type,actor_id,tenant_visible FROM audit_events WHERE organization_id=$1 AND operation_id=$2 ORDER BY id",
          [fixture.organization.id, operationId]
        ),
        environment.observer.query(
          "SELECT id,input,maintenance_kind FROM file_operations WHERE organization_id=$1 AND maintenance_kind IS NOT NULL ORDER BY id",
          [fixture.organization.id]
        ),
        environment.observer.query(
          "SELECT file_id,version_id FROM file_references WHERE organization_id=$1 ORDER BY file_id,version_id",
          [fixture.organization.id]
        ),
      ])
      return {
        operation: queries[0].rows[0],
        objects: queries[1].rows,
        entries: queries[2].rows,
        versions: queries[3].rows,
        usage: queries[4].rows[0],
        audit: queries[5].rows,
        maintenance: queries[6].rows,
        references: queries[7].rows,
      }
    }
    const plan = (snapshot) => ({
      id: snapshot.operation.id,
      input: snapshot.operation.input,
      plans: snapshot.operation.plans,
      maintenanceKind: snapshot.operation.maintenance_kind,
      objects: snapshot.objects.map(
        ({
          id,
          entry_id,
          version_id,
          directory,
          source_area,
          source_path,
          expected_bytes,
          expected_sha256,
        }) => ({
          id,
          entry_id,
          version_id,
          directory,
          source_area,
          source_path,
          expected_bytes,
          expected_sha256,
        })
      ),
    })
    async function expireHistory(fixture, ids) {
      const observer = await environment.observer.connect()
      try {
        await observer.query("BEGIN")
        // 只加速保留期限；同一测试事务恢复不可变约束，不修改候选、计划或结算事实。
        await observer.query(
          "ALTER TABLE file_versions DISABLE TRIGGER file_versions_immutable"
        )
        await observer.query(
          "UPDATE file_versions SET expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=ANY($2::uuid[])",
          [fixture.organization.id, ids]
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
    }
    async function interruptedTask(
      fixture,
      target,
      maintenanceKind,
      usedBytes
    ) {
      // gate 由生产 remove 完成后悬置返回；SIGKILL 不能进入异常 handoff 或正常 shutdown。
      const hit = await environment.lostDeleteHit()
      if (kind === "Local")
        expect(hit).toMatchObject({
          stage: "after",
          method: "remove",
          address: target,
          pid: environment.pid(),
        })
      else expect(hit.status).toBe(204)
      expect(await environment.physical(target)).toBeNull()
      const candidate = await environment.observer.query(
        "SELECT id FROM file_operations WHERE organization_id=$1 AND maintenance_kind=$2 AND completed_at IS NULL",
        [fixture.organization.id, maintenanceKind]
      )
      expect(candidate.rows).toHaveLength(1)
      const operationId = candidate.rows[0].id
      const pending = await state(fixture, operationId)
      expect(pending.operation).toMatchObject({
        actor_type: "system",
        actor_id: null,
        phase: "preparing",
        committed_at: null,
        completed_at: null,
        error_code: null,
      })
      expect(
        pending.objects.find(
          (object) =>
            object.source_area === target.area &&
            JSON.stringify(object.source_path) ===
              JSON.stringify(target.segments)
        ).source_deleted_at
      ).toBeNull()
      expect(
        pending.entries.some((entry) => entry.busy_operation_id === operationId)
      ).toBe(true)
      expect(Number(pending.usage.used_bytes)).toBe(usedBytes)
      expect(pending.audit).toEqual([])
      expect(
        await environment.ownerLockAvailable(fixture.organization.id)
      ).toBe(false)
      const oldPid = environment.pid()
      expect(await environment.kill()).toEqual({ pid: oldPid, exitCode: 137 })
      await expect
        .poll(() => environment.ownerLockAvailable(fixture.organization.id), {
          timeout: 10_000,
        })
        .toBe(true)
      // 已确认进程死亡和锁释放后仅提前旧租约；新启动扫描必须认领同一个持久化任务。
      await environment.observer.query(
        "UPDATE file_operations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
        [fixture.organization.id, operationId]
      )
      expect(await environment.restart()).not.toBe(oldPid)
      await expect
        .poll(async () => (await state(fixture, operationId)).operation.phase, {
          timeout: 30_000,
        })
        .toBe("completed")
      const completed = await state(fixture, operationId)
      expect(plan(completed)).toEqual(plan(pending))
      expect(completed.operation.committed_at).not.toBeNull()
      expect(completed.operation.completed_at).not.toBeNull()
      expect(completed.operation.error_code).toBeNull()
      expect(
        completed.objects.every((object) => object.source_deleted_at !== null)
      ).toBe(true)
      expect(
        completed.entries.every((entry) => entry.busy_operation_id === null)
      ).toBe(true)
      expect(Number(completed.usage.reserved_bytes)).toBe(0)
      expect(Number(completed.usage.transient_bytes)).toBe(0)
      expect(completed.maintenance).toHaveLength(1)
      await environment.restart()
      expect(await state(fixture, operationId)).toEqual(completed)
      return completed
    }

    test("到期历史实际删除后SIGKILL，启动接管同一计划仅结算一次且保留项目引用的旧版本", async () => {
      const fixture = await workspace()
      const oldBody = Buffer.from("未引用的到期旧版本\n")
      const currentBody = Buffer.from("当前版本必须保持\n")
      const referencedBody = Buffer.from("项目固定旧版本 مرحبا\n")
      const referencedCurrentBody = Buffer.from("库内覆盖后的另一个版本\n")
      const old = await upload(fixture, "未引用.txt", oldBody)
      const current = await upload(fixture, "未引用.txt", currentBody, old)
      const referenced = await upload(fixture, "有引用.txt", referencedBody)
      const referencedCurrent = await upload(
        fixture,
        "有引用.txt",
        referencedCurrentBody,
        referenced
      )
      const linkedProject = await project(fixture, referenced)
      const target = address(fixture, await version(fixture, old.versionId))
      const protectedTarget = address(
        fixture,
        await version(fixture, referenced.versionId)
      )
      expect(target.area).toBe("history")
      expect(await environment.physical(target)).toEqual(oldBody)
      await environment.loseDelete(target)
      await expireHistory(fixture, [old.versionId, referenced.versionId])
      const used =
        oldBody.length +
        currentBody.length +
        referencedBody.length +
        referencedCurrentBody.length
      const completed = await interruptedTask(
        fixture,
        target,
        "history_purge",
        used
      )
      expect(Number(completed.usage.used_bytes)).toBe(used - oldBody.length)
      expect(completed.audit).toEqual([
        {
          event_code: "file.history_purged",
          actor_type: "system",
          actor_id: null,
          tenant_visible: true,
        },
      ])
      expect(
        completed.versions.find((value) => value.id === old.versionId).purged_at
      ).not.toBeNull()
      expect(
        completed.versions
          .filter((value) => value.id !== old.versionId)
          .every((value) => value.purged_at === null)
      ).toBe(true)
      expect(
        completed.entries.find((value) => value.id === old.entryId)
      ).toMatchObject({
        state: "active",
        current_version_id: current.versionId,
        revision: current.revision,
      })
      expect(completed.references).toEqual([
        { file_id: referenced.entryId, version_id: referenced.versionId },
      ])
      expect(await environment.physical(target)).toBeNull()
      expect(await environment.physical(protectedTarget)).toEqual(
        referencedBody
      )
      await content(fixture, current, currentBody)
      await content(fixture, referenced, referencedBody)
      await content(fixture, referencedCurrent, referencedCurrentBody)
      const attachments = await request(
        fixture,
        `/projects/${linkedProject.id}/attachments`
      )
      expect(attachments.status).toBe(200)
      expect((await attachments.json()).items).toMatchObject([
        { fileId: referenced.entryId, versionId: referenced.versionId },
      ])
    }, 120_000)

    test("回收期限到期实际删除后SIGKILL，原批次启动清理全部版本及目录并保护引用文件", async () => {
      const fixture = await workspace()
      const oldBody = Buffer.from("回收文件的历史版本\n")
      const currentBody = Buffer.from("回收文件的当前版本\n")
      const protectedBody = Buffer.from("仍被项目引用的文件\n")
      const old = await upload(fixture, "将回收.txt", oldBody)
      const current = await upload(fixture, "将回收.txt", currentBody, old)
      const protectedFile = await upload(fixture, "引用保护.txt", protectedBody)
      await project(fixture, protectedFile)
      const rejected = await request(
        fixture,
        `/files/entries/${protectedFile.entryId}/trash`,
        json({
          operationId: randomUUID(),
          expectedRevision: protectedFile.revision,
        })
      )
      expect(rejected.status).toBe(409)
      expect((await rejected.json()).code).toBe("FILE_REFERENCED")
      const trashed = await request(
        fixture,
        `/files/entries/${current.entryId}/trash`,
        json({ operationId: randomUUID(), expectedRevision: current.revision })
      )
      expect(trashed.status, await trashed.clone().text()).toBe(200)
      expect((await trashed.json()).phase).toBe("completed")
      const target = address(fixture, await version(fixture, current.versionId))
      const history = address(fixture, await version(fixture, old.versionId))
      const trashDirectory = { ...target, segments: [current.entryId] }
      expect(target.area).toBe("trash")
      expect(await environment.physical(target)).toEqual(currentBody)
      expect(await environment.physical(history)).toEqual(oldBody)
      expect(await environment.physical(trashDirectory, true)).toBe(true)
      await environment.loseDelete(target)
      await environment.observer.query(
        "UPDATE file_entries SET expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
        [fixture.organization.id, current.entryId]
      )
      const completed = await interruptedTask(
        fixture,
        target,
        "trash_purge",
        oldBody.length + currentBody.length + protectedBody.length
      )
      expect(Number(completed.usage.used_bytes)).toBe(protectedBody.length)
      expect(completed.audit).toEqual([
        {
          event_code: "file.purged",
          actor_type: "system",
          actor_id: null,
          tenant_visible: true,
        },
      ])
      expect(
        completed.entries.find((value) => value.id === current.entryId).state
      ).toBe("purged")
      expect(
        completed.versions.filter((value) => value.file_id === current.entryId)
      ).toHaveLength(2)
      expect(
        completed.versions
          .filter((value) => value.file_id === current.entryId)
          .every((value) => value.purged_at !== null)
      ).toBe(true)
      expect(completed.references).toEqual([
        { file_id: protectedFile.entryId, version_id: protectedFile.versionId },
      ])
      expect(await environment.physical(target)).toBeNull()
      expect(await environment.physical(history)).toBeNull()
      expect(await environment.physical(trashDirectory, true)).toBe(false)
      await content(fixture, protectedFile, protectedBody)
      expect(
        (await request(fixture, `/files/entries/${current.entryId}`)).status
      ).toBe(404)
    }, 120_000)
  })
