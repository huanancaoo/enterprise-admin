import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { startFilesEnvironment } from "../setup/files-environment.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { createHash, randomUUID } from "node:crypto"

describe.each(["Local", "RustFS"])("平台自有文件 HTTP - %s", (kind) => {
  const resources = new AsyncDisposableStack()
  const origin = "http://localhost:3200"
  let environment

  beforeAll(async () => {
    environment = await startFilesEnvironment(kind, resources)
  })
  afterAll(() => resources.disposeAsync())

  test("平台工作区具有独立默认策略，普通账号不能取得平台文件库", async () => {
    const operator = await platformOperator(environment, origin)
    const url = environment.filesBaseURL + "/api/v1/platform/files/workspace"
    const response = await fetch(url, { headers: operator.headers })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({
      root: { kind: "folder", name: "", parentId: null, state: "active" },
      usage: {
        quotaBytes: 10737418240,
        usedBytes: 0,
        reservedBytes: 0,
        transientBytes: 0,
        trashDays: 30,
        historyDays: 90,
      },
    })
    const user = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    expect((await fetch(url, { headers: user.headers })).status).toBe(403)
  })

  test("目录创建持久化层级，同一请求重放返回原操作并拒绝同级重名", async () => {
    const operator = await platformOperator(environment, origin)
    const url = environment.filesBaseURL + "/api/v1/platform/files"
    const request = (path, body) =>
      fetch(url + path, {
        method: body ? "POST" : "GET",
        headers: {
          ...Object.fromEntries(operator.headers),
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    const workspace = await (await request("/workspace")).json()
    const input = {
      operationId: randomUUID(),
      parentId: workspace.root.id,
      name: "公告素材",
    }
    const response = await request("/folders", input)
    expect(response.status, await response.clone().text()).toBe(200)
    const receipt = await response.json()
    expect(receipt).toMatchObject({
      id: input.operationId,
      action: "create-folder",
      phase: "completed",
      result: { revision: 1 },
    })
    expect(await (await request("/folders", input)).json()).toEqual(receipt)
    const conflict = await request("/folders", {
      ...input,
      operationId: randomUUID(),
    })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ code: "FILE_NAME_CONFLICT" })
    const child = await request("/folders", {
      operationId: randomUUID(),
      parentId: receipt.result.entryId,
      name: "图片",
    })
    expect(child.status, await child.clone().text()).toBe(200)
    const childId = (await child.json()).result.entryId
    const breadcrumbs = await (
      await request(`/folders/${childId}/breadcrumbs`)
    ).json()
    expect(breadcrumbs.items.map((item) => item.name)).toEqual([
      "",
      "公告素材",
      "图片",
    ])
    const listing = await (
      await request(`?parentId=${receipt.result.entryId}`)
    ).json()
    expect(listing.items.map((item) => item.name)).toEqual(["图片"])
    expect(
      await (await request(`/operations/${input.operationId}`)).json()
    ).toEqual(receipt)
  })
  test("上传、覆盖和版本下载保留字节与容量事实", async () => {
    const operator = await platformOperator(environment, origin)
    const url = environment.filesBaseURL + "/api/v1/platform/files"
    const workspace = await (
      await fetch(url + "/workspace", { headers: operator.headers })
    ).json()
    const upload = async (path, fields, text) => {
      const bytes = Buffer.from(text)
      const form = new FormData()
      for (const [key, value] of Object.entries({
        ...fields,
        contentSha256: createHash("sha256").update(bytes).digest("hex"),
        declaredBytes: bytes.length,
      }))
        form.set(key, String(value))
      form.set("file", new Blob([bytes], { type: "text/plain" }), "说明.txt")
      const response = await fetch(url + path, {
        method: "POST",
        headers: operator.headers,
        body: form,
      })
      expect(response.status, await response.clone().text()).toBe(200)
      return response.json()
    }
    const first = await upload(
      "/uploads",
      {
        operationId: randomUUID(),
        parentId: workspace.root.id,
        name: "说明.txt",
      },
      "第一版"
    )
    const second = await upload(
      `/entries/${first.result.entryId}/versions`,
      { operationId: randomUUID(), expectedRevision: 1 },
      "第二版新内容"
    )
    expect(second.result).toMatchObject({
      entryId: first.result.entryId,
      revision: 2,
    })
    expect(second.result.versionId).not.toBe(first.result.versionId)
    for (const [receipt, expected] of [
      [first, "第一版"],
      [second, "第二版新内容"],
    ]) {
      const response = await fetch(
        `${url}/entries/${receipt.result.entryId}/versions/${receipt.result.versionId}/content`,
        { headers: operator.headers }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.text()).toBe(expected)
    }
    const versions = await (
      await fetch(`${url}/entries/${first.result.entryId}/versions`, {
        headers: operator.headers,
      })
    ).json()
    expect(versions.items).toHaveLength(2)
    expect(versions.items.filter((item) => item.isCurrent)).toHaveLength(1)
    const usage = (
      await (
        await fetch(url + "/workspace", { headers: operator.headers })
      ).json()
    ).usage
    expect(usage).toMatchObject({
      usedBytes: Buffer.byteLength("第一版第二版新内容"),
      reservedBytes: 0,
      transientBytes: 0,
    })
  })

  test("目录子树改名、移动、回收与恢复保持物理层级，清除后结算容量", async () => {
    const operator = await platformOperator(environment, origin)
    const url = environment.filesBaseURL + "/api/v1/platform/files"
    const request = (path, body) =>
      fetch(url + path, {
        method: body ? "POST" : "GET",
        headers: {
          ...Object.fromEntries(operator.headers),
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    const root = (await (await request("/workspace")).json()).root.id
    const create = async (parentId, name) => {
      const response = await request("/folders", {
        operationId: randomUUID(),
        parentId,
        name,
      })
      expect(response.status, await response.clone().text()).toBe(200)
      return (await response.json()).result.entryId
    }
    const folder = await create(root, "业务目录")
    const child = await create(folder, "空目录")
    const destination = await create(root, "目标目录")
    const action = async (id, action, expectedRevision, extra = {}) => {
      const response = await request(`/entries/${id}/${action}`, {
        operationId: randomUUID(),
        expectedRevision,
        ...extra,
      })
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.json()).toMatchObject({ phase: "completed" })
    }
    await action(folder, "rename", 1, { name: "业务素材" })
    expect((await (await request(`/entries/${child}`)).json()).path).toEqual([
      "业务素材",
      "空目录",
    ])
    await action(folder, "move", 2, { parentId: destination })
    await action(folder, "trash", 3)
    const nestedTrash = await request(`?state=trashed&parentId=${folder}`)
    expect(nestedTrash.status, await nestedTrash.clone().text()).toBe(200)
    expect((await nestedTrash.json()).items.map((item) => item.id)).toEqual([
      child,
    ])
    expect(
      (await (await request("?state=trashed")).json()).items.map(
        (item) => item.id
      )
    ).toContain(folder)
    await action(folder, "restore", 4)
    expect((await (await request(`/entries/${child}`)).json()).path).toEqual([
      "目标目录",
      "业务素材",
      "空目录",
    ])
    await action(folder, "trash", 5)
    await action(folder, "purge", 6)
    expect((await request(`/entries/${child}`)).status).toBe(404)
  })

  test("独立策略检查版本，批量操作保留逐项失败与稳定重放", async () => {
    const operator = await platformOperator(environment, origin)
    const url = environment.filesBaseURL + "/api/v1/platform/files"
    const request = (path, body) =>
      fetch(url + path, {
        method: body ? "POST" : "GET",
        headers: {
          ...Object.fromEntries(operator.headers),
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    const current = await request("/policy")
    expect(current.status, await current.clone().text()).toBe(200)
    const policy = await current.json()
    const updated = await request("/policy", {
      expectedRevision: policy.policyRevision,
      quotaBytes: 2048,
      trashDays: 31,
      historyDays: 91,
    })
    expect(updated.status, await updated.clone().text()).toBe(200)
    expect(await updated.json()).toMatchObject({
      quotaBytes: 2048,
      policyRevision: policy.policyRevision + 1,
    })
    expect(
      (
        await request("/policy", {
          expectedRevision: policy.policyRevision,
          quotaBytes: 4096,
          trashDays: 30,
          historyDays: 90,
        })
      ).status
    ).toBe(409)
    const root = (await (await request("/workspace")).json()).root.id
    const created = await (
      await request("/folders", {
        operationId: randomUUID(),
        parentId: root,
        name: "批量目录",
      })
    ).json()
    const input = {
      batchId: randomUUID(),
      action: "trash",
      items: [
        {
          entryId: created.result.entryId,
          operationId: randomUUID(),
          expectedRevision: 1,
        },
        {
          entryId: randomUUID(),
          operationId: randomUUID(),
          expectedRevision: 1,
        },
      ],
    }
    const batch = await request("/batches", input)
    expect(batch.status, await batch.clone().text()).toBe(200)
    const result = await batch.json()
    expect(result.items.map((item) => item.state)).toEqual([
      "completed",
      "failed",
    ])
    expect(result.items[1].error.code).toBe("NOT_FOUND")
    expect(await (await request("/batches", input)).json()).toEqual(result)
    expect(await (await request(`/batches/${input.batchId}`)).json()).toEqual(
      result
    )
  })

  test("公告复用固定文件版本，覆盖不改读者内容，活跃引用阻止回收文件和祖先目录", async () => {
    const operator = await platformOperator(environment, origin)
    const base = environment.filesBaseURL + "/api/v1"
    const headers = {
      ...Object.fromEntries(operator.headers),
      "content-type": "application/json",
    }
    const root = (
      await (
        await fetch(base + "/platform/files/workspace", {
          headers: operator.headers,
        })
      ).json()
    ).root.id
    const upload = async (path, fields, content) => {
      const form = new FormData()
      const bytes = Buffer.from(content)
      for (const [name, value] of Object.entries({
        ...fields,
        declaredBytes: bytes.length,
        contentSha256: createHash("sha256").update(bytes).digest("hex"),
      }))
        form.set(name, String(value))
      form.set(
        "file",
        new Blob([bytes], { type: "text/plain" }),
        "公告共享.txt"
      )
      const response = await fetch(base + "/platform/files" + path, {
        method: "POST",
        headers: operator.headers,
        body: form,
      })
      expect(response.status, await response.clone().text()).toBe(200)
      return (await response.json()).result
    }
    const folders = []
    for (const name of ["公告引用目录", "引用素材"]) {
      const response = await fetch(base + "/platform/files/folders", {
        method: "POST",
        headers,
        body: JSON.stringify({
          operationId: randomUUID(),
          parentId: folders.at(-1) ?? root,
          name,
        }),
      })
      expect(response.status, await response.clone().text()).toBe(200)
      folders.push((await response.json()).result.entryId)
    }
    const version = await upload(
      "/uploads",
      {
        operationId: randomUUID(),
        parentId: folders.at(-1),
        name: "公告共享.txt",
      },
      "原公告字节"
    )
    const reference = { fileId: version.entryId, versionId: version.versionId }
    const input = {
      title: "平台文件验收",
      type: "notice",
      audience: "platform",
      organizationIds: [],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "固定版本" }] },
        ],
      },
      attachments: [reference],
    }
    const response = await fetch(base + "/platform/announcements", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    })
    expect(response.status, await response.clone().text()).toBe(201)
    const announcement = await response.json()
    const reused = await fetch(base + "/platform/announcements", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...input, title: "另一份公告" }),
    })
    expect(reused.status, await reused.clone().text()).toBe(201)
    const published = await fetch(
      `${base}/platform/announcements/${announcement.id}/publish`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          expectedVersion: announcement.version,
          audience: "platform",
          organizationIds: [],
        }),
      }
    )
    expect(published.status, await published.clone().text()).toBe(201)
    await upload(
      `/entries/${version.entryId}/versions`,
      { operationId: randomUUID(), expectedRevision: 1 },
      "新的文件内容"
    )
    const media = await fetch(
      `${base}/platform/announcement-inbox/media/${version.entryId}?versionId=${version.versionId}`,
      { headers: operator.headers }
    )
    expect(media.status, await media.clone().text()).toBe(200)
    expect(await media.text()).toBe("原公告字节")
    for (const entryId of [version.entryId, ...folders]) {
      const trash = await fetch(
        `${base}/platform/files/entries/${entryId}/trash`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            operationId: randomUUID(),
            expectedRevision: entryId === version.entryId ? 2 : 1,
          }),
        }
      )
      expect(trash.status).toBe(409)
      expect(await trash.json()).toMatchObject({ code: "FILE_REFERENCED" })
    }
    const refs = await (
      await fetch(
        `${base}/platform/files/entries/${version.entryId}/references`,
        { headers: operator.headers }
      )
    ).json()
    expect(refs.total).toBe(2)
    expect(refs.items.map((item) => item.announcementId)).toContain(
      announcement.id
    )
  })

  test("保留维护清除到期历史和回收站，但保留公告引用的到期版本", async () => {
    const operator = await platformOperator(environment, origin)
    const base = environment.filesBaseURL + "/api/v1/platform/files"
    const versions = await environment.migrator.query(
      "SELECT v.id,v.file_id,EXISTS(SELECT 1 FROM platform_file_references r WHERE r.version_id=v.id) pinned FROM platform_file_versions v WHERE v.retired_at IS NOT NULL AND v.state='available'"
    )
    expect(versions.rows.some((row) => row.pinned)).toBe(true)
    expect(versions.rows.some((row) => !row.pinned)).toBe(true)
    await environment.migrator.query(
      "UPDATE platform_file_versions SET expires_at=now()-interval '1 day' WHERE retired_at IS NOT NULL"
    )
    await environment.migrator.query(
      "UPDATE platform_file_entries SET expires_at=now()-interval '1 day' WHERE state='trashed'"
    )
    await environment.platformMaintenance()
    for (const row of versions.rows) {
      const response = await fetch(
        `${base}/entries/${row.file_id}/versions/${row.id}/content`,
        { headers: operator.headers }
      )
      expect(response.status, await response.clone().text()).toBe(
        row.pinned ? 200 : 404
      )
    }
    const trash = await (
      await fetch(base + "?state=trashed", { headers: operator.headers })
    ).json()
    expect(trash.items).toEqual([])
    const usage = (
      await (
        await fetch(base + "/workspace", { headers: operator.headers })
      ).json()
    ).usage
    expect(usage).toMatchObject({ reservedBytes: 0, transientBytes: 0 })
    const ledger = await environment.migrator.query(
      "SELECT coalesce(sum(bytes),0)::integer bytes FROM platform_file_versions WHERE state='available'"
    )
    expect(usage.usedBytes).toBe(ledger.rows[0].bytes)
  })
  test("平台动作独立授权，撤权立即生效，配额拒绝不留下占用", async () => {
    const admin = await platformOperator(environment, origin),
      base = environment.filesBaseURL + "/api/v1/platform"
    const request = (actor, path, body, method = body ? "POST" : "GET") =>
      fetch(base + path, {
        method,
        headers: {
          ...Object.fromEntries(actor.headers),
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    const roleResponse = await request(admin, "/roles", {
      key: `file-reader-${randomUUID()}`,
      name: "文件受限角色",
      status: "active",
      sort: 0,
    })
    expect(roleResponse.status, await roleResponse.clone().text()).toBe(201)
    const role = await roleResponse.json()
    const reads = ["platform.file:read", "platform.folder:read"]
    const set = async (permissions) => {
      const response = await request(
        admin,
        `/roles/${role.id}/permissions`,
        { permissions },
        "PATCH"
      )
      expect(response.status, await response.clone().text()).toBe(200)
    }
    await set(reads)
    const reader = await platformOperator(environment, origin, role.key)
    const workspace = await (await request(reader, "/files/workspace")).json()
    expect(workspace.root.kind).toBe("folder")
    expect(
      (
        await request(reader, "/files/folders", {
          operationId: randomUUID(),
          parentId: workspace.root.id,
          name: "无权创建",
        })
      ).status
    ).toBe(403)
    expect((await request(reader, "/files/policy")).status).toBe(403)
    const upload = async (actor, fields, path = "/files/uploads") => {
      const form = new FormData(),
        bytes = Buffer.from("权限与配额")
      for (const [key, value] of Object.entries({
        ...fields,
        contentSha256: createHash("sha256").update(bytes).digest("hex"),
        declaredBytes: bytes.length,
      }))
        form.set(key, String(value))
      form.set("file", new Blob([bytes], { type: "text/plain" }), "受限.txt")
      return fetch(base + path, {
        method: "POST",
        headers: actor.headers,
        body: form,
      })
    }
    expect(
      (
        await upload(reader, {
          operationId: randomUUID(),
          parentId: workspace.root.id,
          name: "无权.txt",
        })
      ).status
    ).toBe(403)
    await set([...reads, "platform.file:create"])
    const posted = await upload(reader, {
      operationId: randomUUID(),
      parentId: workspace.root.id,
      name: `受限-${randomUUID()}.txt`,
    })
    expect(posted.status, await posted.clone().text()).toBe(200)
    const receipt = await posted.json()
    await set([...reads, "platform.file:update"])
    expect(
      (
        await upload(
          reader,
          { operationId: randomUUID(), expectedRevision: 1 },
          `/files/entries/${receipt.result.entryId}/versions`
        )
      ).status
    ).toBe(403)
    await set([])
    expect((await request(reader, "/files/workspace")).status).toBe(403)
    expect(
      (await request(reader, `/files/operations/${receipt.id}`)).status
    ).toBe(403)
    const policy = await (await request(admin, "/files/policy")).json()
    const changed = await request(admin, "/files/policy", {
      expectedRevision: policy.policyRevision,
      quotaBytes: policy.usedBytes,
      trashDays: policy.trashDays,
      historyDays: policy.historyDays,
    })
    expect(changed.status, await changed.clone().text()).toBe(200)
    const denied = await upload(admin, {
      operationId: randomUUID(),
      parentId: workspace.root.id,
      name: "配额不足.txt",
    })
    expect(denied.status, await denied.clone().text()).toBe(409)
    expect(await denied.json()).toMatchObject({ code: "FILE_QUOTA_EXCEEDED" })
    const after = await (await request(admin, "/files/policy")).json()
    expect(after).toMatchObject({
      usedBytes: policy.usedBytes,
      reservedBytes: 0,
      transientBytes: 0,
    })
    expect(
      (
        await request(admin, "/files/policy", {
          expectedRevision: after.policyRevision,
          quotaBytes: policy.quotaBytes,
          trashDays: policy.trashDays,
          historyDays: policy.historyDays,
        })
      ).status
    ).toBe(200)
  })

  test("含文件子树的移动回收恢复保持历史字节，禁止回收内容下载", async () => {
    const actor = await platformOperator(environment, origin),
      base = environment.filesBaseURL + "/api/v1/platform/files"
    const request = (path, body) =>
      fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          ...Object.fromEntries(actor.headers),
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    const root = (await (await request("/workspace")).json()).root.id
    const folder = (
      await (
        await request("/folders", {
          operationId: randomUUID(),
          parentId: root,
          name: `物理回归-${randomUUID()}`,
        })
      ).json()
    ).result.entryId
    const upload = async (path, fields, text) => {
      const form = new FormData(),
        bytes = Buffer.from(text)
      for (const [key, value] of Object.entries({
        ...fields,
        contentSha256: createHash("sha256").update(bytes).digest("hex"),
        declaredBytes: bytes.length,
      }))
        form.set(key, String(value))
      form.set(
        "file",
        new Blob([bytes], { type: "application/json" }),
        "fact.json"
      )
      const response = await fetch(base + path, {
        method: "POST",
        headers: actor.headers,
        body: form,
      })
      expect(response.status, await response.clone().text()).toBe(200)
      return (await response.json()).result
    }
    const old = await upload(
      "/uploads",
      { operationId: randomUUID(), parentId: folder, name: "fact.json" },
      '{"version":1}'
    )
    const current = await upload(
      `/entries/${old.entryId}/versions`,
      { operationId: randomUUID(), expectedRevision: 1 },
      '{"version":2}'
    )
    const content = (version) =>
      `/entries/${old.entryId}/versions/${version}/content`
    const action = async (action, revision, extra = {}) => {
      const response = await request(`/entries/${folder}/${action}`, {
        operationId: randomUUID(),
        expectedRevision: revision,
        ...extra,
      })
      expect(response.status, await response.clone().text()).toBe(200)
    }
    await action("rename", 1, { name: `已移动-${randomUUID()}` })
    const partial = await fetch(base + content(current.versionId), {
      headers: { ...Object.fromEntries(actor.headers), Range: "bytes=0-3" },
    })
    expect(partial.status).toBe(206)
    expect(await partial.text()).toBe('{"ve')
    await action("trash", 2)
    expect((await request(content(old.versionId))).status).toBe(404)
    expect((await request(content(current.versionId))).status).toBe(404)
    await action("restore", 3)
    expect(await (await request(content(old.versionId))).text()).toBe(
      '{"version":1}'
    )
    expect(await (await request(content(current.versionId))).text()).toBe(
      '{"version":2}'
    )
    const versions = await (
      await request(`/entries/${old.entryId}/versions`)
    ).json()
    expect(
      versions.items.every((version) => version.previewKind === "text")
    ).toBe(true)
    const tooLong = await request(`/entries/${folder}/rename`, {
      operationId: randomUUID(),
      expectedRevision: 4,
      name: "x".repeat(247),
    })
    expect(tooLong.status, await tooLong.clone().text()).toBe(400)
    await action("trash", 4)
    await action("purge", 5)
    expect((await request(`/entries/${old.entryId}`)).status).toBe(404)
    expect((await (await request("/workspace")).json()).usage).toMatchObject({
      reservedBytes: 0,
      transientBytes: 0,
    })
  })
  test("批次不复用其他意图收据，独立回收的父子根各自执行", async () => {
    const operator = await platformOperator(environment, origin)
    const base = environment.filesBaseURL + "/api/v1/platform/files"
    const request = async (path, body) => {
      const response = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          ...Object.fromEntries(operator.headers),
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      expect(response.status, await response.clone().text()).toBe(200)
      return response.json()
    }
    const root = (await request("/workspace")).root.id
    const parent = await request("/folders", {
      operationId: randomUUID(),
      parentId: root,
      name: "独立回收父目录",
    })
    const child = await request("/folders", {
      operationId: randomUUID(),
      parentId: parent.result.entryId,
      name: "独立回收子目录",
    })
    const reused = await request("/batches", {
      batchId: randomUUID(),
      action: "trash",
      items: [
        {
          entryId: child.result.entryId,
          expectedRevision: 1,
          operationId: parent.id,
        },
      ],
    })
    expect(reused.items[0]).toMatchObject({
      state: "failed",
      operation: null,
      error: { code: "IDEMPOTENCY_KEY_REUSED" },
    })
    expect(await request(`/entries/${child.result.entryId}`)).toMatchObject({
      state: "active",
      revision: 1,
    })
    await request(`/entries/${child.result.entryId}/trash`, {
      operationId: randomUUID(),
      expectedRevision: 1,
    })
    await request(`/entries/${parent.result.entryId}/trash`, {
      operationId: randomUUID(),
      expectedRevision: 1,
    })
    const batch = await request("/batches", {
      batchId: randomUUID(),
      action: "restore",
      items: [parent, child].map((receipt) => ({
        entryId: receipt.result.entryId,
        operationId: randomUUID(),
        expectedRevision: 2,
      })),
    })
    expect(batch.items.map((item) => item.state)).toEqual([
      "completed",
      "completed",
    ])
    for (const entry of [parent, child])
      expect(await request(`/entries/${entry.result.entryId}`)).toMatchObject({
        state: "active",
        revision: 3,
      })
  })

  test("运行角色不能直接读取内部文件定位投影", async () => {
    await expect(
      environment.runtime.pool.query(
        "SELECT public.get_platform_file_internal($1,$2)",
        [randomUUID(), randomUUID()]
      )
    ).rejects.toMatchObject({ code: "42501" })
  })
  test("公告重复同名上传各自创建文件，正文与附件读取校验选定版本", async () => {
    const operator = await platformOperator(environment, origin)
    const base = environment.filesBaseURL + "/api/v1"
    const references = []
    for (const body of ["同名第一份", "同名第二份"]) {
      const form = new FormData()
      form.set(
        "file",
        new Blob([body], { type: "text/plain" }),
        "重复公告附件.txt"
      )
      const response = await fetch(base + "/platform/announcements/media", {
        method: "POST",
        headers: operator.headers,
        body: form,
      })
      expect(response.status, await response.clone().text()).toBe(201)
      const reference = await response.json()
      references.push(reference)
      const content = await fetch(
        base +
          `/platform/announcements/media/${reference.fileId}?versionId=${reference.versionId}`,
        { headers: operator.headers }
      )
      expect(content.status, await content.clone().text()).toBe(200)
      expect(await content.text()).toBe(body)
    }
    expect(references[0].fileId).not.toBe(references[1].fileId)
    const entries = await Promise.all(
      references.map(async (reference) =>
        (
          await fetch(base + `/platform/files/entries/${reference.fileId}`, {
            headers: operator.headers,
          })
        ).json()
      )
    )
    expect(entries.map((entry) => entry.name)).toEqual([
      "重复公告附件.txt",
      "重复公告附件 (2).txt",
    ])
  })

  test("中断的路径操作按提交事实恢复，重复请求不会产生第二个版本或重复结算", async () => {
    const operator = await platformOperator(environment, origin)
    const base = environment.filesBaseURL + "/api/v1/platform/files"
    const form = new FormData(),
      bytes = Buffer.from("恢复验证的原字节")
    for (const [name, value] of Object.entries({
      operationId: randomUUID(),
      parentId: "00000000-0000-4000-8000-000000000002",
      name: "恢复源.txt",
      declaredBytes: bytes.length,
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
    }))
      form.set(name, String(value))
    form.set("file", new Blob([bytes], { type: "text/plain" }), "恢复源.txt")
    const uploaded = await fetch(base + "/uploads", {
      method: "POST",
      headers: operator.headers,
      body: form,
    })
    expect(uploaded.status, await uploaded.clone().text()).toBe(200)
    const entry = (await uploaded.json()).result
    const session = (
      await environment.observer.query(
        "SELECT id FROM public.session WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
        [operator.user.id]
      )
    ).rows[0].id
    const actor = [operator.user.id, session],
      owner = { kind: "platform", id: "00000000-0000-4000-8000-000000000002" }
    const call = async (name, args) =>
      (
        await environment.runtime.pool.query(
          `SELECT public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) AS result`,
          args
        )
      ).rows[0].result
    for (const committed of [false, true]) {
      const id = randomUUID(),
        lease = randomUUID()
      const input = {
        operationId: id,
        entryId: entry.entryId,
        expectedRevision: 1,
        name: committed ? "恢复提交.txt" : "恢复回滚.txt",
      }
      await call("platform_file_begin", [
        ...actor,
        id,
        "rename",
        input,
        "interrupted-test",
        lease,
      ])
      const journal = await call("platform_file_prepare_path", [
        ...actor,
        id,
        lease,
      ])
      const object = journal.objects[0]
      const source = {
          owner,
          area: object.sourceArea,
          segments: object.sourcePath,
        },
        target = { owner, area: object.targetArea, segments: object.targetPath }
      await environment.physical.copy(source, target, {
        bytes: object.expectedBytes,
        sha256: object.expectedSha256,
      })
      await call("platform_file_object_fact", [
        id,
        lease,
        object.id,
        "targetPrepared",
      ])
      if (committed)
        await call("platform_file_commit_path", [...actor, id, lease])
      // 模拟进程在物理准备后或事务已提交但响应未送达时退出；恢复器仅消费持久日志。
      await environment.observer.query(
        "UPDATE public.platform_file_operations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [id]
      )
      await environment.platformMaintenance()
      const receipt = await (
        await fetch(base + `/operations/${id}`, { headers: operator.headers })
      ).json()
      expect(receipt.phase).toBe(committed ? "completed" : "failed")
      expect(
        await environment.physical.read(committed ? source : target)
      ).toEqual({ missing: true })
      expect(
        Buffer.from(
          (await environment.physical.read(committed ? target : source)).base64,
          "base64"
        )
      ).toEqual(bytes)
      const replay = await fetch(base + `/entries/${entry.entryId}/rename`, {
        method: "POST",
        headers: {
          ...Object.fromEntries(operator.headers),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operationId: id,
          expectedRevision: 1,
          name: input.name,
        }),
      })
      expect(replay.status).toBe(200)
      expect(await replay.json()).toEqual(receipt)
    }
    const file = await (
      await fetch(base + `/entries/${entry.entryId}`, {
        headers: operator.headers,
      })
    ).json()
    expect(file).toMatchObject({
      name: "恢复提交.txt",
      revision: 2,
      operationId: null,
    })
    const versions = await (
      await fetch(base + `/entries/${entry.entryId}/versions`, {
        headers: operator.headers,
      })
    ).json()
    expect(versions.items).toHaveLength(1)
    const usage = (
      await (
        await fetch(base + "/workspace", { headers: operator.headers })
      ).json()
    ).usage
    expect(usage).toMatchObject({ reservedBytes: 0, transientBytes: 0 })
  })
  test("文件库使用任务资源 UUID 作为文件名也不改变任务原字节", async () => {
    const operator = await platformOperator(environment, origin)
    const base = environment.filesBaseURL + "/api/v1/platform/files"
    const taskId = randomUUID(),
      taskBytes = Buffer.from("独立任务原字节")
    const taskOwner = {
      kind: "platform",
      id: "00000000-0000-4000-8000-000000000001",
    }
    const taskAddress = { owner: taskOwner, area: "files", segments: [taskId] }
    await environment.physical.ensureOwner(taskOwner)
    await environment.physical.write(taskAddress, taskBytes)
    const session = (
      await environment.observer.query(
        "SELECT id FROM public.session WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
        [operator.user.id]
      )
    ).rows[0].id
    await environment.runtime.pool.query(
      "SELECT public.create_platform_resource($1,$2,$3,'task-output','任务结果.txt','text/plain',$4,$5,$6)",
      [
        operator.user.id,
        session,
        taskId,
        taskBytes.length,
        createHash("sha256").update(taskBytes).digest("hex"),
        randomUUID(),
      ]
    )
    const bytes = Buffer.from("同名文件库内容")
    const form = new FormData()
    for (const [key, value] of Object.entries({
      operationId: randomUUID(),
      parentId: "00000000-0000-4000-8000-000000000002",
      name: taskId,
      declaredBytes: bytes.length,
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
    }))
      form.append(key, String(value))
    form.append("file", new File([bytes], taskId, { type: "text/plain" }))
    const uploaded = await fetch(base + "/uploads", {
      method: "POST",
      headers: operator.headers,
      body: form,
    })
    expect(uploaded.status, await uploaded.clone().text()).toBe(200)
    const file = (await uploaded.json()).result
    const content = await fetch(
      base + `/entries/${file.entryId}/versions/${file.versionId}/content`,
      { headers: operator.headers }
    )
    expect(Buffer.from(await content.arrayBuffer())).toEqual(bytes)
    for (const action of ["trash", "purge"]) {
      const result = await fetch(base + `/entries/${file.entryId}/${action}`, {
        method: "POST",
        headers: {
          ...Object.fromEntries(operator.headers),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operationId: randomUUID(),
          expectedRevision: action === "trash" ? 1 : 2,
        }),
      })
      expect(result.status, await result.clone().text()).toBe(200)
      expect(
        Buffer.from(
          (await environment.physical.read(taskAddress)).base64,
          "base64"
        )
      ).toEqual(taskBytes)
    }
  })
})
