import { createHash, randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startFilesProcessEnvironment } from "../setup/files-process-environment.mjs"

const origin = "http://localhost:3200"
const sha = (value) => createHash("sha256").update(value).digest("hex")

for (const kind of ["Local", "RustFS"])
  describe(kind + ": actual API process death and persisted recovery", () => {
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
    const request = (fixture, suffix, options = {}) =>
      fetch(
        environment.filesBaseURL +
          `/api/v1/organizations/${fixture.organization.id}/files${suffix}`,
        {
          ...options,
          signal: AbortSignal.timeout(30_000),
          headers: {
            ...Object.fromEntries(fixture.actor.headers),
            ...options.headers,
          },
        }
      )
    const multipart = (fields, body) => {
      const form = new FormData()
      for (const [name, value] of Object.entries(fields))
        form.append(name, String(value))
      form.append("file", new Blob([body], { type: "text/plain" }), "原件.txt")
      return form
    }
    const at = (fixture, area, segments) => ({
      owner: { kind: "organization", id: fixture.organization.id },
      area,
      segments,
    })
    async function folder(fixture, name, parentId) {
      const response = await request(fixture, "/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationId: randomUUID(), parentId, name }),
      })
      expect(response.status).toBe(200)
      return (await response.json()).result.entryId
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
          body: { name: "真实进程恢复", slug: randomUUID() },
        })
      const fixture = { actor, organization }
      const response = await request(fixture, "/workspace")
      expect(response.status).toBe(200)
      const { root } = await response.json()
      const directoryId = await folder(fixture, "原目录", root.id)
      const childId = await folder(fixture, "子目录", directoryId)
      await folder(fixture, "空目录", directoryId)
      const destinationId = await folder(fixture, "目标目录", root.id)
      const original = Buffer.from("真实旧版本必须逐字节保持 مرحبا\n")
      const uploaded = await request(fixture, "/uploads", {
        method: "POST",
        body: multipart(
          {
            operationId: randomUUID(),
            parentId: childId,
            name: "原件.txt",
            contentSha256: sha(original),
            declaredBytes: original.length,
          },
          original
        ),
      })
      expect(uploaded.status).toBe(200)
      const file = (await uploaded.json()).result
      const current = await request(fixture, "/entries/" + directoryId)
      expect(current.status).toBe(200)
      return {
        ...fixture,
        root,
        directory: await current.json(),
        destinationId,
        original,
        file,
      }
    }
    async function state(fixture, operationId) {
      const values = await Promise.all([
        environment.observer.query(
          "SELECT * FROM public.file_operations WHERE organization_id=$1 AND id=$2",
          [fixture.organization.id, operationId]
        ),
        environment.observer.query(
          "SELECT * FROM public.file_operation_objects WHERE organization_id=$1 AND operation_id=$2 ORDER BY id",
          [fixture.organization.id, operationId]
        ),
        environment.observer.query(
          "SELECT id,path,parent_id,name,revision,current_version_id,busy_operation_id,state,kind FROM public.file_entries WHERE organization_id=$1 ORDER BY id",
          [fixture.organization.id]
        ),
        environment.observer.query(
          "SELECT used_bytes,reserved_bytes,transient_bytes FROM public.file_storage_usage WHERE organization_id=$1",
          [fixture.organization.id]
        ),
        environment.observer.query(
          "SELECT count(*)::integer AS count FROM public.file_namespace_reservations WHERE organization_id=$1 AND operation_id=$2",
          [fixture.organization.id, operationId]
        ),
        environment.observer.query(
          "SELECT event_code,count(*)::integer AS count FROM public.audit_events WHERE organization_id=$1 AND operation_id=$2 GROUP BY event_code ORDER BY event_code",
          [fixture.organization.id, operationId]
        ),
      ])
      return {
        operation: values[0].rows[0],
        objects: values[1].rows,
        entries: values[2].rows,
        usage: values[3].rows[0],
        reservations: values[4].rows[0].count,
        audit: values[5].rows,
      }
    }
    async function content(fixture) {
      const response = await request(
        fixture,
        `/entries/${fixture.file.entryId}/versions/${fixture.file.versionId}/content`
      )
      expect(response.status).toBe(200)
      return Buffer.from(await response.arrayBuffer())
    }
    async function kill(fixture, pending) {
      expect(
        await environment.ownerLockAvailable(fixture.organization.id)
      ).toBe(false)
      const oldPid = environment.pid()
      const death = await environment.kill()
      expect(death).toEqual({ pid: oldPid, exitCode: 137 })
      expect(await pending).toMatchObject({ interrupted: true })
      await expect
        .poll(() => environment.ownerLockAvailable(fixture.organization.id), {
          timeout: 10_000,
        })
        .toBe(true)
      return oldPid
    }
    async function recover(fixture, operationId, oldPid, phase) {
      // 真实 SIGKILL 和锁释放已经独立断言；这里只加速已死操作的 24h 到期与 2min 租约。
      // 不修改 phase/plan/error/usage，由生产候选扫描决定 abort 或 finish_commit。
      await environment.observer.query(
        "UPDATE public.file_operations SET expires_at=clock_timestamp()-interval '1 second',lease_expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
        [fixture.organization.id, operationId]
      )
      const pid = await environment.restart()
      expect(pid).not.toBe(oldPid)
      await expect
        .poll(async () => (await state(fixture, operationId)).operation.phase, {
          timeout: 30_000,
        })
        .toBe(phase)
      return state(fixture, operationId)
    }
    async function stableRestart(fixture, operationId, completed) {
      await environment.restart()
      const receipt = await request(fixture, "/operations/" + operationId)
      expect(receipt.status).toBe(200)
      const after = await state(fixture, operationId)
      expect(after).toEqual(completed)
      expect(await content(fixture)).toEqual(fixture.original)
    }
    const interrupted = (promise) =>
      promise.then(
        (response) => ({ status: response.status, interrupted: false }),
        () => ({ interrupted: true })
      )

    for (const action of ["rename", "move"])
      for (const published of [false, true])
        test(`${action}目录${published ? "已发布而旧源未清理" : "实际复制未发布"}时SIGKILL，重启正式维护按持久事实收敛`, async () => {
          const fixture = await workspace()
          const operationId = randomUUID()
          const before = await state(fixture, operationId)
          const targetRoot =
            action === "rename" ? ["改名目录"] : ["目标目录", "原目录"]
          const oldFile = at(fixture, "files", ["原目录", "子目录", "原件.txt"])
          const newFile = at(fixture, "files", [
            ...targetRoot,
            "子目录",
            "原件.txt",
          ])
          await environment.gate(
            published ? "before" : "after",
            published ? "remove" : "copy",
            published ? oldFile : newFile
          )
          const pending = interrupted(
            request(fixture, `/entries/${fixture.directory.id}/${action}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                operationId,
                expectedRevision: fixture.directory.revision,
                ...(action === "rename"
                  ? { name: "改名目录" }
                  : { parentId: fixture.destinationId }),
              }),
            })
          )
          const hit = await environment.gateHit()
          expect(hit.pid).toBe(environment.pid())
          const paused = await state(fixture, operationId)
          expect(paused.operation.phase).toBe(
            published ? "committed" : "preparing"
          )
          expect(paused.operation.error_code).toBeNull()
          expect(paused.operation.committed_at === null).toBe(!published)
          expect(paused.operation.plans).toHaveLength(4)
          const object = paused.objects.find(
            (value) => value.entry_id === fixture.file.entryId
          )
          expect(object.source_deleted_at).toBeNull()
          expect(object.prepared_at !== null).toBe(published)
          expect(await environment.physical(oldFile)).toEqual(fixture.original)
          expect(await environment.physical(newFile)).toEqual(fixture.original)
          expect(
            await environment.physical(
              at(fixture, "files", [...targetRoot, "空目录"]),
              true
            )
          ).toBe(true)
          const oldPid = await kill(fixture, pending)
          const dead = await state(fixture, operationId)
          expect(dead).toEqual(paused)
          const completed = await recover(
            fixture,
            operationId,
            oldPid,
            published ? "completed" : "failed"
          )
          expect(completed.usage).toEqual({
            used_bytes: String(fixture.original.length),
            reserved_bytes: "0",
            transient_bytes: "0",
          })
          expect(completed.reservations).toBe(0)
          expect(
            completed.entries.every((entry) => entry.busy_operation_id === null)
          ).toBe(true)
          expect(await content(fixture)).toEqual(fixture.original)
          if (published) {
            expect(completed.operation.committed_at).toEqual(
              paused.operation.committed_at
            )
            expect(completed.entries).toEqual(
              paused.entries.map((entry) => ({
                ...entry,
                busy_operation_id: null,
              }))
            )
            expect(
              completed.objects.every(
                (object) => object.source_deleted_at !== null
              )
            ).toBe(true)
            expect(
              await environment.physical(at(fixture, "files", ["原目录"]), true)
            ).toBe(false)
            expect(await environment.physical(oldFile)).toBeNull()
            expect(await environment.physical(newFile)).toEqual(
              fixture.original
            )
            expect(completed.audit).toContainEqual({
              event_code: `folder.${action === "rename" ? "renamed" : "moved"}`,
              count: 1,
            })
          } else {
            expect(completed.operation.error_code).toBe(
              "FILE_OPERATION_EXPIRED"
            )
            expect(completed.operation.committed_at).toBeNull()
            expect(completed.entries).toEqual(before.entries)
            expect(
              completed.objects.every(
                (object) => object.target_deleted_at !== null
              )
            ).toBe(true)
            expect(
              await environment.physical(at(fixture, "files", targetRoot), true)
            ).toBe(false)
            expect(await environment.physical(newFile)).toBeNull()
            expect(await environment.physical(oldFile)).toEqual(
              fixture.original
            )
            expect(
              completed.audit.some(
                (entry) =>
                  entry.event_code ===
                  `folder.${action === "rename" ? "renamed" : "moved"}`
              )
            ).toBe(false)
          }
          await stableRestart(fixture, operationId, completed)
        })

    test("覆盖旧源真实删除但返回与数据库确认不可见时SIGKILL，重启恢复固定旧版本并正确结算", async () => {
      const fixture = await workspace()
      const operationId = randomUUID()
      const oldFile = at(fixture, "files", ["原目录", "子目录", "原件.txt"])
      const history = at(fixture, "history", [fixture.file.versionId])
      const before = await state(fixture, operationId)
      const replacement = Buffer.from("真实新内容尚未发布")
      await environment.loseDelete(oldFile)
      const pending = interrupted(
        request(fixture, `/entries/${fixture.file.entryId}/overwrite`, {
          method: "POST",
          body: multipart(
            {
              operationId,
              expectedRevision: fixture.file.revision,
              contentSha256: sha(replacement),
              declaredBytes: replacement.length,
            },
            replacement
          ),
        })
      )
      const hit = await environment.lostDeleteHit()
      if (kind === "RustFS") expect(hit.status).toBe(204)
      else
        expect(hit).toMatchObject({
          stage: "after",
          method: "remove",
          pid: environment.pid(),
        })
      const paused = await state(fixture, operationId)
      expect(paused.operation).toMatchObject({
        phase: "preparing",
        error_code: null,
        committed_at: null,
      })
      const archive = paused.objects.find(
        (object) => object.target_area === "history"
      )
      expect(archive.prepared_at).not.toBeNull()
      expect(archive.source_deletion_started_at).not.toBeNull()
      expect(archive.source_deleted_at).toBeNull()
      expect(archive.source_restored_at).toBeNull()
      expect(await environment.physical(oldFile)).toBeNull()
      expect(await environment.physical(history)).toEqual(fixture.original)
      const staging = paused.objects.find(
        (object) => object.target_area === "staging"
      )
      expect(
        await environment.physical(at(fixture, "staging", staging.target_path))
      ).toEqual(replacement)
      const oldPid = await kill(fixture, pending)
      expect(await state(fixture, operationId)).toEqual(paused)
      const completed = await recover(fixture, operationId, oldPid, "failed")
      expect(completed.operation).toMatchObject({
        committed_at: null,
        error_code: "FILE_OPERATION_EXPIRED",
      })
      expect(completed.entries).toEqual(before.entries)
      expect(
        completed.objects.every((object) => object.target_deleted_at !== null)
      ).toBe(true)
      const restored = completed.objects.find(
        (object) => object.target_area === "history"
      )
      expect(restored.source_restored_at).not.toBeNull()
      expect(restored.source_deleted_at).toBeNull()
      expect(completed.usage).toEqual({
        used_bytes: String(fixture.original.length),
        reserved_bytes: "0",
        transient_bytes: "0",
      })
      expect(completed.reservations).toBe(0)
      expect(await content(fixture)).toEqual(fixture.original)
      expect(await environment.physical(oldFile)).toEqual(fixture.original)
      expect(await environment.physical(history)).toBeNull()
      expect(
        await environment.physical(at(fixture, "staging", staging.target_path))
      ).toBeNull()
      expect(
        completed.audit.some((event) => event.event_code === "file.overwritten")
      ).toBe(false)
      await stableRestart(fixture, operationId, completed)
    })
  })
