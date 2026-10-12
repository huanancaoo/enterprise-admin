import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startTestApplication } from "../setup/test-runtime.mjs"

describe("organization-bound user API credentials", () => {
  const origin = "http://localhost:3200"
  let environment
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
  })
  afterAll(async () => environment?.close())
  it("issues a scoped credential and reads projects without creating a user session", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "API credentials", slug: randomUUID() },
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
          name: "Read projects",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          permissions: { project: ["read"] },
        }),
      }
    )
    expect(issued.status).toBe(201)
    const credential = await issued.json()
    expect({
      organizationId: credential.organizationId,
      userId: credential.userId,
      permissions: credential.permissions,
    }).toEqual({
      organizationId: org.id,
      userId: owner.user.id,
      permissions: { project: ["read"] },
    })
    expect(
      typeof credential.key === "string" && credential.key.startsWith("ea_")
    ).toBe(true)
    const projects = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/projects`,
      { headers: { "x-api-key": credential.key } }
    )
    expect(projects.status).toBe(200)
    expect((await projects.json()).items).toEqual([])
    const session = await fetch(`${baseURL}/api/auth/get-session`, {
      headers: { "x-api-key": credential.key },
    })
    expect((await session.json()) === null).toBe(true)
  })
  it("lists only metadata and revokes the owned credential before the next project call", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Revoke credential", slug: randomUUID() },
    })
    const url = `${baseURL}/api/v1/organizations/${org.id}/access-credentials`
    const headers = {
      cookie: owner.cookie,
      origin,
      "content-type": "application/json",
    }
    const issued = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Revoked integration",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        permissions: { project: ["read"] },
      }),
    })
    expect(issued.status).toBe(201)
    const credential = await issued.json()
    const listed = await fetch(url, { headers })
    expect(listed.status).toBe(200)
    const items = (await listed.json()).items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: credential.id, enabled: true })
    expect(Object.hasOwn(items[0], "key")).toBe(false)
    const revoke = await fetch(`${url}/${credential.id}`, {
      method: "DELETE",
      headers,
    })
    expect(revoke.status).toBe(204)
    const projects = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/projects`,
      { headers: { "x-api-key": credential.key } }
    )
    expect(projects.status).toBe(401)
    const after = await fetch(url, { headers })
    expect((await after.json()).items).toMatchObject([
      { id: credential.id, enabled: false },
    ])
  })

  it("commits an authorized project write using the credential identity without a Cookie session", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Credential writes", slug: randomUUID() },
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
          name: "Write projects",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          permissions: { project: ["create", "read"] },
        }),
      }
    )
    expect(issued.status).toBe(201)
    const credential = await issued.json()
    const url = `${baseURL}/api/v1/organizations/${org.id}/projects`
    const created = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": credential.key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Created by scoped integration",
        description: null,
      }),
    })
    expect(created.status).toBe(201)
    const project = await created.json()
    const read = await fetch(`${url}/${project.id}`, {
      headers: { "x-api-key": credential.key },
    })
    expect(read.status).toBe(200)
    expect((await read.json()).name).toBe("Created by scoped integration")
  })

  it("limits a privileged user's credential to its requested actions and one organization", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Scoped organization", slug: randomUUID() },
    })
    const other = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Different organization", slug: randomUUID() },
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
          name: "Read only",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          permissions: { project: ["read"] },
        }),
      }
    )
    expect(issued.status).toBe(201)
    const credential = await issued.json()
    const headers = {
      "x-api-key": credential.key,
      "content-type": "application/json",
    }
    const create = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/projects`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Must not be created",
          description: null,
        }),
      }
    )
    expect(create.status).toBe(403)
    const crossOrganization = await fetch(
      `${baseURL}/api/v1/organizations/${other.id}/projects`,
      { headers }
    )
    expect(crossOrganization.status).toBe(403)
    const read = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/projects`,
      { headers }
    )
    expect((await read.json()).items).toEqual([])
  })

  it("expires a credential according to its issued deadline", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Expiry organization", slug: randomUUID() },
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
          name: "Short lived",
          expiresAt: new Date(Date.now() + 3000).toISOString(),
          permissions: { project: ["read"] },
        }),
      }
    )
    expect(issued.status).toBe(201)
    const credential = await issued.json()
    const url = `${baseURL}/api/v1/organizations/${org.id}/projects`
    const headers = { "x-api-key": credential.key }
    expect((await fetch(url, { headers })).status).toBe(200)
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.max(0, Date.parse(credential.expiresAt) - Date.now() + 100)
      )
    )
    expect((await fetch(url, { headers })).status).toBe(401)
  })

  it("reports the same native expiry instant after issuance and metadata listing", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Credential instants", slug: randomUUID() },
    })
    const url = `${baseURL}/api/v1/organizations/${org.id}/access-credentials`
    const headers = {
      cookie: owner.cookie,
      origin,
      "content-type": "application/json",
    }
    const issued = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Native deadline",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        permissions: { project: ["read"] },
      }),
    })
    expect(issued.status).toBe(201)
    const credential = await issued.json()
    const listed = await fetch(url, { headers })
    const metadata = (await listed.json()).items.find(
      (item) => item.id === credential.id
    )
    expect(metadata.expiresAt).toBe(credential.expiresAt)
    expect(metadata.createdAt).toBe(credential.createdAt)
  })

  it("intersects the current member role and stops calls after the member is removed", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const admin = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Current member permissions", slug: randomUUID() },
    })
    const membership = await runtime.auth.api.addMember({
      headers: owner.headers,
      body: { organizationId: org.id, userId: admin.user.id, role: "admin" },
    })
    const issued = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/access-credentials`,
      {
        method: "POST",
        headers: {
          cookie: admin.cookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Current membership",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          permissions: { project: ["create", "read"] },
        }),
      }
    )
    expect(issued.status).toBe(201)
    const credential = await issued.json()
    const versionHeaders = async () => {
      const access = await fetch(
        `${baseURL}/api/v1/organizations/${org.id}/access`,
        { headers: { cookie: owner.cookie } }
      )
      const headers = new Headers(owner.headers)
      headers.set(
        "X-Expected-Authz-Version",
        String((await access.json()).authorizationVersion)
      )
      return headers
    }
    await runtime.auth.api.updateMemberRole({
      headers: await versionHeaders(),
      body: { organizationId: org.id, memberId: membership.id, role: "member" },
    })
    const url = `${baseURL}/api/v1/organizations/${org.id}/projects`
    const headers = {
      "x-api-key": credential.key,
      "content-type": "application/json",
    }
    expect((await fetch(url, { headers })).status).toBe(200)
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: "Revoked role write",
            description: null,
          }),
        })
      ).status
    ).toBe(403)
    await runtime.auth.api.removeMember({
      headers: await versionHeaders(),
      body: { organizationId: org.id, memberIdOrEmail: membership.id },
    })
    expect((await fetch(url, { headers })).status).toBe(403)
  })

  it("refuses credential calls while the bound organization is suspended", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Suspended credential", slug: randomUUID() },
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
          name: "Organization lifecycle",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          permissions: { project: ["read"] },
        }),
      }
    )
    expect(issued.status).toBe(201)
    const credential = await issued.json()
    await migrator.query(
      "UPDATE organization_status SET status='SUSPENDED',status_version=status_version+1,status_changed_at=clock_timestamp() WHERE organization_id=$1",
      [org.id]
    )
    const denied = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/projects`,
      { headers: { "x-api-key": credential.key } }
    )
    expect(denied.status).toBe(403)
    expect((await denied.json()).code).toBe("ORGANIZATION_SUSPENDED")
  })

  it("keeps credential management and personal account APIs behind their Cookie identity", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Cookie control plane", slug: randomUUID() },
    })
    const url = `${baseURL}/api/v1/organizations/${org.id}/access-credentials`
    const issued = await fetch(url, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "No personal identity",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        permissions: { project: ["read"], integration: ["read", "manage"] },
      }),
    })
    expect(issued.status).toBe(201)
    const credential = await issued.json()
    const keyHeaders = {
      "x-api-key": credential.key,
      origin,
      "content-type": "application/json",
    }
    expect((await fetch(url, { headers: keyHeaders })).status).toBe(401)
    expect(
      (await fetch(`${baseURL}/api/v1/me/preferences`, { headers: keyHeaders }))
        .status
    ).toBe(401)
    expect(
      (await fetch(`${baseURL}/api/v1/me/platform`, { headers: keyHeaders }))
        .status
    ).toBe(401)
    const bypass = await fetch(`${baseURL}/api/auth/api-key/create`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Unbound" }),
    })
    expect(bypass.status).toBe(404)
  })

  it("does not allow an issued one-time secret response to be cached", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Secret response", slug: randomUUID() },
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
          name: "One-time secret",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          permissions: { project: ["read"] },
        }),
      }
    )
    expect(issued.status).toBe(201)
    expect(
      issued.headers
        .get("cache-control")
        .split(",")
        .map((directive) => directive.trim())
    ).toContain("no-store")
  })

  it("records credential issuance and revocation as credential audit facts without a secret", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Credential audit", slug: randomUUID() },
    })
    const url = `${baseURL}/api/v1/organizations/${org.id}/access-credentials`
    const headers = {
      cookie: owner.cookie,
      origin,
      "content-type": "application/json",
    }
    const issued = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Audited key",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        permissions: { project: ["read"] },
      }),
    })
    expect(issued.status).toBe(201)
    const credential = await issued.json()
    expect(
      (await fetch(`${url}/${credential.id}`, { method: "DELETE", headers }))
        .status
    ).toBe(204)
    expect(
      (await fetch(`${url}/${credential.id}`, { method: "DELETE", headers }))
        .status
    ).toBe(204)
    const audit = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/audit-events?resourceType=access_credential&resourceId=${credential.id}`,
      { headers }
    )
    expect(audit.status).toBe(200)
    const events = (await audit.json()).items
    expect(events.map((event) => event.eventCode).sort()).toEqual([
      "access_credential.created",
      "access_credential.revoked",
    ])
    expect(
      events.every(
        (event) =>
          event.resourceType === "access_credential" &&
          event.actorId === owner.user.id
      )
    ).toBe(true)
    expect(JSON.stringify(events).includes(credential.key)).toBe(false)
  })
  it("enumerates the user's organization credentials through a bounded server page", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Credential pages", slug: randomUUID() },
    })
    const url = `${baseURL}/api/v1/organizations/${org.id}/access-credentials`
    const headers = {
      cookie: owner.cookie,
      origin,
      "content-type": "application/json",
    }
    for (let index = 0; index < 3; index++) {
      const issued = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: `Credential ${index}`,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          permissions: { project: ["read"] },
        }),
      })
      expect(issued.status).toBe(201)
    }
    const listed = await fetch(`${url}?page=2&pageSize=2`, { headers })
    expect(listed.status).toBe(200)
    const body = await listed.json()
    expect(body.items).toHaveLength(1)
    expect({
      total: body.total,
      page: body.page,
      pageSize: body.pageSize,
    }).toEqual({ total: 3, page: 2, pageSize: 2 })
  })
})
