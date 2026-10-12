import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startFilesEnvironment } from "../setup/files-environment.mjs"

describe("scoped credentials at the existing Files transaction seam", () => {
  const origin = "http://localhost:3200"
  let environment, resources
  beforeAll(async () => {
    resources = new AsyncDisposableStack()
    environment = await startFilesEnvironment("RustFS", resources)
  })
  afterAll(async () => resources?.disposeAsync())

  it("reads the workspace and commits a folder through the scoped credential actor", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Files API credentials", slug: randomUUID() },
    })
    const issued = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/access-credentials`,
      {
        method: "POST",
        headers: {
          cookie: owner.cookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Files integration",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          permissions: { file: ["read"], folder: ["read", "create"] },
        }),
      }
    )
    expect(issued.status).toBe(201)
    const credential = await issued.json()
    const url = `${baseURL}/api/v1/organizations/${org.id}/files`
    const headers = {
      "x-api-key": credential.key,
      "content-type": "application/json",
    }
    const workspace = await fetch(`${url}/workspace`, { headers })
    expect(workspace.status).toBe(200)
    const root = (await workspace.json()).root
    const created = await fetch(`${url}/folders`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        operationId: randomUUID(),
        parentId: root.id,
        name: "Integration folder",
      }),
    })
    expect(created.status).toBe(200)
    const operation = await created.json()
    expect(operation.phase).toBe("completed")
    const read = await fetch(`${url}/entries/${operation.result.entryId}`, {
      headers,
    })
    expect(read.status).toBe(200)
    expect((await read.json()).name).toBe("Integration folder")
  })
})
