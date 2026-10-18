import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  OrganizationRoleDirectoryPageSchema,
  OrganizationInvitationDirectoryPageSchema,
} from "../../packages/contracts/src/index.ts"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("organization management directories", () => {
  let environment, owner, member, outsider, custom, organization
  const origin = "http://localhost:3200"
  const read = (
    kind,
    query = {},
    actor = owner,
    organizationId = organization.id
  ) =>
    fetch(
      `${environment.baseURL}/api/v1/organizations/${organizationId}/${kind}-directory?${new URLSearchParams(query)}`,
      { headers: actor.headers }
    )
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    owner = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    member = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    outsider = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    custom = await signUpVerified(environment.baseURL, origin, environment.migrator)
    organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Directory org", slug: randomUUID() },
    })
    await environment.runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: organization.id,
        userId: member.user.id,
        role: "member",
      },
    })
    for (const role of ["directory-z", "directory-a", "directory-m"])
      await environment.runtime.auth.api.createOrgRole({
        headers: owner.headers,
        body: {
          organizationId: organization.id,
          role,
          permission: { project: ["read"] },
        },
      })
    await environment.runtime.auth.api.addMember({ headers: owner.headers, body: { organizationId: organization.id, userId: custom.user.id, role: "directory-a" } })
    for (const [index, email] of [
      "directory-a@example.test",
      "directory-z@example.test",
      "directory-m@example.test",
    ].entries()) {
      await environment.runtime.auth.api.createInvitation({
        headers: owner.headers,
        body: { organizationId: organization.id, email, role: "directory-a" },
      })
      if (index === 1)
        await environment.migrator.query(
          "UPDATE invitation SET expires_at=clock_timestamp()-interval '1 minute' WHERE organization_id=$1 AND email=$2",
          [organization.id, email]
        )
      if (index === 2)
        await environment.migrator.query(
          "UPDATE invitation SET status='canceled' WHERE organization_id=$1 AND email=$2",
          [organization.id, email]
        )
    }
  })
  afterAll(() => environment?.close())

  it("paginates a single native role projection with stable totals, kind filters and references", async () => {
    const response = await read("roles", {
      pageSize: "2",
      page: "2",
      sortBy: "role",
      sortOrder: "asc",
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    const page = OrganizationRoleDirectoryPageSchema.parse(
      await response.json()
    )
    expect(page.total).toBe(6)
    expect(page.items.map((row) => row.role)).toEqual([
      "directory-m",
      "directory-z",
    ])
    const custom = OrganizationRoleDirectoryPageSchema.parse(
      await (await read("roles", { kind: "custom", q: "directory-a" })).json()
    )
    expect(custom.total).toBe(1)
    expect(custom.items[0]).toMatchObject({
      role: "directory-a",
      builtIn: false,
      memberCount: 1,
      invitationCount: 1,
    })
    expect(custom.items[0].authorizationVersion).toBeGreaterThan(0)
    const builtin = OrganizationRoleDirectoryPageSchema.parse(
      await (await read("roles", { kind: "built-in", q: "owner" })).json()
    )
    expect(builtin.items[0]).toMatchObject({
      id: "builtin:owner",
      role: "owner",
      builtIn: true,
      memberCount: 1,
    })
    expect(builtin.items[0].permission.project).toContain("read")
    const beyond = OrganizationRoleDirectoryPageSchema.parse(
      await (await read("roles", { page: "100" })).json()
    )
    expect(beyond.total).toBe(6)
    expect(beyond.items).toEqual([])
  })

  it("filters effective invitation state, keeps delivery metadata, and escapes wildcard search", async () => {
    const response = await read("invitations", {
      status: "expired",
      pageSize: "1",
    })
    expect(response.status).toBe(200)
    const page = OrganizationInvitationDirectoryPageSchema.parse(
      await response.json()
    )
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({
      email: "directory-z@example.test",
      businessStatus: "expired",
      status: "pending",
    })
    expect(page.items[0].delivery.attemptId).toBeTruthy()
    const pending = OrganizationInvitationDirectoryPageSchema.parse(
      await (await read("invitations", { status: "pending" })).json()
    )
    expect(pending.items.map((row) => row.email)).toEqual([
      "directory-a@example.test",
    ])
    const wildcard = OrganizationInvitationDirectoryPageSchema.parse(
      await (await read("invitations", { q: "%" })).json()
    )
    expect(wildcard.total).toBe(0)
    const beyond = OrganizationInvitationDirectoryPageSchema.parse(
      await (await read("invitations", { page: "100" })).json()
    )
    expect(beyond.total).toBe(3)
    expect(beyond.items).toEqual([])
  })

  it("does not turn member directory read into role or invitation management access", async () => {
    // member 的原生角色包含 ac:read，但不包含邀请管理；自定义角色不继承该授权。
    expect((await read("roles", {}, member)).status).toBe(200)
    expect((await read("invitations", {}, member)).status).toBe(403)
    for (const kind of ["roles", "invitations"]) {
      expect((await read(kind, {}, custom)).status).toBe(403)
      expect((await read(kind, {}, outsider)).status).toBe(403)
      expect((await read(kind, {}, owner, randomUUID())).status).toBe(403)
    }
    expect((await read("roles", { sortBy: "permission" })).status).toBe(400)
    expect((await read("invitations", { pageSize: "101" })).status).toBe(400)
  })
})
