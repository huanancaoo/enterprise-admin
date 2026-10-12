import { randomUUID } from "node:crypto"
import { expect, test } from "vitest"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startFilesEnvironment } from "../setup/files-environment.mjs"

test("保存项目正文与薄变更事件同事务提交，正文内容不进入 Webhook", async () => {
  const resources = new AsyncDisposableStack()
  try {
    const environment = await startFilesEnvironment("RustFS", resources)
    const actor = await signUpVerified(
      environment.baseURL,
      "http://localhost:3200",
      environment.migrator
    )
    const organization = await environment.runtime.auth.api.createOrganization({
      headers: actor.headers,
      body: { name: "正文事件", slug: randomUUID() },
    })
    const path = `${environment.baseURL}/api/v1/organizations/${organization.id}`
    const headers = {
      ...Object.fromEntries(actor.headers),
      "content-type": "application/json",
    }
    const endpoint = await fetch(`${path}/webhooks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "正文订阅",
        url: "http://127.0.0.1:9/events",
        events: ["project.updated"],
      }),
    })
    expect(endpoint.status).toBe(201)
    const webhook = await endpoint.json()
    const created = await fetch(`${path}/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "正文项目",
        description: null,
        contentLocale: "zh-CN",
      }),
    })
    expect(created.status).toBe(201)
    const project = await created.json()
    const marker = `private-document-${randomUUID()}`
    const document = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: marker }] },
      ],
    }
    const saved = await fetch(`${path}/projects/${project.id}/content/zh-CN`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ expectedRevision: null, document }),
    })
    expect(saved.status).toBe(200)
    const read = await fetch(`${path}/projects/${project.id}/content/zh-CN`, {
      headers: actor.headers,
    })
    expect((await read.json()).document).toEqual(document)
    const events = await environment.observer.query(
      "SELECT payload FROM domain_events WHERE organization_id=$1 AND resource_id=$2 AND type='project.updated'",
      [organization.id, project.id]
    )
    expect(events.rows).toHaveLength(1)
    expect(events.rows[0].payload).toEqual({
      changes: ["content"],
      locale: "zh-CN",
    })
    expect(JSON.stringify(events.rows)).not.toContain(marker)
    const deliveries = await fetch(
      `${path}/webhooks/${webhook.id}/deliveries`,
      { headers: actor.headers }
    )
    expect((await deliveries.json()).total).toBe(1)
    await environment.migrator.query(
      "REVOKE INSERT ON audit_events FROM app_runtime"
    )
    try {
      const failed = await fetch(
        `${path}/projects/${project.id}/content/zh-CN`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({
            expectedRevision: 1,
            document: { type: "doc", content: [{ type: "paragraph" }] },
          }),
        }
      )
      expect(failed.status).toBe(500)
    } finally {
      await environment.migrator.query(
        "GRANT INSERT ON audit_events TO app_runtime"
      )
    }
    const still = await fetch(`${path}/projects/${project.id}/content/zh-CN`, {
      headers: actor.headers,
    })
    expect((await still.json()).document).toEqual(document)
    expect(
      (
        await environment.observer.query(
          "SELECT count(*)::int AS count FROM domain_events WHERE organization_id=$1 AND resource_id=$2 AND type='project.updated'",
          [organization.id, project.id]
        )
      ).rows[0].count
    ).toBe(1)
  } finally {
    await resources.disposeAsync()
  }
})
