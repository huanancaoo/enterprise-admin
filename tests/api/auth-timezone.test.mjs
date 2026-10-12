import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"
import { beforeAll, afterAll, expect, test } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

const { createApplication } = createRequire(import.meta.url)(
  "../../apps/api/dist/create-application.js"
)
let environment, app, baseURL, actor, organization
beforeAll(async () => {
  environment = await startTestApplication()
  actor = await signUpVerified(
    environment.baseURL,
    "http://localhost:3200",
    environment.migrator
  )
  organization = await environment.runtime.auth.api.createOrganization({
    headers: actor.headers,
    body: { name: "Timezone identity", slug: randomUUID() },
  })
  const url = new URL(environment.config.databaseURL)
  url.searchParams.set("options", "-c timezone=Asia/Shanghai")
  app = await createApplication(
    { ...environment.config, databaseURL: url.href },
    { logger: ["error"] }
  )
  await app.listen(0, "127.0.0.1")
  baseURL = await app.getUrl()
})
afterAll(async () => {
  await app?.close()
  await environment?.close()
})
test("非UTC数据库会话仍按原生UTC存储识别一小时凭据，并在写事务复核", async () => {
  const path = `${baseURL}/api/v1/organizations/${organization.id}`
  const issued = await fetch(`${path}/access-credentials`, {
    method: "POST",
    headers: {
      ...Object.fromEntries(actor.headers),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "One hour",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      permissions: { project: ["read", "create"] },
    }),
  })
  expect(issued.status).toBe(201)
  const credential = await issued.json()
  const read = await fetch(`${path}/projects`, {
    headers: { "x-api-key": credential.key },
  })
  expect(read.status).toBe(200)
  const written = await fetch(`${path}/projects`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": credential.key,
    },
    body: JSON.stringify({ name: "Native UTC fence", description: null }),
  })
  expect(written.status).toBe(201)
})

test("当前会话缩短至一小时后，非UTC连接仍按实际期限授权", async () => {
  const session = await environment.runtime.auth.api.getSession({
    headers: actor.headers,
  })
  // 缩短真实原生会话的到期事实，以覆盖默认七天期限掩盖的时区偏移；不改成员或权限。
  await environment.migrator.query(
    "UPDATE public.session SET expires_at=(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour' WHERE id=$1 AND user_id=$2",
    [session.session.id, actor.user.id]
  )
  const response = await fetch(
    `${baseURL}/api/v1/organizations/${organization.id}/projects`,
    { headers: actor.headers }
  )
  expect(response.status).toBe(200)
  const written = await fetch(
    `${baseURL}/api/v1/organizations/${organization.id}/projects`,
    {
      method: "POST",
      headers: {
        ...Object.fromEntries(actor.headers),
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Short active session", description: null }),
    }
  )
  expect(written.status).toBe(201)
})
