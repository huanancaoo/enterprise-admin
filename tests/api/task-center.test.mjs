import { createHash, randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { startFilesEnvironment } from "../setup/files-environment.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("任务中心：真实 Files 操作与可见范围", () => {
  const resources = new AsyncDisposableStack()
  let environment, owner, organization
  const origin = "http://localhost:3200"
  beforeAll(async () => {
    environment = await startFilesEnvironment("RustFS", resources)
    owner = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Task center files", slug: randomUUID() },
    })
  })
  afterAll(() => resources.disposeAsync())
  const request = (actor, path, options = {}) =>
    fetch(
      `${environment.filesBaseURL}/api/v1/organizations/${organization.id}${path}`,
      {
        ...options,
        headers: { ...Object.fromEntries(actor.headers), ...options.headers },
      }
    )
  test("上传与批量操作保留真实来源状态，批内子项不重复展示", async () => {
    const workspace = await request(owner, "/files/workspace").then(
      (response) => response.json()
    )
    const bytes = Buffer.from("actual task center content")
    const operationId = randomUUID()
    const form = new FormData()
    for (const [key, value] of Object.entries({
      operationId,
      parentId: workspace.root.id,
      name: "task-center.txt",
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
      declaredBytes: bytes.length,
    }))
      form.append(key, String(value))
    form.append(
      "file",
      new File([bytes], "task-center.txt", { type: "text/plain" })
    )
    const uploaded = await request(owner, "/files/uploads", {
      method: "POST",
      body: form,
    })
    expect(uploaded.status).toBe(200)
    const upload = await uploaded.json()
    const entry = await request(
      owner,
      `/files/entries/${upload.result.entryId}`
    ).then((response) => response.json())
    const batchId = randomUUID(),
      childId = randomUUID()
    const submitted = await request(owner, "/files/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        batchId,
        action: "trash",
        items: [
          {
            entryId: entry.id,
            expectedRevision: entry.revision,
            operationId: childId,
          },
        ],
      }),
    })
    expect(submitted.status).toBe(200)
    const batch = await submitted.json()
    const center = await request(owner, "/task-center").then((response) =>
      response.json()
    )
    expect(center.visibility).toBe("organization")
    expect(center.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: operationId,
          source: "file-upload",
          status: "completed",
        }),
        expect.objectContaining({
          id: batchId,
          source: "file-batch",
          status: null,
        }),
      ])
    )
    expect(center.items.some((item) => item.id === childId)).toBe(false)
    const actual = center.items.find((item) => item.id === batchId)
    expect(actual.states.reduce((total, item) => total + item.count, 0)).toBe(
      batch.items.length
    )
  })
  test("普通成员仅看本人，owner看组织且跨组织资源不可见", async () => {
    const actor = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    await environment.runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: organization.id,
        userId: actor.user.id,
        role: "member",
      },
    })
    const ownerCenter = await request(owner, "/task-center").then((response) =>
      response.json()
    )
    const memberResponse = await request(actor, "/task-center")
    expect(memberResponse.status).toBe(200)
    const center = await memberResponse.json()
    expect(center).toMatchObject({ visibility: "own", items: [], total: 0 })
    expect(ownerCenter.total).toBeGreaterThan(0)
    const other = await environment.runtime.auth.api.createOrganization({
      headers: actor.headers,
      body: { name: "Other task center", slug: randomUUID() },
    })
    const cross = await fetch(
      `${environment.filesBaseURL}/api/v1/organizations/${other.id}/task-center`,
      { headers: owner.headers }
    )
    expect(cross.status).toBe(403)
  })
})
