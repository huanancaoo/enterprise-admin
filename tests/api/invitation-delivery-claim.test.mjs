import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTaskTenantRunner } from "../../packages/database/dist/task-tenant.js"
import {
  createOrganizationInvitation,
  invitationTenantExecutor,
  nativeInvitationCreator,
} from "../../packages/database/dist/invitation-command.js"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
const require = createRequire(import.meta.url)
const { EmailService } = require("../../apps/api/dist/email/email.service.js")

describe("native invitation durable delivery claim", () => {
  const origin = "http://localhost:3200"
  const limits = { organization: 1000, actor: 1000, ip: 1000 }
  let environment
  beforeAll(async () => {
    environment = await startTestApplication({
      origins: [origin],
      invitationLimits: limits,
    })
  })
  afterAll(async () => environment?.close())
  async function fixture() {
    const owner = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Invitation claim", slug: randomUUID() },
    })
    return { owner, organization }
  }
  async function queued(f, email = `${randomUUID()}@example.test`) {
    const identity = {
      organizationId: f.organization.id,
      actorId: f.owner.user.id,
      resourceId: randomUUID(),
      requestId: randomUUID(),
      locale: "en-US",
    }
    return createTaskTenantRunner(environment.runtime.pool)(
      identity,
      { invitation: ["create"] },
      async (tx) => {
        const db = invitationTenantExecutor(tx)
        await db.query(
          "SELECT set_config('app.expected_authorization_version',authorization_version::text,true) FROM organization_status WHERE organization_id=$1",
          [f.organization.id]
        )
        const { invitation, delivery } = await createOrganizationInvitation(
          db,
          nativeInvitationCreator(tx),
          {
            organizationId: f.organization.id,
            actorId: f.owner.user.id,
            requestId: identity.requestId,
            email,
            role: "member",
            ipHash: "a".repeat(64),
            limits,
          }
        )
        return {
          ...invitation,
          ...delivery,
          organization: f.organization,
          invitation: { id: invitation.id },
          inviter: { user: { name: f.owner.user.name } },
        }
      }
    )
  }
  function service(send) {
    return new EmailService(
      environment.runtime.pool,
      environment.config.email,
      [origin],
      { send }
    )
  }
  async function state(id) {
    return (
      await environment.observer.query(
        "SELECT status,error_code FROM invitation_delivery_attempts WHERE id=$1",
        [id]
      )
    ).rows[0]
  }
  it("creates the same native seven-day invitation and emits one SMTP attempt across immediate/dispatcher competition", async () => {
    const f = await fixture()
    const delivery = await queued(f)
    expect(
      new Date(delivery.expiresAt) - new Date(delivery.createdAt)
    ).toBeCloseTo(7 * 86400000, -3)
    let sends = 0
    const runtime = service(async () => {
      sends++
      return { providerMessageId: "one" }
    })
    await Promise.all([
      runtime.sendInvitation(delivery),
      ...Array.from({ length: 7 }, () => runtime.dispatchInvitation()),
    ])
    expect(sends).toBe(1)
    expect(await state(delivery.attemptId)).toEqual({
      status: "smtp_accepted",
      error_code: null,
    })
    const metadata = await environment.observer.query(
      "SELECT actor_id,request_id FROM invitation_delivery_attempts WHERE id=$1",
      [delivery.attemptId]
    )
    expect(metadata.rows[0]).toEqual({
      actor_id: f.owner.user.id,
      request_id: delivery.requestId,
    })
  })
  it("does not send an invitation canceled before the durable claim", async () => {
    const f = await fixture()
    const delivery = await queued(f)
    await environment.runtime.auth.api.cancelInvitation({
      headers: f.owner.headers,
      body: { invitationId: delivery.id },
    })
    let sends = 0
    const runtime = service(async () => {
      sends++
      return { providerMessageId: "unexpected" }
    })
    await runtime.sendInvitation(delivery)
    expect(sends).toBe(0)
    expect(await state(delivery.attemptId)).toEqual({
      status: "failed",
      error_code: "INVITATION_NOT_ACTIVE",
    })
    const audit = await environment.observer.query(
      "SELECT result FROM audit_events WHERE resource_id=$1 AND event_code='invitation.delivery_failed'",
      [delivery.id]
    )
    expect(audit.rows).toEqual([{ result: "failed" }])
  })
  it("does not send an expired invitation", async () => {
    const f = await fixture()
    const delivery = await queued(f)
    await environment.migrator.query(
      "UPDATE invitation SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [delivery.id]
    )
    let sends = 0
    await service(async () => {
      sends++
      return { providerMessageId: "unexpected" }
    }).sendInvitation(delivery)
    expect(sends).toBe(0)
    expect((await state(delivery.attemptId)).error_code).toBe(
      "INVITATION_NOT_ACTIVE"
    )
  })
  it("never automatically retries an unknown SMTP result", async () => {
    const f = await fixture()
    const delivery = await queued(f)
    let sends = 0
    const runtime = service(async () => {
      sends++
      throw Object.assign(new Error("unknown SMTP outcome"), {
        code: "ETIMEDOUT",
      })
    })
    await runtime.sendInvitation(delivery)
    expect(await state(delivery.attemptId)).toEqual({
      status: "unknown",
      error_code: "SMTP_RESULT_UNKNOWN",
    })
    await runtime.sendInvitation(delivery)
    await runtime.dispatchInvitation()
    expect(sends).toBe(1)
  })
  it("preserves the native limit of 100 currently active pending invitations", async () => {
    const f = await fixture()
    for (let index = 0; index < 100; index++) await queued(f)
    await expect(queued(f)).rejects.toMatchObject({
      body: { code: "INVITATION_LIMIT_REACHED" },
    })
    const count = await environment.observer.query(
      "SELECT count(*)::int AS count FROM invitation WHERE organization_id=$1",
      [f.organization.id]
    )
    expect(count.rows[0].count).toBe(100)
  })
  it("keeps the actual resending administrator as the persisted delivery actor", async () => {
    const f = await fixture()
    const admin = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    await environment.runtime.auth.api.addMember({
      headers: f.owner.headers,
      body: {
        organizationId: f.organization.id,
        userId: admin.user.id,
        role: "admin",
      },
    })
    const invitation = await environment.runtime.auth.api.createInvitation({
      headers: f.owner.headers,
      body: {
        organizationId: f.organization.id,
        email: `${randomUUID()}@example.test`,
        role: "member",
      },
    })
    await environment.migrator.query(
      "UPDATE invitation_delivery_attempts SET created_at=clock_timestamp()-interval '61 seconds' WHERE invitation_id=$1",
      [invitation.id]
    )
    const resent = await environment.runtime.auth.api.createInvitation({
      headers: admin.headers,
      body: {
        organizationId: f.organization.id,
        email: invitation.email,
        role: "member",
        resend: true,
      },
    })
    expect(resent.id).toBe(invitation.id)
    expect(new Date(resent.expiresAt).toISOString()).toBe(
      new Date(invitation.expiresAt).toISOString()
    )
    const attempt = await environment.observer.query(
      "SELECT actor_id,request_id FROM invitation_delivery_attempts WHERE invitation_id=$1 ORDER BY created_at DESC LIMIT 1",
      [invitation.id]
    )
    expect(attempt.rows[0].actor_id).toBe(admin.user.id)
    expect(attempt.rows[0].request_id).toBeTruthy()
  })
})
