import { randomBytes, randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { firstHttpUrl, waitForMail } from "../setup/mailpit.mjs"
import { startTestApplication } from "../setup/test-runtime.mjs"

describe("native account security", () => {
  const origin = "http://localhost:3200"
  let environment
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin], mail: true })
  })
  afterAll(async () => environment?.close())

  it("changes the email only after the new address verifies and preserves the user identity", async () => {
    const { baseURL, migrator, mailpitOrigin } = environment
    const account = await signUpVerified(baseURL, origin, migrator)
    const newEmail = `${randomUUID()}@example.test`
    const change = await fetch(`${baseURL}/api/auth/change-email`, {
      method: "POST",
      headers: {
        cookie: account.cookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        newEmail,
        callbackURL: `${origin}/auth/verified`,
      }),
    })
    expect(change.status).toBe(200)
    const current = await fetch(
      `${baseURL}/api/auth/get-session?disableCookieCache=true`,
      {
        headers: { cookie: account.cookie },
      }
    )
    expect((await current.json()).user.email).toBe(account.email)
    const message = await waitForMail(mailpitOrigin, newEmail, "验证你的邮箱")
    const verified = await fetch(firstHttpUrl(message.HTML), {
      redirect: "manual",
    })
    expect(verified.headers.get("location")).toBe(`${origin}/auth/verified`)
    const login = await fetch(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
      },
      body: JSON.stringify({ email: newEmail, password: account.password }),
    })
    expect(login.status).toBe(200)
    expect((await login.json()).user).toMatchObject({
      id: account.user.id,
      email: newEmail,
    })
  })
  it.each([true, false, undefined])(
    "server password policy retains the current browser login and revokes other sessions when the client option is %s",
    async (revokeOtherSessions) => {
      const { baseURL, migrator } = environment
      const account = await signUpVerified(baseURL, origin, migrator)
      const otherLogin = await fetch(`${baseURL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
        },
        body: JSON.stringify({
          email: account.email,
          password: account.password,
        }),
      })
      expect(otherLogin.status).toBe(200)
      const otherCookie = otherLogin.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ")
      const changed = await fetch(`${baseURL}/api/auth/change-password`, {
        method: "POST",
        headers: {
          cookie: account.cookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          currentPassword: account.password,
          newPassword: randomBytes(24).toString("hex"),
          revokeOtherSessions,
        }),
      })
      expect(changed.status).toBe(200)
      const previous = await fetch(`${baseURL}/api/v1/me/preferences`, {
        headers: { cookie: otherCookie },
      })
      expect(previous.status).toBe(401)
      const currentCookie = changed.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ")
      const current = await fetch(`${baseURL}/api/v1/me/preferences`, {
        headers: { cookie: currentCookie },
      })
      expect(current.status).toBe(200)
    }
  )

  it("lists and revokes a specific other session before it can read protected preferences", async () => {
    const { baseURL, migrator } = environment
    const account = await signUpVerified(baseURL, origin, migrator)
    const otherLogin = await fetch(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
      },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
      }),
    })
    expect(otherLogin.status).toBe(200)
    const otherCookie = otherLogin.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    const otherSession = await fetch(
      `${baseURL}/api/auth/get-session?disableCookieCache=true`,
      { headers: { cookie: otherCookie } }
    )
    const target = (await otherSession.json()).session
    const listed = await fetch(`${baseURL}/api/auth/list-sessions`, {
      headers: { cookie: account.cookie },
    })
    expect(listed.status).toBe(200)
    expect(
      (await listed.json()).some((session) => session.id === target.id)
    ).toBe(true)
    const revoked = await fetch(`${baseURL}/api/auth/revoke-session`, {
      method: "POST",
      headers: {
        cookie: account.cookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: target.token }),
    })
    expect(revoked.status).toBe(200)
    const previous = await fetch(`${baseURL}/api/v1/me/preferences`, {
      headers: { cookie: otherCookie },
    })
    expect(previous.status).toBe(401)
    const current = await fetch(`${baseURL}/api/v1/me/preferences`, {
      headers: { cookie: account.cookie },
    })
    expect(current.status).toBe(200)
  })
})
