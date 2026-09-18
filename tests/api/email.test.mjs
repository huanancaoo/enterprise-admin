import { startTestApplication } from "../setup/test-runtime.mjs"
import { randomBytes, randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { firstHttpUrl, waitForMail } from "../setup/mailpit.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("auth mail outbox → SMTP → Mailpit", () => {
  let environment
  let runtime
  let migrator
  let baseURL
  let mailpitOrigin
  const origin = "http://localhost:3200"

  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin], mail: true })
    ;({ runtime, migrator, baseURL, mailpitOrigin } = environment)
  }, 180_000)

  afterAll(async () => {
    await environment?.close()
  })

  it("sends a verify-email message and the link verifies the user", async () => {
    const email = `${randomUUID()}@example.test`
    const password = randomBytes(24).toString("hex")
    const signup = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        email,
        password,
        name: "Mail user",
        callbackURL: `${origin}/auth/verified`,
      }),
    })
    expect(signup.status).toBe(200)
    const payload = await signup.json()
    expect(payload.token).toBeNull()
    const message = await waitForMail(mailpitOrigin, email, "验证你的邮箱")
    const verifyUrl = firstHttpUrl(message.HTML)
    const verified = await fetch(verifyUrl, { redirect: "manual" })
    expect(verified.status).toBeGreaterThanOrEqual(300)
    expect(verified.status).toBeLessThan(400)
    expect(verified.headers.get("location")).toBe(`${origin}/auth/verified`)
    const signIn = await fetch(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password }),
    })
    expect(signIn.status).toBe(200)
  })

  it("sends a password-reset message after a verified account requests it", async () => {
    const account = await signUpVerified(baseURL, origin, migrator, {
      name: "Reset user",
    })
    const reset = await fetch(`${baseURL}/api/auth/request-password-reset`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        email: account.email,
        redirectTo: `${origin}/reset-password`,
      }),
    })
    expect(reset.status).toBe(200)
    const message = await waitForMail(
      mailpitOrigin,
      account.email,
      "重置你的密码"
    )
    expect(firstHttpUrl(message.HTML)).toContain("/reset-password")
  })

  it("sends an organization invitation to the tenant accept-invitation URL", async () => {
    const account = await signUpVerified(baseURL, origin, migrator, {
      name: "Owner",
    })
    const organization = await runtime.auth.api.createOrganization({
      headers: account.headers,
      body: { name: "Mail org", slug: randomUUID() },
    })
    const invitee = `${randomUUID()}@example.test`
    const invited = await fetch(
      `${baseURL}/api/auth/organization/invite-member`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: account.cookie,
        },
        body: JSON.stringify({
          email: invitee,
          role: "member",
          organizationId: organization.id,
        }),
      }
    )
    expect(invited.status).toBe(200)
    const message = await waitForMail(
      mailpitOrigin,
      invitee,
      "你收到一个组织邀请：Mail org"
    )
    expect(firstHttpUrl(message.HTML)).toMatch(
      /^http:\/\/localhost:3200\/accept-invitation\/[0-9a-f-]+$/
    )
  })
})
