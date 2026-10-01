import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startTestApplication } from "../setup/test-runtime.mjs"

describe("S8 acceptance: native organization authorization", () => {
  let environment
  const origin = "http://localhost:3200"
  const account = () =>
    signUpVerified(environment.baseURL, origin, environment.migrator)
  const organization = (owner) =>
    environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "S8 authorization acceptance", slug: randomUUID() },
    })
  const request = async (actor, path, body, organizationId) => {
    const headers = new Headers(actor.headers)
    if (body !== undefined) headers.set("content-type", "application/json")
    if (organizationId) {
      const state = await environment.migrator.query(
        "SELECT authorization_version FROM organization_status WHERE organization_id = $1",
        [organizationId]
      )
      headers.set(
        "X-Expected-Authz-Version",
        String(state.rows[0].authorization_version)
      )
    }
    return fetch(`${environment.baseURL}/api/auth/organization/${path}`, {
      headers,
      ...(body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body) }),
    })
  }
  const createRole = async (owner, org, permission, role = "scoped-reader") =>
    (
      await environment.runtime.auth.api.createOrgRole({
        headers: owner.headers,
        body: { organizationId: org.id, role, permission },
      })
    ).roleData
  const addMember = (owner, org, member, role = "member") =>
    environment.runtime.auth.api.addMember({
      headers: owner.headers,
      body: { organizationId: org.id, userId: member.user.id, role },
    })
  const invite = async (owner, org, recipient) => {
    const response = await request(owner, "invite-member", {
      organizationId: org.id,
      email: recipient.email,
      role: "member",
    })
    expect(response.status).toBe(200)
    return response.json()
  }
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
  })
  afterAll(() => environment?.close())

  it("T01: rejects foreign organization and resource IDs without revealing whether the foreign resource exists", async () => {
    const ownerA = await account(),
      ownerB = await account()
    const memberB = await account(),
      recipient = await account()
    const a = await organization(ownerA),
      b = await organization(ownerB)
    const membershipB = await addMember(ownerB, b, memberB)
    const roleB = await createRole(ownerB, b, { project: ["read"] })
    const invitationB = await invite(ownerB, b, recipient)

    for (const path of [
      "get-organization",
      "get-full-organization",
      "list-members",
      "list-roles",
      "list-invitations",
    ]) {
      const existing = await request(ownerA, `${path}?organizationId=${b.id}`)
      const missing = await request(
        ownerA,
        `${path}?organizationId=${randomUUID()}`
      )
      expect(existing.status, path).toBe(403)
      expect(missing.status, path).toBe(403)
      expect(await existing.json(), path).toEqual(await missing.json())
    }
    for (const [path, body] of [
      ["update", { data: { name: "Forbidden foreign organization update" } }],
      ["invite-member", { email: recipient.email, role: "member" }],
      [
        "create-role",
        { role: "foreign-reader", permission: { project: ["read"] } },
      ],
      ["has-permission", { permissions: { project: ["read"] } }],
    ]) {
      const existing = await request(ownerA, path, {
        organizationId: b.id,
        ...body,
      })
      const missing = await request(ownerA, path, {
        organizationId: randomUUID(),
        ...body,
      })
      expect(existing.status, path).toBe(403)
      expect(missing.status, path).toBe(403)
      expect(await existing.json(), path).toEqual(await missing.json())
    }
    for (const path of [
      "get-organization",
      "get-full-organization",
      "list-members",
      "get-active-member-role",
    ]) {
      const existing = await request(
        ownerA,
        `${path}?organizationSlug=${b.slug}`
      )
      const missing = await request(
        ownerA,
        `${path}?organizationSlug=${randomUUID()}`
      )
      expect(existing.status, path).toBe(403)
      expect(missing.status, path).toBe(403)
      expect(await existing.json(), path).toEqual(await missing.json())
    }
    for (const [path, makeBody] of [
      [
        "update-member-role",
        (id) => ({ organizationId: a.id, memberId: id, role: "member" }),
      ],
      [
        "remove-member",
        (id) => ({ organizationId: a.id, memberIdOrEmail: id }),
      ],
      [
        "update-role",
        (id) => ({
          organizationId: a.id,
          roleId: id,
          data: { permission: { project: ["read", "update"] } },
        }),
      ],
      ["delete-role", (id) => ({ organizationId: a.id, roleId: id })],
    ]) {
      const id = path.includes("member") ? membershipB.id : roleB.id
      const existing = await request(ownerA, path, makeBody(id), a.id)
      const missing = await request(ownerA, path, makeBody(randomUUID()), a.id)
      expect(existing.ok, path).toBe(false)
      expect(existing.status, path).toBe(missing.status)
      expect(await existing.json(), path).toEqual(await missing.json())
    }
    for (const path of [
      "get-invitation",
      "cancel-invitation",
      "accept-invitation",
    ]) {
      const invoke = (id) =>
        path === "get-invitation"
          ? request(ownerA, `${path}?id=${id}`)
          : request(ownerA, path, { invitationId: id })
      const existing = await invoke(invitationB.id),
        missing = await invoke(randomUUID())
      expect(existing.status, path).toBe(403)
      expect(missing.status, path).toBe(403)
      expect(await existing.json(), path).toEqual(await missing.json())
    }
    const roleRead = await request(
      ownerA,
      `get-role?organizationId=${a.id}&roleId=${roleB.id}`
    )
    const missingRole = await request(
      ownerA,
      `get-role?organizationId=${a.id}&roleId=${randomUUID()}`
    )
    expect(roleRead.ok).toBe(false)
    expect(roleRead.status).toBe(missingRole.status)
    expect(await roleRead.json()).toEqual(await missingRole.json())
    expect(
      (
        await environment.migrator.query(
          "SELECT role FROM member WHERE id=$1",
          [membershipB.id]
        )
      ).rows
    ).toEqual([{ role: "member" }])
    expect(
      (
        await environment.migrator.query(
          "SELECT status FROM invitation WHERE id=$1",
          [invitationB.id]
        )
      ).rows
    ).toEqual([{ status: "pending" }])
    const persistedRole = await request(
      ownerB,
      `get-role?organizationId=${b.id}&roleId=${roleB.id}`
    )
    expect(persistedRole.status).toBe(200)
    expect(await persistedRole.json()).toMatchObject({
      permission: { project: ["read"] },
    })
  })

  it("T02: identical role keys retain independent permissions and membership assignments in A and B", async () => {
    const owner = await account(),
      member = await account()
    const a = await organization(owner),
      b = await organization(owner)
    await createRole(owner, a, { project: ["read"] })
    await createRole(owner, b, { project: ["update"] })
    await addMember(owner, a, member, "scoped-reader")
    await addMember(owner, b, member, "scoped-reader")
    for (const [org, action, success] of [
      [a, "read", true],
      [a, "update", false],
      [b, "read", false],
      [b, "update", true],
    ]) {
      const response = await request(member, "has-permission", {
        organizationId: org.id,
        permissions: { project: [action] },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ success })
    }
    const rows = await environment.migrator.query(
      "SELECT organization_id, role FROM member WHERE user_id=$1 ORDER BY organization_id",
      [member.user.id]
    )
    expect(rows.rows).toEqual(
      [a, b]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((org) => ({ organization_id: org.id, role: "scoped-reader" }))
    )
  })

  it("T03/T04: ordinary members cannot invite, and an existing session cannot accept after its email becomes unverified or mismatches the invitation", async () => {
    const owner = await account(),
      member = await account(),
      recipient = await account(),
      other = await account()
    const org = await organization(owner)
    await addMember(owner, org, member)
    const denied = await request(member, "invite-member", {
      organizationId: org.id,
      email: recipient.email,
      role: "member",
    })
    expect(denied.status).toBe(403)
    const invitation = await invite(owner, org, recipient)
    const wrongEmail = await request(other, "accept-invitation", {
      invitationId: invitation.id,
    })
    expect(wrongEmail.status).toBe(403)
    // 保留已签发 Cookie，仅改变权威验证事实，证明接受入口重新读取邮箱资格。
    await environment.migrator.query(
      'UPDATE public."user" SET email_verified=false WHERE id=$1',
      [recipient.user.id]
    )
    const unverified = await request(recipient, "accept-invitation", {
      invitationId: invitation.id,
    })
    expect(unverified.status).toBe(403)
    expect(
      (
        await environment.migrator.query(
          "SELECT user_id FROM member WHERE organization_id=$1 AND user_id IN ($2,$3)",
          [org.id, recipient.user.id, other.user.id]
        )
      ).rows
    ).toEqual([])
    expect(
      (
        await environment.migrator.query(
          "SELECT status FROM invitation WHERE id=$1",
          [invitation.id]
        )
      ).rows
    ).toEqual([{ status: "pending" }])
  })

  it("T15: suspension blocks the installed native management and protected read catalog while keeping global and recipient exceptions usable", async () => {
    const owner = await account(),
      member = await account(),
      recipient = await account()
    const org = await organization(owner)
    const membership = await addMember(owner, org, member)
    const role = await createRole(owner, org, { project: ["read"] })
    const invitation = await invite(owner, org, recipient)
    await environment.runtime.auth.api.setActiveOrganization({
      headers: owner.headers,
      body: { organizationId: org.id },
    })
    // 这里只布置停用前提；正式平台停用及其提交顺序由 platform-organizations 套件验证。
    await environment.migrator.query(
      "UPDATE organization_status SET status='SUSPENDED' WHERE organization_id=$1",
      [org.id]
    )
    for (const path of [
      `get-organization?organizationId=${org.id}`,
      `get-full-organization?organizationId=${org.id}`,
      `list-members?organizationId=${org.id}`,
      `get-active-member-role?organizationId=${org.id}`,
      "get-active-member",
      `list-invitations?organizationId=${org.id}`,
      `list-roles?organizationId=${org.id}`,
      `get-role?organizationId=${org.id}&roleId=${role.id}`,
    ]) {
      const response = await request(owner, path)
      expect(response.status, path).toBe(403)
      expect(await response.json(), path).toMatchObject({
        code: "ORGANIZATION_SUSPENDED",
      })
    }
    for (const [path, body, actor = owner] of [
      [
        "update",
        { organizationId: org.id, data: { name: "Forbidden rename" } },
      ],
      ["delete", { organizationId: org.id }],
      ["leave", { organizationId: org.id }, member],
      ["set-active", { organizationId: org.id }],
      [
        "invite-member",
        {
          organizationId: org.id,
          email: `${randomUUID()}@example.test`,
          role: "member",
        },
      ],
      [
        "remove-member",
        { organizationId: org.id, memberIdOrEmail: membership.id },
      ],
      [
        "update-member-role",
        {
          organizationId: org.id,
          memberId: membership.id,
          role: "scoped-reader",
        },
      ],
      [
        "create-role",
        {
          organizationId: org.id,
          role: "blocked-role",
          permission: { project: ["read"] },
        },
      ],
      [
        "update-role",
        {
          organizationId: org.id,
          roleId: role.id,
          data: { permission: { project: ["read", "update"] } },
        },
      ],
      ["delete-role", { organizationId: org.id, roleId: role.id }],
      [
        "has-permission",
        { organizationId: org.id, permissions: { project: ["read"] } },
      ],
      ["cancel-invitation", { invitationId: invitation.id }],
      ["accept-invitation", { invitationId: invitation.id }, recipient],
    ]) {
      const response = await request(actor, path, body, org.id)
      expect(response.status, path).toBe(403)
      expect(await response.json(), path).toMatchObject({
        code: "ORGANIZATION_SUSPENDED",
      })
    }
    expect((await request(owner, "list")).status).toBe(200)
    expect(
      (await request(recipient, `get-invitation?id=${invitation.id}`)).status
    ).toBe(200)
    expect(
      (
        await request(recipient, "reject-invitation", {
          invitationId: invitation.id,
        })
      ).status
    ).toBe(200)
    expect(
      (await request(owner, "set-active", { organizationId: null })).status
    ).toBe(200)
    expect(
      (
        await request(owner, "create", {
          name: "New global organization",
          slug: randomUUID(),
        })
      ).status
    ).toBe(200)
    expect(
      (
        await environment.migrator.query(
          "SELECT name FROM organization WHERE id=$1",
          [org.id]
        )
      ).rows
    ).toEqual([{ name: org.name }])
    expect(
      (
        await environment.migrator.query(
          "SELECT role FROM member WHERE id=$1",
          [membership.id]
        )
      ).rows
    ).toEqual([{ role: "member" }])
  })

  it("T15: empty identifiers cannot bypass suspension when native endpoints resolve them to the active organization", async () => {
    const owner = await account()
    const org = await organization(owner)
    await environment.runtime.auth.api.setActiveOrganization({
      headers: owner.headers,
      body: { organizationId: org.id },
    })
    await environment.migrator.query(
      "UPDATE organization_status SET status='SUSPENDED' WHERE organization_id=$1",
      [org.id]
    )
    for (const path of [
      "get-organization",
      "get-full-organization",
      "list-members",
      "get-active-member-role",
      "list-invitations",
    ]) {
      const response = await request(
        owner,
        `${path}?organizationId=&organizationSlug=`
      )
      expect(response.status, path).toBe(403)
      expect(await response.json(), path).toMatchObject({
        code: "ORGANIZATION_SUSPENDED",
      })
    }
    for (const [path, body] of [
      ["update", { data: { name: "Empty target bypass" } }],
      [
        "invite-member",
        { email: `${randomUUID()}@example.test`, role: "member" },
      ],
      ["remove-member", { memberIdOrEmail: randomUUID() }],
      ["update-member-role", { memberId: randomUUID(), role: "member" }],
      ["has-permission", { permissions: { project: ["read"] } }],
    ]) {
      const response = await request(
        owner,
        path,
        { organizationId: "", ...body },
        org.id
      )
      expect(response.status, path).toBe(403)
      expect(await response.json(), path).toMatchObject({
        code: "ORGANIZATION_SUSPENDED",
      })
    }
    const roleList = await request(owner, "list-roles?organizationId=")
    expect(roleList.status).toBe(400)
    const cleared = await request(owner, "set-active", {
      organizationId: null,
      organizationSlug: org.slug,
    })
    expect(cleared.status).toBe(200)
    expect(
      (
        await environment.migrator.query(
          "SELECT active_organization_id FROM session WHERE user_id=$1",
          [owner.user.id]
        )
      ).rows
    ).toEqual([{ active_organization_id: null }])
    expect(
      (
        await environment.migrator.query(
          "SELECT name FROM organization WHERE id=$1",
          [org.id]
        )
      ).rows
    ).toEqual([{ name: org.name }])
  })

  it("T17: editable identity fields and submitted platform role metadata do not create platform authority", async () => {
    const owner = await account()
    await organization(owner)
    const response = await fetch(
      `${environment.baseURL}/api/auth/update-user`,
      {
        method: "POST",
        headers: {
          cookie: owner.cookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "platform_admin",
          role: "platform_admin",
          metadata: { role: "platform_admin", platformAdmin: true },
        }),
      }
    )
    expect(response.status).toBe(200)
    expect(
      (
        await environment.migrator.query(
          'SELECT name FROM public."user" WHERE id=$1',
          [owner.user.id]
        )
      ).rows
    ).toEqual([{ name: "platform_admin" }])
    for (const path of [
      "me/platform",
      "platform/organizations",
      "platform/users",
      "platform/audit-events?purpose=Identity%20boundary%20verification",
      "platform/settings",
    ]) {
      const denied = await fetch(`${environment.baseURL}/api/v1/${path}`, {
        headers: { cookie: owner.cookie },
      })
      expect(denied.status, path).toBe(403)
    }
    expect(
      (
        await environment.migrator.query(
          "SELECT user_id FROM platform_assignment WHERE user_id=$1",
          [owner.user.id]
        )
      ).rows
    ).toEqual([])
  })

  it("T28: cookie-authenticated native writes reject missing or foreign Origin without changing the organization", async () => {
    const owner = await account(),
      org = await organization(owner)
    for (const requestOrigin of [undefined, "https://untrusted.example"]) {
      const headers = {
        cookie: owner.cookie,
        "content-type": "application/json",
        ...(requestOrigin === undefined ? {} : { origin: requestOrigin }),
      }
      const response = await fetch(
        `${environment.baseURL}/api/auth/organization/update`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            organizationId: org.id,
            data: { name: "Invalid origin" },
          }),
        }
      )
      expect(response.status).toBe(403)
    }
    expect(
      (
        await environment.migrator.query(
          "SELECT name FROM organization WHERE id=$1",
          [org.id]
        )
      ).rows
    ).toEqual([{ name: org.name }])
  })
})
