import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { OrganizationRoleAccessSchema } from "../../packages/contracts/src/index.ts"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { startTestApplication } from "../setup/test-runtime.mjs"

const fileActions = ["read", "upload", "update", "delete", "restore", "purge"]
const folderActions = ["read", "create", "update", "delete"]
const filePermissions = [
  ...fileActions.map((action) => ({ resource: "file", action })),
  ...folderActions.map((action) => ({ resource: "folder", action })),
]
const filePermissionKeys = filePermissions.map(
  ({ resource, action }) => `${resource}:${action}`
)

describe("organization role permission projection", () => {
  let environment,
    owner,
    organization,
    member,
    orgAdmin,
    editor,
    membership,
    role
  const origin = "http://localhost:3200"
  const read = (actor = owner, id = organization.id) =>
    fetch(`${environment.baseURL}/api/v1/organizations/${id}/role-access`, {
      headers: { cookie: actor.cookie, origin },
    })
  const versionHeaders = async (actor = owner) => {
    const headers = new Headers(actor.headers)
    const state = await environment.migrator.query(
      "SELECT authorization_version FROM organization_status WHERE organization_id = $1",
      [organization.id]
    )
    headers.set(
      "X-Expected-Authz-Version",
      String(state.rows[0].authorization_version)
    )
    return headers
  }
  const authRequest = async (actor, path, body, versioned = false) => {
    const headers = versioned
      ? await versionHeaders(actor)
      : new Headers(actor.headers)
    headers.set("content-type", "application/json")
    return fetch(`${environment.baseURL}/api/auth/organization/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ organizationId: organization.id, ...body }),
    })
  }
  const checkFilePermissions = async (actor, allowedPermissions) => {
    for (const { resource, action } of filePermissions) {
      const response = await authRequest(actor, "has-permission", {
        permissions: { [resource]: [action] },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        success: allowedPermissions.includes(`${resource}:${action}`),
      })
    }
  }
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    const account = (name) =>
      signUpVerified(environment.baseURL, origin, environment.migrator, {
        name,
      })
    owner = await account("角色投影所有者")
    member = await account("普通成员")
    orgAdmin = await account("组织管理员")
    editor = await account("受控项目编辑者")
    organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "权限投影组织", slug: randomUUID() },
    })
    const createdRole = await environment.runtime.auth.api.createOrgRole({
      headers: owner.headers,
      body: {
        organizationId: organization.id,
        role: "projection-editor",
        permission: { project: ["read", "update"] },
      },
    })
    role = createdRole.roleData
    await environment.runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: organization.id,
        userId: member.user.id,
        role: "member",
      },
    })
    await environment.runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: organization.id,
        userId: orgAdmin.user.id,
        role: "admin",
      },
    })
    membership = await environment.runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: organization.id,
        userId: editor.user.id,
        role: "projection-editor",
      },
    })
  })
  afterAll(() => environment?.close())

  it("returns the fixed native permission decisions without granting role writes to ordinary or custom members", async () => {
    const response = await read()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    const access = OrganizationRoleAccessSchema.parse(await response.json())
    expect(access).toMatchObject({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
    })
    expect(access.grantablePermissions).toHaveLength(23)
    expect(access.grantablePermissions).toEqual(
      expect.arrayContaining(filePermissions)
    )
    const adminResponse = await read(orgAdmin)
    expect(adminResponse.status).toBe(200)
    expect(
      OrganizationRoleAccessSchema.parse(await adminResponse.json())
    ).toEqual(access)
    const memberResponse = await read(member)
    expect(memberResponse.status).toBe(200)
    expect(
      OrganizationRoleAccessSchema.parse(await memberResponse.json())
    ).toEqual({
      canRead: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      grantablePermissions: [
        { resource: "project", action: "read" },
        { resource: "file", action: "read" },
        { resource: "folder", action: "read" },
        { resource: "member", action: "read" },
      ],
    })
    const editorResponse = await read(editor)
    expect(editorResponse.status).toBe(200)
    expect(
      OrganizationRoleAccessSchema.parse(await editorResponse.json())
    ).toEqual({
      canRead: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      grantablePermissions: [
        { resource: "project", action: "read" },
        { resource: "project", action: "update" },
      ],
    })
  })

  it("authorizes every file and folder action for owner and admin, only reads for member, and no implicit custom grants", async () => {
    await checkFilePermissions(owner, filePermissionKeys)
    await checkFilePermissions(orgAdmin, filePermissionKeys)
    await checkFilePermissions(member, ["file:read", "folder:read"])
    await checkFilePermissions(editor, [])
  })

  it("accepts explicit file and folder delegation and revokes it for the existing custom member cookie", async () => {
    const granted = await authRequest(
      owner,
      "update-role",
      {
        roleId: role.id,
        data: {
          permission: {
            project: ["read", "update"],
            file: fileActions,
            folder: folderActions,
          },
        },
      },
      true
    )
    expect(granted.status).toBe(200)
    expect((await granted.json()).roleData.permission).toEqual({
      project: ["read", "update"],
      file: fileActions,
      folder: folderActions,
    })
    await checkFilePermissions(editor, filePermissionKeys)
    const projection = await read(editor)
    expect(projection.status).toBe(200)
    expect(OrganizationRoleAccessSchema.parse(await projection.json())).toEqual(
      {
        canRead: false,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
        grantablePermissions: [
          { resource: "project", action: "read" },
          { resource: "project", action: "update" },
          ...filePermissions,
        ],
      }
    )
    const revoked = await authRequest(
      owner,
      "update-role",
      {
        roleId: role.id,
        data: { permission: { project: ["read", "update"] } },
      },
      true
    )
    expect(revoked.status).toBe(200)
    await checkFilePermissions(editor, [])
    const afterRevocation = await read(editor)
    expect(afterRevocation.status).toBe(200)
    expect(
      OrganizationRoleAccessSchema.parse(await afterRevocation.json())
        .grantablePermissions
    ).toEqual([
      { resource: "project", action: "read" },
      { resource: "project", action: "update" },
    ])
  })

  it("rejects anonymous and other-organization reads before returning permission facts", async () => {
    const anonymous = await fetch(
      `${environment.baseURL}/api/v1/organizations/${organization.id}/role-access`
    )
    expect(anonymous.status).toBe(401)
    const otherOwner = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const other = await environment.runtime.auth.api.createOrganization({
      headers: otherOwner.headers,
      body: { name: "独立组织", slug: randomUUID() },
    })
    const rejected = await read(owner, other.id)
    expect(rejected.status).toBe(403)
    expect(await rejected.json()).toMatchObject({ code: "FORBIDDEN" })
  })

  it("rechecks changed dynamic permissions and removed membership for the same existing cookie", async () => {
    await environment.runtime.auth.api.updateOrgRole({
      headers: await versionHeaders(),
      body: {
        organizationId: organization.id,
        roleId: role.id,
        data: { permission: { project: ["read"] } },
      },
    })
    const response = await read(editor)
    expect(response.status).toBe(200)
    expect(
      OrganizationRoleAccessSchema.parse(await response.json())
        .grantablePermissions
    ).toEqual([{ resource: "project", action: "read" }])
    await environment.runtime.auth.api.removeMember({
      headers: await versionHeaders(),
      body: { organizationId: organization.id, memberIdOrEmail: membership.id },
    })
    const removed = await read(editor)
    expect(removed.status).toBe(403)
    expect(await removed.json()).toMatchObject({ code: "FORBIDDEN" })
  })

  it("rejects a suspended organization through the same state boundary", async () => {
    const admin = await platformOperator(environment, origin)
    const suspended = await fetch(
      `${environment.baseURL}/api/v1/platform/organizations/${organization.id}/suspend`,
      {
        method: "POST",
        headers: {
          cookie: admin.cookie,
          origin,
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          expectedVersion: 1,
          reason: "Role access must obey organization suspension",
        }),
      }
    )
    expect(suspended.status).toBe(200)
    const response = await read()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: "ORGANIZATION_SUSPENDED",
    })
  })
})
