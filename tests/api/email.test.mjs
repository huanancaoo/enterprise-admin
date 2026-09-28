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
      headers: {
        "content-type": "application/json",
        origin,
        "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
      },
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
      headers: {
        "content-type": "application/json",
        origin,
        "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
      },
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
      headers: {
        "content-type": "application/json",
        origin,
        "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
      },
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

  it("sends Arabic verification and reset mail with RTL and usable links", async () => {
    const email = `${randomUUID()}@example.test`
    const password = randomBytes(24).toString("hex")
    const signup = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "accept-language": "en-US",
        "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
      },
      body: JSON.stringify({
        email,
        password,
        name: "Arabic user",
        callbackURL: `${origin}/auth/verified`,
      }),
    })
    expect(signup.status).toBe(200)
    const payload = await signup.json()
    await waitForMail(mailpitOrigin, email, "验证你的邮箱")
    await migrator.query(
      'UPDATE public."user" SET preferred_locale = $1 WHERE id = $2',
      ["ar", payload.user.id]
    )
    const resend = await runtime.auth.api.sendVerificationEmail({
      body: {
        email,
        callbackURL: `${origin}/auth/verified?source=arabic-email-test`,
      },
      headers: new Headers({ origin, "accept-language": "en-US" }),
    })
    expect(resend.status).toBe(true)
    const verifyMessage = await waitForMail(
      mailpitOrigin,
      email,
      "تحقق من بريدك الإلكتروني"
    )
    expect(verifyMessage.HTML).toContain('<html lang="ar" dir="rtl">')
    expect(verifyMessage.HTML).toContain("يرجى النقر على الرابط أدناه")
    expect(verifyMessage.HTML).toContain("تحقق من البريد الإلكتروني")
    const verifyUrl = new URL(firstHttpUrl(verifyMessage.HTML))
    expect(verifyUrl.origin).toBe(new URL(baseURL).origin)
    expect(verifyUrl.pathname).toBe("/api/auth/verify-email")
    expect(verifyUrl.searchParams.get("token")).toBeTruthy()
    expect(verifyUrl.searchParams.get("callbackURL")).toBe(
      `${origin}/auth/verified?source=arabic-email-test`
    )
    const verified = await fetch(verifyUrl, { redirect: "manual" })
    expect(verified.status).toBeGreaterThanOrEqual(300)
    expect(verified.status).toBeLessThan(400)
    expect(verified.headers.get("location")).toBe(
      `${origin}/auth/verified?source=arabic-email-test`
    )

    const reset = await fetch(`${baseURL}/api/auth/request-password-reset`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "accept-language": "en-US",
        "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
      },
      body: JSON.stringify({
        email,
        redirectTo: `${origin}/reset-password`,
      }),
    })
    expect(reset.status).toBe(200)
    const resetMessage = await waitForMail(
      mailpitOrigin,
      email,
      "إعادة تعيين كلمة المرور"
    )
    expect(resetMessage.HTML).toContain('<html lang="ar" dir="rtl">')
    expect(resetMessage.HTML).toContain("تنتهي صلاحية الرابط خلال ساعة واحدة")
    expect(resetMessage.HTML).toContain("إعادة تعيين كلمة المرور")
    const resetUrl = new URL(firstHttpUrl(resetMessage.HTML))
    expect(resetUrl.origin).toBe(new URL(baseURL).origin)
    expect(resetUrl.pathname).toMatch(/^\/api\/auth\/reset-password\/[^/]+$/)
  })

  it("prefers an Arabic invitee over organization and request languages", async () => {
    const owner = await signUpVerified(baseURL, origin, migrator, {
      name: "Owner",
    })
    const organization = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Mail org", slug: randomUUID() },
    })
    const settings = await fetch(
      `${baseURL}/api/v1/organizations/${organization.id}/settings`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: owner.cookie,
        },
        body: JSON.stringify({ defaultLocale: "en-US", expectedVersion: 1 }),
      }
    )
    expect(settings.status).toBe(200)

    const invitee = await signUpVerified(baseURL, origin, migrator, {
      name: "Arabic invitee",
    })
    await migrator.query(
      'UPDATE public."user" SET preferred_locale = $1 WHERE id = $2',
      ["ar", invitee.user.id]
    )
    const invited = await fetch(
      `${baseURL}/api/auth/organization/invite-member`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: owner.cookie,
          "accept-language": "en-US",
        },
        body: JSON.stringify({
          email: invitee.email,
          role: "member",
          organizationId: organization.id,
        }),
      }
    )
    expect(invited.status).toBe(200)
    const message = await waitForMail(
      mailpitOrigin,
      invitee.email,
      "دعوة للانضمام إلى مؤسسة: Mail org"
    )
    expect(message.HTML).toContain('<html lang="ar" dir="rtl">')
    expect(message.HTML).toContain("يدعوك للانضمام إلى Mail org")
    expect(message.HTML).toContain("قبول الدعوة")
    const acceptUrl = new URL(firstHttpUrl(message.HTML))
    expect(acceptUrl.origin).toBe(origin)
    expect(acceptUrl.pathname).toMatch(/^\/accept-invitation\/[0-9a-f-]+$/)
  })

  it("uses organization default before the platform and request locales", async () => {
    const owner = await signUpVerified(baseURL, origin, migrator, {
      name: "Owner",
    })
    const organization = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "English org", slug: randomUUID() },
    })
    const settings = await fetch(
      `${baseURL}/api/v1/organizations/${organization.id}/settings`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: owner.cookie,
        },
        body: JSON.stringify({ defaultLocale: "en-US", expectedVersion: 1 }),
      }
    )
    expect(settings.status).toBe(200)

    const invitee = `${randomUUID()}@example.test`
    const invited = await fetch(
      `${baseURL}/api/auth/organization/invite-member`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: owner.cookie,
          "accept-language": "ar",
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
      "You are invited to an organization：English org"
    )
    expect(message.HTML).toContain('<html lang="en-US" dir="ltr">')
    expect(message.HTML).toContain("invited you to join an organization.")
    expect(firstHttpUrl(message.HTML)).toMatch(
      /^http:\/\/localhost:3200\/accept-invitation\/[0-9a-f-]+$/
    )
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
          "accept-language": "ar",
        },
        body: JSON.stringify({
          email: invitee,
          role: "member",
          organizationId: organization.id,
        }),
      }
    )
    expect(invited.status).toBe(200)
    const invitation = await invited.json()
    const list = await runtime.auth.api.listInvitations({
      headers: account.headers,
      query: { organizationId: organization.id },
    })
    expect(list.find((row) => row.id === invitation.id).delivery.status).toBe(
      "smtp_accepted"
    )
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
