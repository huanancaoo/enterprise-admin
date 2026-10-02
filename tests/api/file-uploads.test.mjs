import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createHash, randomUUID } from "node:crypto"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startFilesEnvironment } from "../setup/files-environment.mjs"

const origin = "http://localhost:3200"
const sha = (body) => createHash("sha256").update(body).digest("hex")

for (const kind of ["Local", "RustFS"])
  describe(kind + ": formal streaming file uploads", () => {
    const resources = new AsyncDisposableStack()
    let environment
    beforeAll(async () => {
      environment = await startFilesEnvironment(kind, resources)
    })
    afterAll(() => resources.disposeAsync())
    const request = (fixture, suffix, options = {}) =>
      fetch(
        environment.filesBaseURL +
          `/api/v1/organizations/${fixture.organization.id}/files${suffix}`,
        {
          ...options,
          headers: {
            ...Object.fromEntries(fixture.actor.headers),
            ...options.headers,
          },
        }
      )
    async function workspace() {
      const actor = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      const organization =
        await environment.runtime.auth.api.createOrganization({
          headers: actor.headers,
          body: { name: "真实流式上传", slug: randomUUID() },
        })
      const fixture = { actor, organization }
      const response = await request(fixture, "/workspace")
      expect(response.status).toBe(200)
      return { ...fixture, ...(await response.json()) }
    }
    const fields = (fixture, name, body) => ({
      operationId: randomUUID(),
      parentId: fixture.root.id,
      name,
      contentSha256: sha(body),
      declaredBytes: body.byteLength,
    })
    const multipart = (
      input,
      body,
      contentType = "application/octet-stream"
    ) => {
      const form = new FormData()
      for (const [name, value] of Object.entries(input))
        form.append(name, String(value))
      form.append(
        "file",
        new Blob([body], { type: contentType }),
        "original.bin"
      )
      return form
    }
    const upload = (fixture, input, body) =>
      request(fixture, "/uploads", {
        method: "POST",
        body: multipart(input, body),
      })
    async function receipt(fixture, id) {
      const response = await request(fixture, "/operations/" + id)
      expect(response.status).toBe(200)
      return response.json()
    }
    async function assertSettledFailure(fixture, input, code) {
      expect(await receipt(fixture, input.operationId)).toMatchObject({
        phase: "failed",
        committedAt: null,
        errorCode: code,
      })
      const result = await environment.observer.query(
        "SELECT reserved_bytes,transient_bytes,(SELECT count(*)::int FROM file_namespace_reservations WHERE operation_id=$2) AS reservations FROM file_storage_usage WHERE organization_id=$1",
        [fixture.organization.id, input.operationId]
      )
      expect(result.rows[0]).toEqual({
        reserved_bytes: "0",
        transient_bytes: "0",
        reservations: 0,
      })
    }

    test("正式上传保留内容摘要、可下载版本及同级路径，零字节也形成真实版本", async () => {
      const fixture = await workspace()
      for (const [name, body] of [
        ["合同-عقد.txt", Buffer.from("真实文件内容\nمحتوى")],
        ["空文件.txt", Buffer.alloc(0)],
      ]) {
        const input = fields(fixture, name, body)
        const response = await upload(fixture, input, body)
        expect(response.status).toBe(200)
        const result = await response.json()
        expect(result).toMatchObject({
          action: "upload",
          phase: "completed",
          errorCode: null,
          result: { revision: 1 },
        })
        const entry = await request(
          fixture,
          "/entries/" + result.result.entryId
        )
        expect(entry.status).toBe(200)
        expect(await entry.json()).toMatchObject({
          name,
          kind: "file",
          revision: 1,
          currentVersion: { bytes: body.byteLength, sha256: sha(body) },
        })
        const content = await request(
          fixture,
          `/entries/${result.result.entryId}/versions/${result.result.versionId}/content`
        )
        expect(content.status).toBe(200)
        expect(Buffer.from(await content.arrayBuffer())).toEqual(body)
        expect(await receipt(fixture, input.operationId)).toEqual(result)
      }
      const usage = await request(fixture, "/workspace")
      expect((await usage.json()).usage).toMatchObject({
        reservedBytes: 0,
        transientBytes: 0,
      })
    })

    test("实际255字节文件名可上传，256字节在受理前拒绝", async () => {
      const fixture = await workspace()
      const body = Buffer.from("边界")
      const input = fields(fixture, "中".repeat(85), body)
      expect((await upload(fixture, input, body)).status).toBe(200)
      const invalid = {
        ...input,
        operationId: randomUUID(),
        name: input.name + "a",
      }
      expect((await upload(fixture, invalid, body)).status).toBe(400)
      expect(
        (await request(fixture, "/operations/" + invalid.operationId)).status
      ).toBe(404)
    })

    test("同一请求重放核对实际文件，摘要声明相同但内容不同不能返回成功", async () => {
      const fixture = await workspace()
      const body = Buffer.from("original bytes")
      const input = fields(fixture, "原件.bin", body)
      const response = await upload(fixture, input, body)
      expect(response.status).toBe(200)
      const original = await response.json()
      const replay = await upload(fixture, input, body)
      expect(replay.status).toBe(200)
      expect(await replay.json()).toEqual(original)
      const different = await upload(
        fixture,
        input,
        Buffer.from("changed! bytes")
      )
      expect(different.status).toBe(409)
      expect((await different.json()).code).toBe("FILE_CONTENT_MISMATCH")
      const changed = await upload(
        fixture,
        { ...input, name: "不同.bin" },
        body
      )
      expect(changed.status).toBe(409)
      expect((await changed.json()).code).toBe("IDEMPOTENCY_KEY_REUSED")
      expect(await receipt(fixture, input.operationId)).toEqual(original)
      const facts = await environment.observer.query(
        "SELECT count(*)::int AS count FROM audit_events WHERE event_code='file.uploaded' AND operation_id=$1",
        [input.operationId]
      )
      expect(facts.rows[0].count).toBe(1)
    })

    test.each(["摘要", "声明长度"])(
      "%s与实际内容不一致时保留失败收据并移除未发布对象",
      async (mode) => {
        const fixture = await workspace()
        const body = Buffer.from("必须核对")
        const input = fields(fixture, "无效.bin", body)
        if (mode === "摘要") input.contentSha256 = "0".repeat(64)
        else input.declaredBytes++
        const response = await upload(fixture, input, body)
        expect(response.status).toBe(409)
        expect((await response.json()).code).toBe("FILE_CONTENT_MISMATCH")
        await assertSettledFailure(fixture, input, "FILE_CONTENT_MISMATCH")
        const list = await request(fixture, "")
        expect((await list.json()).items).toEqual([])
        expect(
          await environment.physical.read({
            owner: { kind: "organization", id: fixture.organization.id },
            area: "files",
            segments: [input.name],
          })
        ).toEqual({ missing: true })
      }
    )

    test("同级冲突和跨组织目录失败保持原文件及配额", async () => {
      const fixture = await workspace(),
        other = await workspace()
      const body = Buffer.from("original")
      const input = fields(fixture, "同名.bin", body)
      const first = await upload(fixture, input, body)
      const original = await first.json()
      expect(first.status).toBe(200)
      const duplicate = { ...input, operationId: randomUUID() }
      expect((await upload(fixture, duplicate, body)).status).toBe(409)
      await assertSettledFailure(fixture, duplicate, "FILE_NAME_CONFLICT")
      const foreign = {
        ...fields(fixture, "跨组织.bin", body),
        parentId: other.root.id,
      }
      expect((await upload(fixture, foreign, body)).status).toBe(404)
      await assertSettledFailure(fixture, foreign, "NOT_FOUND")
      const content = await request(
        fixture,
        `/entries/${original.result.entryId}/versions/${original.result.versionId}/content`
      )
      expect(Buffer.from(await content.arrayBuffer())).toEqual(body)
    })

    test.each(["后置字段", "第二个文件", "重复字段", "文件先行", "没有文件"])(
      "%s的 multipart 请求不会发布文件",
      async (mode) => {
        const fixture = await workspace()
        const body = Buffer.from("完整性")
        const input = fields(fixture, "不应发布.bin", body)
        let form = multipart(input, body)
        if (mode === "后置字段") form.append("unexpected", "late")
        if (mode === "第二个文件")
          form.append("file", new Blob([body]), "extra.bin")
        if (mode === "重复字段") {
          form = new FormData()
          for (const [name, value] of Object.entries(input))
            form.append(name, String(value))
          form.append("name", "duplicate.bin")
          form.append("file", new Blob([body]), "original.bin")
        }
        if (mode === "文件先行") {
          form = new FormData()
          form.append("file", new Blob([body]), "original.bin")
          for (const [name, value] of Object.entries(input))
            form.append(name, String(value))
        }
        if (mode === "没有文件") form.delete("file")
        const response = await request(fixture, "/uploads", {
          method: "POST",
          body: form,
        })
        expect(response.status).toBe(400)
        expect((await response.json()).code).toBe("VALIDATION_ERROR")
        const list = await request(fixture, "")
        expect((await list.json()).items).toEqual([])
        const usage = await request(fixture, "/workspace")
        expect((await usage.json()).usage).toMatchObject({
          usedBytes: 0,
          reservedBytes: 0,
          transientBytes: 0,
        })
      }
    )
  })
