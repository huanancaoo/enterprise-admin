import { randomUUID } from "node:crypto"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

describe("S8-09: personal and organization locale settings over HTTP", () => {
  let environment
  let runtime, baseURL, migrator, owner, organization
  const origin = "http://localhost:3200"
  const request = (path, actor, body) =>
    fetch(`${baseURL}/api/v1/${path}`, {
      method: body === undefined ? "GET" : "PATCH",
      headers: {
        cookie: actor.cookie,
        origin,
        "accept-language": "en-US",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    ;({ runtime, migrator, baseURL } = environment)
    owner = await signUpVerified(baseURL, origin, migrator, {
      name: "Locale owner",
    })
    organization = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Locale settings", slug: randomUUID() },
    })
  })

  afterAll(async () => {
    await environment?.close()
  })

  it("version-checks personal and organization changes, audits org updates, and denies members", async () => {
    const personal = await request("me/preferences", owner)
    expect(personal.status).toBe(200)
    expect(await personal.json()).toMatchObject({
      preferredLocale: null,
      version: 1,
    })

    const updatedPersonal = await request("me/preferences", owner, {
      preferredLocale: "ar",
      expectedVersion: 1,
    })
    expect(updatedPersonal.status).toBe(200)
    expect(await updatedPersonal.json()).toMatchObject({
      preferredLocale: "ar",
      version: 2,
    })
    const userInheritedAccess = await request(
      `organizations/${organization.id}/access`,
      owner
    )
    expect(userInheritedAccess.headers.get("content-language")).toBe("en-US")
    expect(await userInheritedAccess.json()).toMatchObject({
      effectiveLocale: "ar",
      effectiveLocaleSource: "user",
    })
    const stalePersonal = await request("me/preferences", owner, {
      preferredLocale: "en-US",
      expectedVersion: 1,
    })
    expect(stalePersonal.status).toBe(409)
    expect(await stalePersonal.json()).toMatchObject({
      code: "VERSION_CONFLICT",
    })
    const invalidPersonal = await request("me/preferences", owner, {
      preferredLocale: "fr",
      expectedVersion: 2,
    })
    expect(invalidPersonal.status).toBe(400)

    const settingsPath = `organizations/${organization.id}/settings`
    const settings = await request(settingsPath, owner)
    expect(settings.status).toBe(200)
    expect(await settings.json()).toMatchObject({
      organizationId: organization.id,
      defaultLocale: null,
      version: 1,
    })
    await expect(
      runtime.auth.api.hasPermission({
        headers: owner.headers,
        body: {
          organizationId: organization.id,
          permissions: { tenantSettings: ["read"] },
        },
      })
    ).resolves.toMatchObject({ success: true })

    const updatedSettings = await request(settingsPath, owner, {
      defaultLocale: "ar",
      expectedVersion: 1,
    })
    expect(updatedSettings.status).toBe(200)
    const updatedBody = await updatedSettings.json()
    expect(updatedBody).toMatchObject({ defaultLocale: "ar", version: 2 })
    const clearedPersonal = await request("me/preferences", owner, {
      preferredLocale: null,
      expectedVersion: 2,
    })
    expect(clearedPersonal.status).toBe(200)
    expect(await clearedPersonal.json()).toMatchObject({
      preferredLocale: null,
      version: 3,
    })
    const organizationInheritedAccess = await request(
      `organizations/${organization.id}/access`,
      owner
    )
    expect(organizationInheritedAccess.headers.get("content-language")).toBe(
      "en-US"
    )
    expect(await organizationInheritedAccess.json()).toMatchObject({
      effectiveLocale: "ar",
      effectiveLocaleSource: "organization",
    })
    const auditReader = await migrator.connect()
    try {
      await auditReader.query("BEGIN")
      await auditReader.query(
        "SELECT set_config('app.organization_id', $1, true)",
        [organization.id]
      )
      const audit = await auditReader.query(
        `SELECT event_code, actor_id, request_id, fields
         FROM audit_events
         WHERE organization_id = $1 AND resource_id = $1
           AND event_code = 'organization.settings_updated'`,
        [organization.id]
      )
      expect(audit.rows).toHaveLength(1)
      expect(audit.rows[0]).toMatchObject({
        event_code: "organization.settings_updated",
        actor_id: owner.user.id,
        request_id: updatedSettings.headers.get("x-request-id"),
        fields: { previousDefaultLocale: null, defaultLocale: "ar" },
      })
    } finally {
      await auditReader.query("ROLLBACK")
      auditReader.release()
    }

    const staleSettings = await request(settingsPath, owner, {
      defaultLocale: "en-US",
      expectedVersion: 1,
    })
    expect(staleSettings.status).toBe(409)
    expect(await staleSettings.json()).toMatchObject({
      code: "VERSION_CONFLICT",
    })

    const member = await signUpVerified(baseURL, origin, migrator, {
      name: "Locale member",
    })
    await migrator.query(
      `INSERT INTO member (id, organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, 'member', now())`,
      [randomUUID(), organization.id, member.user.id]
    )
    expect((await request(settingsPath, member)).status).toBe(403)
    const memberAccess = await request(
      `organizations/${organization.id}/access`,
      member
    )
    expect(memberAccess.status).toBe(200)
    expect(await memberAccess.json()).toMatchObject({
      effectiveLocale: "ar",
      effectiveLocaleSource: "organization",
    })

    await migrator.query(
      `INSERT INTO organization_role (id, organization_id, role, permission)
       VALUES ($1, $2, 'locale_reader', $3)`,
      [
        randomUUID(),
        organization.id,
        JSON.stringify({ tenantSettings: ["read"] }),
      ]
    )
    await migrator.query(
      `UPDATE member SET role = 'locale_reader'
       WHERE organization_id = $1 AND user_id = $2`,
      [organization.id, member.user.id]
    )
    await expect(
      runtime.auth.api.hasPermission({
        headers: member.headers,
        body: {
          organizationId: organization.id,
          permissions: { tenantSettings: ["read"] },
        },
      })
    ).resolves.toMatchObject({ success: true })
    await expect(
      runtime.auth.api.hasPermission({
        headers: member.headers,
        body: {
          organizationId: organization.id,
          permissions: { tenantSettings: ["update"] },
        },
      })
    ).resolves.toMatchObject({ success: false })
    expect((await request(settingsPath, member)).status).toBe(200)
    expect(
      (
        await request(settingsPath, member, {
          defaultLocale: "en-US",
          expectedVersion: 2,
        })
      ).status
    ).toBe(403)
  })
})
