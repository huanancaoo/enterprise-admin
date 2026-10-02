import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createHash, randomUUID } from "node:crypto"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const {
  createOpenApiDocument,
} = require("../../apps/api/dist/openapi/create-document.js")
import { startFilesEnvironment } from "../setup/files-environment.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import {
  ProjectAttachmentsResponseSchema,
  ProjectContentResponseSchema,
  ProjectResponseSchema,
  ApiErrorSchema,
} from "../../packages/contracts/src/index.ts"
import { createTenantRunner } from "../../packages/database/dist/tenant.js"
import { fileRepository } from "../../packages/database/dist/repositories/files.js"

const origin = "http://localhost:3200"
const bytes = Buffer.from([0, 255, 128, 10, 13])
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwnwGM/zMwAAAf7gP9qS/A4gAAAABJRU5ErkJggg==",
  "base64"
)
const sha = (body) => createHash("sha256").update(body).digest("hex")
const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] }
const fileDoc = (reference, text = "正文") => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text }] },
    { type: "fileImage", attrs: { ...reference, alt: "图片" } },
    { type: "fileAttachment", attrs: { ...reference, label: "文件" } },
  ],
})
const ref = (result) => ({
  fileId: result.entryId,
  versionId: result.versionId,
})

for (const kind of ["Local", "RustFS"])
  describe(`${kind}: Projects HTTP references and content transactions`, () => {
    const resources = new AsyncDisposableStack()
    let environment
    beforeAll(async () => {
      try {
        environment = await startFilesEnvironment(kind, resources)
      } catch (error) {
        await resources.disposeAsync()
        throw error
      }
    })
    afterAll(() => resources.disposeAsync())
    const request = (fixture, path, options = {}, actor = fixture.actor) =>
      fetch(
        environment.filesBaseURL +
          `/api/v1/organizations/${fixture.organization.id}${path}`,
        {
          ...options,
          headers: { ...Object.fromEntries(actor.headers), ...options.headers },
        }
      )
    const json = (method, input) => ({
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    async function error(response, status, code) {
      expect(response.status).toBe(status)
      expect(ApiErrorSchema.parse(await response.json()).code).toBe(code)
    }
    async function fixture() {
      const actor = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      const organization =
        await environment.runtime.auth.api.createOrganization({
          headers: actor.headers,
          body: { name: "项目文件事务", slug: randomUUID() },
        })
      const fixture = { actor, organization }
      const response = await request(fixture, "/files/workspace")
      expect(response.status).toBe(200)
      return { ...fixture, root: (await response.json()).root }
    }
    async function upload(
      fixture,
      name = "原始内容.bin",
      body = bytes,
      contentType = "application/octet-stream",
      overwrite
    ) {
      const form = new FormData()
      for (const [key, value] of Object.entries({
        operationId: randomUUID(),
        ...(overwrite
          ? { expectedRevision: overwrite.revision }
          : { parentId: fixture.root.id, name }),
        contentSha256: sha(body),
        declaredBytes: body.length,
      }))
        form.append(key, String(value))
      form.append("file", new File([body], name, { type: contentType }))
      const response = await request(
        fixture,
        overwrite
          ? `/files/entries/${overwrite.id}/overwrite`
          : "/files/uploads",
        { method: "POST", body: form }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      const receipt = await response.json()
      expect(receipt.phase).toBe("completed")
      return receipt.result
    }
    async function project(fixture, attachments) {
      const response = await request(
        fixture,
        "/projects",
        json("POST", {
          name: "项目概要",
          description: "<b>仍然只是纯文本概要</b>",
          contentLocale: "zh-CN",
          ...(attachments ? { attachments } : {}),
        })
      )
      expect(response.status, await response.clone().text()).toBe(201)
      return ProjectResponseSchema.parse(await response.json())
    }
    const patch = (fixture, projectId, input, actor) =>
      request(fixture, `/projects/${projectId}`, json("PATCH", input), actor)
    async function attachments(fixture, projectId, actor) {
      const response = await request(
        fixture,
        `/projects/${projectId}/attachments`,
        {},
        actor
      )
      expect(response.status).toBe(200)
      return ProjectAttachmentsResponseSchema.parse(await response.json())
    }
    const save = (
      fixture,
      projectId,
      locale,
      expectedRevision,
      document,
      actor
    ) =>
      request(
        fixture,
        `/projects/${projectId}/content/${locale}`,
        json("PUT", { expectedRevision, document }),
        actor
      )
    async function content(fixture, projectId, locale, actor) {
      const response = await request(
        fixture,
        `/projects/${projectId}/content/${locale}`,
        {},
        actor
      )
      expect(response.status).toBe(200)
      return ProjectContentResponseSchema.parse(await response.json())
    }
    const download = (fixture, reference, actor) =>
      request(
        fixture,
        `/files/entries/${reference.fileId}/versions/${reference.versionId}/content`,
        {},
        actor
      )
    async function role(fixture, permission) {
      const actor = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      const roleName = "project-" + randomUUID()
      const created = await environment.runtime.auth.api.createOrgRole({
        headers: fixture.actor.headers,
        body: {
          organizationId: fixture.organization.id,
          role: roleName,
          permission,
        },
      })
      await environment.runtime.auth.api.addMember({
        headers: fixture.actor.headers,
        body: {
          organizationId: fixture.organization.id,
          userId: actor.user.id,
          role: roleName,
        },
      })
      return { actor, id: created.roleData.id }
    }
    async function changeRole(fixture, role, permission) {
      const state = await environment.observer.query(
        "SELECT authorization_version FROM organization_status WHERE organization_id=$1",
        [fixture.organization.id]
      )
      const response = await fetch(
        environment.filesBaseURL + "/api/auth/organization/update-role",
        {
          ...json("POST", {
            organizationId: fixture.organization.id,
            roleId: role.id,
            data: { permission },
          }),
          headers: {
            ...Object.fromEntries(fixture.actor.headers),
            "content-type": "application/json",
            "X-Expected-Authz-Version": String(
              state.rows[0].authorization_version
            ),
          },
        }
      )
      expect(response.status, await response.clone().text()).toBe(200)
    }
    async function usageLock(fixture) {
      const membership = await environment.observer.query(
        "SELECT id FROM member WHERE organization_id=$1 AND user_id=$2",
        [fixture.organization.id, fixture.actor.user.id]
      )
      const context = {
        organizationId: fixture.organization.id,
        userId: fixture.actor.user.id,
        membershipId: membership.rows[0].id,
        requestId: randomUUID(),
        locale: "zh-CN",
      }
      const client = await environment.runtime.pool.connect()
      let release, entered
      const gate = new Promise((resolve) => {
          release = resolve
        }),
        ready = new Promise((resolve) => {
          entered = resolve
        })
      const work = createTenantRunner(client)(context, async (tx) => {
        await fileRepository.lockOrganization(tx)
        entered()
        await gate
      })
      await ready
      const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid
      return {
        pid,
        async release() {
          release()
          try {
            await work
          } finally {
            client.release()
          }
        },
      }
    }
    async function waitForBlocked(lock, minimum = 1) {
      // PostgreSQL 的等待队列可让后来的请求被前一个等待者间接阻塞，必须跟随真实锁链。
      await expect
        .poll(async () => {
          const result = await environment.observer.query(
            `WITH RECURSIVE blocked(pid) AS (
                SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
                UNION
                SELECT activity.pid FROM pg_stat_activity AS activity
                JOIN blocked ON blocked.pid=ANY(pg_blocking_pids(activity.pid))
              ) SELECT count(*)::int AS n FROM blocked`,
            [lock.pid]
          )
          return result.rows[0].n
        })
        .toBeGreaterThanOrEqual(minimum)
    }

    if (kind === "Local")
      test("正式生产控制器导出的OpenAPI包含全部协议及可解析递归引用", () => {
        const document = createOpenApiDocument(environment.app)
        const base =
          "/api/v1/organizations/{organizationId}/projects/{projectId}"
        expect(document.paths[base + "/attachments"].get.operationId).toBe(
          "getProjectAttachments"
        )
        expect(document.paths[base + "/content/{locale}"].get.operationId).toBe(
          "getProjectContent"
        )
        expect(document.paths[base + "/content/{locale}"].put.operationId).toBe(
          "saveProjectContent"
        )
        const visit = (value) => {
          if (Array.isArray(value)) {
            value.forEach(visit)
            return
          }
          if (!value || typeof value !== "object") return
          if (typeof value.$ref === "string") {
            expect(value.$ref.startsWith("#/"), value.$ref).toBe(true)
            let target = document
            for (const part of value.$ref.slice(2).split("/"))
              target =
                target?.[part.replaceAll("~1", "/").replaceAll("~0", "~")]
            expect(target, value.$ref).toBeDefined()
          }
          Object.values(value).forEach(visit)
        }
        visit(document)
      })

    test("创建同事务附件且保持概要，project:read只返回引用，不产生文件读取资格", async () => {
      const f = await fixture(),
        version = await upload(f),
        reference = ref(version),
        p = await project(f, [reference])
      expect(p.description).toBe("<b>仍然只是纯文本概要</b>")
      const reader = await role(f, { project: ["read"] })
      expect(await attachments(f, p.id, reader.actor)).toMatchObject({
        revision: 1,
        items: [reference],
      })
      await error(await download(f, reference, reader.actor), 403, "FORBIDDEN")
      const original = await download(f, reference)
      expect(original.status).toBe(200)
      expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes)
      const rows = await environment.observer.query(
        "SELECT kind,locale,position,file_id,version_id FROM file_references WHERE project_id=$1",
        [p.id]
      )
      expect(rows.rows).toEqual([
        {
          kind: "project_attachment",
          locale: null,
          position: 0,
          file_id: reference.fileId,
          version_id: reference.versionId,
        },
      ])
    })

    test("项目读权独立获得绑定元数据：改名投影当前名称，覆盖仍投影原固定版本", async () => {
      const f = await fixture(),
        first = await upload(f, "原文件名.bin"),
        p = await project(f, [ref(first)]),
        reader = await role(f, { project: ["read"] })
      const facts = await environment.observer.query(
        "SELECT created_at FROM file_versions WHERE id=$1",
        [first.versionId]
      )
      const original = {
        ...ref(first),
        name: "原文件名.bin",
        bytes: bytes.length,
        contentType: "application/octet-stream",
        versionCreatedAt: facts.rows[0].created_at.toISOString(),
      }
      expect(await attachments(f, p.id, reader.actor)).toEqual({
        revision: 1,
        items: [original],
      })
      await error(
        await request(f, `/files/entries/${first.entryId}`, {}, reader.actor),
        403,
        "FORBIDDEN"
      )
      await error(await download(f, ref(first), reader.actor), 403, "FORBIDDEN")
      await upload(f, "新版本.txt", Buffer.from("不同新版本"), "text/plain", {
        id: first.entryId,
        revision: 1,
      })
      const renamed = await request(
        f,
        `/files/entries/${first.entryId}/rename`,
        json("POST", {
          operationId: randomUUID(),
          expectedRevision: 2,
          name: "当前条目名.txt",
        })
      )
      expect(renamed.status, await renamed.clone().text()).toBe(200)
      expect((await renamed.json()).phase).toBe("completed")
      expect(await attachments(f, p.id, reader.actor)).toEqual({
        revision: 1,
        items: [{ ...original, name: "当前条目名.txt" }],
      })
      const other = await fixture()
      await error(
        await request(other, `/projects/${p.id}/attachments`),
        404,
        "NOT_FOUND"
      )
    })

    test("无效或越组织引用阻止项目保存，已上传文件不会被业务失败删除", async () => {
      const f = await fixture(),
        other = await fixture(),
        uploaded = ref(await upload(f)),
        foreign = ref(await upload(other))
      for (const reference of [
        foreign,
        { ...uploaded, versionId: randomUUID() },
        { fileId: f.root.id, versionId: uploaded.versionId },
      ]) {
        await error(
          await request(
            f,
            "/projects",
            json("POST", {
              name: "应回滚",
              description: null,
              attachments: [reference],
            })
          ),
          404,
          "NOT_FOUND"
        )
      }
      const projects = await environment.observer.query(
        "SELECT count(*)::int AS n FROM projects WHERE organization_id=$1",
        [f.organization.id]
      )
      expect(projects.rows[0].n).toBe(0)
      const references = await environment.observer.query(
        "SELECT count(*)::int AS n FROM file_references WHERE organization_id=$1",
        [f.organization.id]
      )
      expect(references.rows[0].n).toBe(0)
      expect((await download(f, uploaded)).status).toBe(200)
    })

    test("附件独立CAS、译文与状态原子保存，并发概要编辑不回写旧附件或语言", async () => {
      const f = await fixture(),
        first = ref(await upload(f, "第一份.bin")),
        second = ref(await upload(f, "第二份.bin")),
        p = await project(f, [first])
      const updated = await patch(f, p.id, {
        status: "active",
        translation: {
          locale: "en-US",
          name: "Original English",
          description: "English summary",
        },
        attachments: { expectedRevision: 1, items: [second] },
      })
      expect(updated.status).toBe(200)
      expect(await attachments(f, p.id)).toMatchObject({
        revision: 2,
        items: [second],
      })
      await error(
        await patch(f, p.id, {
          translation: { locale: "en-US", name: "不得提交" },
          attachments: { expectedRevision: 1, items: [first] },
        }),
        409,
        "VERSION_CONFLICT"
      )
      const responses = await Promise.all([
        patch(f, p.id, {
          attachments: { expectedRevision: 2, items: [first] },
        }),
        patch(f, p.id, {
          translation: { locale: "en-US", description: "Concurrent summary" },
        }),
      ])
      expect(responses.map((r) => r.status)).toEqual([200, 200])
      expect(await attachments(f, p.id)).toMatchObject({
        revision: 3,
        items: [first],
      })
      const translation = await request(
        f,
        `/projects/${p.id}/translations/en-US`
      )
      expect(await translation.json()).toMatchObject({
        name: "Original English",
        description: "Concurrent summary",
      })
      const metadata = await request(f, `/projects/${p.id}`)
      expect(await metadata.json()).toMatchObject({
        status: "active",
        name: "项目概要",
        description: "<b>仍然只是纯文本概要</b>",
      })
    })

    test("按三种内容语言独立保存原生结构化文档，服务端派生全部索引且概要不变", async () => {
      const f = await fixture(),
        reference = ref(await upload(f, "图片.png", png, "image/png")),
        p = await project(f)
      expect(await content(f, p.id, "ar")).toEqual({
        locale: "ar",
        document: null,
        revision: null,
        updatedAt: null,
      })
      for (const locale of ["zh-CN", "en-US", "ar"]) {
        const document = fileDoc(reference, "正文-" + locale)
        const response = await save(f, p.id, locale, null, document)
        expect(response.status, await response.clone().text()).toBe(200)
        expect(await content(f, p.id, locale)).toMatchObject({
          locale,
          document,
          revision: 1,
        })
        const rows = await environment.observer.query(
          "SELECT reference_key,position,file_id,version_id FROM file_references WHERE project_id=$1 AND kind='project_rich_text' AND locale=$2 ORDER BY position",
          [p.id, locale]
        )
        expect(rows.rows).toEqual([
          {
            reference_key: "1",
            position: 0,
            file_id: reference.fileId,
            version_id: reference.versionId,
          },
          {
            reference_key: "2",
            position: 1,
            file_id: reference.fileId,
            version_id: reference.versionId,
          },
        ])
      }
      const reader = await role(f, { project: ["read"] })
      expect((await content(f, p.id, "en-US", reader.actor)).document).toEqual(
        fileDoc(reference, "正文-en-US")
      )
      await error(await download(f, reference, reader.actor), 403, "FORBIDDEN")
      const metadata = await request(f, `/projects/${p.id}`)
      expect((await metadata.json()).description).toBe(
        "<b>仍然只是纯文本概要</b>"
      )
    })

    test("内容translate不能改附件，撤销file:read后拒绝新引用但允许显式清空旧引用", async () => {
      const f = await fixture(),
        reference = ref(await upload(f, "译文图片.png", png, "image/png")),
        p = await project(f, [reference])
      const translator = await role(f, {
        project: ["read", "translate"],
        file: ["read"],
      })
      expect(
        (
          await save(
            f,
            p.id,
            "en-US",
            null,
            fileDoc(reference),
            translator.actor
          )
        ).status
      ).toBe(200)
      await error(
        await patch(
          f,
          p.id,
          { attachments: { expectedRevision: 1, items: [] } },
          translator.actor
        ),
        403,
        "FORBIDDEN"
      )
      await changeRole(f, translator, { project: ["read", "translate"] })
      await error(
        await save(f, p.id, "en-US", 1, fileDoc(reference), translator.actor),
        403,
        "FORBIDDEN"
      )
      expect(
        (await save(f, p.id, "en-US", 1, emptyDoc, translator.actor)).status
      ).toBe(200)
      expect((await content(f, p.id, "en-US")).document).toEqual(emptyDoc)
      const editor = await role(f, { project: ["read", "update"] })
      expect(
        (
          await patch(
            f,
            p.id,
            { attachments: { expectedRevision: 1, items: [] } },
            editor.actor
          )
        ).status
      ).toBe(200)
      expect(await attachments(f, p.id)).toMatchObject({
        revision: 2,
        items: [],
      })
      expect((await download(f, reference)).status).toBe(200)
    })

    test("覆盖不改已有引用，显式替换版本才改变；被引用版本阻塞删除，解除不删除文件", async () => {
      const f = await fixture(),
        first = await upload(f),
        p = await project(f, [ref(first)])
      const replacement = Buffer.from("显式新版本")
      const second = await upload(f, "替换.bin", replacement, "text/plain", {
        id: first.entryId,
        revision: 1,
      })
      expect((await attachments(f, p.id)).items).toMatchObject([ref(first)])
      const old = await download(f, ref(first))
      expect(Buffer.from(await old.arrayBuffer())).toEqual(bytes)
      const newer = await download(f, ref(second))
      expect(Buffer.from(await newer.arrayBuffer())).toEqual(replacement)
      await error(
        await request(
          f,
          `/files/entries/${first.entryId}/trash`,
          json("POST", { operationId: randomUUID(), expectedRevision: 2 })
        ),
        409,
        "FILE_REFERENCED"
      )
      expect(
        (
          await patch(f, p.id, {
            attachments: { expectedRevision: 1, items: [ref(second)] },
          })
        ).status
      ).toBe(200)
      expect((await attachments(f, p.id)).items).toMatchObject([ref(second)])
      expect(
        (
          await patch(f, p.id, {
            attachments: { expectedRevision: 2, items: [] },
          })
        ).status
      ).toBe(200)
      expect((await download(f, ref(first))).status).toBe(200)
      expect((await download(f, ref(second))).status).toBe(200)
    })

    test("实际附件绑定与删除竞争只能提交一方，引用及可读内容始终一致", async () => {
      const f = await fixture(),
        uploaded = await upload(f, "竞争.bin"),
        reference = ref(uploaded),
        p = await project(f)
      const lock = await usageLock(f)
      const binding = patch(f, p.id, {
        attachments: { expectedRevision: 1, items: [reference] },
      })
      const trashing = request(
        f,
        `/files/entries/${uploaded.entryId}/trash`,
        json("POST", { operationId: randomUUID(), expectedRevision: 1 })
      )
      try {
        await waitForBlocked(lock, 2)
      } finally {
        await lock.release()
      }
      const [bound, trashed] = await Promise.all([binding, trashing])
      if (bound.status === 200) {
        await error(trashed, 409, "FILE_REFERENCED")
        expect(await attachments(f, p.id)).toMatchObject({
          revision: 2,
          items: [reference],
        })
        const body = await download(f, reference)
        expect(body.status).toBe(200)
        expect(Buffer.from(await body.arrayBuffer())).toEqual(bytes)
      } else {
        expect([404, 409]).toContain(bound.status)
        expect(trashed.status, await trashed.clone().text()).toBe(200)
        expect((await trashed.json()).phase).toBe("completed")
        expect(await attachments(f, p.id)).toMatchObject({
          revision: 1,
          items: [],
        })
        await error(await download(f, reference), 404, "NOT_FOUND")
      }
      const indexed = await environment.observer.query(
        "SELECT count(*)::int AS n FROM file_references WHERE file_id=$1",
        [uploaded.entryId]
      )
      expect(indexed.rows[0].n).toBe(bound.status === 200 ? 1 : 0)
    })

    test("拒绝任意URL节点、伪造索引、跨组织内容和不适合图片的版本，revision冲突保留内容", async () => {
      const f = await fixture(),
        other = await fixture(),
        reference = ref(await upload(f)),
        foreign = ref(await upload(other, "他组织.png", png, "image/png")),
        p = await project(f)
      await error(
        await save(f, p.id, "zh-CN", null, fileDoc(reference)),
        400,
        "VALIDATION_ERROR"
      )
      await error(
        await save(f, p.id, "zh-CN", null, fileDoc(foreign)),
        404,
        "NOT_FOUND"
      )
      for (const document of [
        {
          type: "doc",
          content: [
            { type: "image", attrs: { src: "data:image/png;base64,a" } },
          ],
        },
        { ...emptyDoc, references: [] },
      ])
        await error(
          await save(f, p.id, "zh-CN", null, document),
          400,
          "VALIDATION_ERROR"
        )
      expect((await save(f, p.id, "zh-CN", null, emptyDoc)).status).toBe(200)
      await error(
        await save(f, p.id, "zh-CN", null, emptyDoc),
        409,
        "VERSION_CONFLICT"
      )
      expect((await content(f, p.id, "zh-CN")).revision).toBe(1)
      await error(
        await request(other, `/projects/${p.id}/content/zh-CN`),
        404,
        "NOT_FOUND"
      )
      await error(
        await request(
          f,
          `/projects/${p.id}/content/zh-CN`,
          {},
          { headers: new Headers() }
        ),
        401,
        "UNAUTHENTICATED"
      )
    })

    test("实际审计拒绝回滚文档、全部引用与项目更新时间", async () => {
      const f = await fixture(),
        reference = ref(await upload(f, "审核图片.png", png, "image/png")),
        p = await project(f)
      const before = await environment.observer.query(
        "SELECT updated_at FROM projects WHERE id=$1",
        [p.id]
      )
      await environment.migrator.query(
        "ALTER TABLE audit_events ADD CONSTRAINT project_content_test_audit_denial CHECK (event_code <> 'project.content.updated') NOT VALID"
      )
      try {
        await error(
          await save(f, p.id, "zh-CN", null, fileDoc(reference)),
          500,
          "INTERNAL_ERROR"
        )
      } finally {
        await environment.migrator.query(
          "ALTER TABLE audit_events DROP CONSTRAINT project_content_test_audit_denial"
        )
      }
      expect((await content(f, p.id, "zh-CN")).document).toBeNull()
      const facts = await environment.observer.query(
        "SELECT updated_at,(SELECT count(*)::int FROM file_references WHERE project_id=$1) AS refs FROM projects WHERE id=$1",
        [p.id]
      )
      expect(facts.rows[0]).toEqual({
        updated_at: before.rows[0].updated_at,
        refs: 0,
      })
      expect((await download(f, reference)).status).toBe(200)
    })

    test("等待usage锁时实时撤权与Session到期，释放锁后不得发布旧授权业务", async () => {
      const f = await fixture(),
        reference = ref(await upload(f, "等待图片.png", png, "image/png")),
        p = await project(f)
      const editor = await role(f, {
        project: ["read", "update"],
        file: ["read"],
      })
      const lock = await usageLock(f)
      const pending = save(
        f,
        p.id,
        "zh-CN",
        null,
        fileDoc(reference),
        editor.actor
      )
      try {
        await waitForBlocked(lock)
        await changeRole(f, editor, { project: ["read"] })
      } finally {
        await lock.release()
      }
      await error(await pending, 403, "FORBIDDEN")
      expect((await content(f, p.id, "zh-CN")).document).toBeNull()
      const expiryLock = await usageLock(f)
      const expiring = save(f, p.id, "zh-CN", null, fileDoc(reference))
      try {
        await waitForBlocked(expiryLock)
        await environment.runtime.pool.query(
          "UPDATE session SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
          [f.actor.user.id]
        )
      } finally {
        await expiryLock.release()
      }
      await error(await expiring, 401, "UNAUTHENTICATED")
      const facts = await environment.observer.query(
        "SELECT count(*)::int AS n FROM project_file_contents WHERE project_id=$1",
        [p.id]
      )
      expect(facts.rows[0].n).toBe(0)
    })
  })
