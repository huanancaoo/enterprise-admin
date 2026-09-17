import { startAuthProbeDatabase } from "../setup/auth-probe-database.mjs"
import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { createRequire } from "node:module"
import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { createDatabase } from "../../packages/database/dist/index.js"

const require = createRequire(import.meta.url)
const {
  createApplication,
} = require("../../apps/api/dist/create-application.js")
const { AuthRuntime } = require("../../apps/api/dist/auth-runtime.js")

describe("S8-02: organization status access boundary", () => {
  let container, app, runtime, baseURL, migrator
  const origin = "http://localhost:3200"
  const post = (path, body, cookie) =>
    fetch(`${baseURL}/api/auth/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  const signup = async () => {
    const email = `${randomUUID()}@example.test`
    const response = await post("sign-up/email", {
      email,
      name: "S8 status",
      password: randomBytes(24).toString("hex"),
    })
    expect(response.status).toBe(200)
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    const { user } = await response.json()
    await migrator.query(
      'UPDATE "user" SET email_verified = true WHERE id = $1',
      [user.id]
    )
    return { user, email, cookie, headers: new Headers({ cookie, origin }) }
  }
  const organization = async (actor, name = "Status org") =>
    runtime.auth.api.createOrganization({
      headers: actor.headers,
      body: { name, slug: randomUUID() },
    })
  const suspend = (organizationId) =>
    migrator.query(
      "UPDATE organization_status SET status = 'SUSPENDED', status_version = status_version + 1, status_changed_at = now() WHERE organization_id = $1",
      [organizationId]
    )
  const json = (response) => response.json()

  beforeAll(async () => {
    const database = await startAuthProbeDatabase()
    container = database.container
    const { url, passwords } = database
    await promisify(execFile)(
      process.execPath,
      ["packages/database/src/migrate.ts"],
      {
        env: {
          PATH: process.env.PATH,
          MIGRATION_DATABASE_URL: url("app_migrator", passwords[1]),
        },
      }
    )
    migrator = createDatabase(url("app_migrator", passwords[1])).pool
    app = await createApplication(
      {
        databaseURL: url("app_runtime", passwords[2]),
        baseURL: "http://localhost:3000",
        secret: randomBytes(32).toString("hex"),
        trustedOrigins: [origin],
      },
      { logger: ["error"] }
    )
    await app.listen(0, "127.0.0.1")
    baseURL = await app.getUrl()
    runtime = app.get(AuthRuntime)
  })
  afterAll(async () => {
    await app?.close()
    await migrator?.end()
    await container?.stop()
  })

  it("lists membership organizations with status and allows access only when ACTIVE", async () => {
    const actor = await signup()
    const active = await organization(actor, "Active org")
    const stopped = await organization(actor, "Stopped org")
    await suspend(stopped.id)
    const listed = await fetch(`${baseURL}/api/v1/me/organizations`, {
      headers: { cookie: actor.cookie },
    })
    expect(listed.status).toBe(200)
    expect(await json(listed)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: active.id,
          name: "Active org",
          status: "ACTIVE",
        }),
        expect.objectContaining({
          id: stopped.id,
          name: "Stopped org",
          status: "SUSPENDED",
        }),
      ])
    )
    const allowed = await fetch(
      `${baseURL}/api/v1/organizations/${active.id}/access`,
      { headers: { cookie: actor.cookie } }
    )
    expect(allowed.status).toBe(200)
    expect(await json(allowed)).toMatchObject({
      organizationId: active.id,
      status: "ACTIVE",
    })
    const denied = await fetch(
      `${baseURL}/api/v1/organizations/${stopped.id}/access`,
      { headers: { cookie: actor.cookie } }
    )
    expect(denied.status).toBe(403)
    expect(await json(denied)).toMatchObject({ code: "ORGANIZATION_SUSPENDED" })
    const created = await fetch(
      `${baseURL}/api/v1/organizations/${stopped.id}/projects`,
      {
        method: "POST",
        headers: {
          cookie: actor.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "blocked", description: null }),
      }
    )
    expect(created.status).toBe(403)
    expect(await json(created)).toMatchObject({
      code: "ORGANIZATION_SUSPENDED",
    })
    const outsider = await signup()
    const leaked = await fetch(
      `${baseURL}/api/v1/organizations/${stopped.id}/access`,
      { headers: { cookie: outsider.cookie } }
    )
    expect(leaked.status).toBe(403)
    expect(await json(leaked)).toMatchObject({ code: "FORBIDDEN" })
    const nativeList = await fetch(`${baseURL}/api/auth/organization/list`, {
      headers: { cookie: actor.cookie },
    })
    expect(nativeList.status).toBe(200)
    const setStopped = await post(
      "organization/set-active",
      { organizationId: stopped.id },
      actor.cookie
    )
    expect(setStopped.status).toBe(403)
    const setActive = await post(
      "organization/set-active",
      { organizationId: active.id },
      actor.cookie
    )
    expect(setActive.status).toBe(200)
    await suspend(active.id)
    const nativeRead = await fetch(
      `${baseURL}/api/auth/organization/get-full-organization`,
      { headers: { cookie: actor.cookie } }
    )
    expect(nativeRead.status).toBe(403)
    expect(await json(nativeRead)).toMatchObject({
      code: "ORGANIZATION_SUSPENDED",
    })
  })

  it("missing organization status fails closed", async () => {
    const actor = await signup()
    const org = await organization(actor)
    await migrator.query(
      "DELETE FROM organization_status WHERE organization_id = $1",
      [org.id]
    )
    const access = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/access`,
      { headers: { cookie: actor.cookie } }
    )
    expect(access.status).toBe(503)
    expect(await json(access)).toMatchObject({
      code: "AUTHORIZATION_UNAVAILABLE",
    })
    const listed = await fetch(`${baseURL}/api/v1/me/organizations`, {
      headers: { cookie: actor.cookie },
    })
    expect(listed.status).toBe(503)
    expect(await json(listed)).toMatchObject({
      code: "AUTHORIZATION_UNAVAILABLE",
    })
  })
})
