import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { firstHttpUrl, waitForMail } from "../setup/mailpit.mjs"
import { startTestApplication } from "../setup/test-runtime.mjs"

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const character of value.toUpperCase().replace(/=+$/, "")) {
    bits += alphabet.indexOf(character).toString(2).padStart(5, "0")
  }
  const bytes = []
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2))
  }
  return Buffer.from(bytes)
}

function totp(secret, now = Date.now()) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counter)
    .digest()
  const offset = digest[digest.length - 1] & 0x0f
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0")
}

function responseCookie(response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
}

describe("native account security", () => {
  const origin = "http://localhost:3200"
  let environment
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin], mail: true })
  })
  afterAll(async () => environment?.close())

  it("projects current account fields into a cached native session response", async () => {
    const { baseURL, migrator } = environment
    const account = await signUpVerified(baseURL, origin, migrator)
    const name = `Updated ${randomUUID()}`
    await migrator.query(
      'UPDATE public."user" SET name = $1, email_verified = false, preferred_locale = $2 WHERE id = $3',
      [name, "ar", account.user.id]
    )

    const response = await fetch(`${baseURL}/api/auth/get-session`, {
      headers: { cookie: account.cookie },
    })
    expect(response.status).toBe(200)
    expect((await response.json()).user).toMatchObject({
      id: account.user.id,
      name,
      email: account.email,
      emailVerified: false,
      image: null,
      preferredLocale: "ar",
    })
  })

  it("records successful and failed email authentication without retaining raw email", async () => {
    const { baseURL, migrator } = environment
    const account = await signUpVerified(baseURL, origin, migrator)
    const failed = await fetch(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
        "user-agent": "account-security-test",
      },
      body: JSON.stringify({
        email: account.email,
        password: "incorrect-password",
      }),
    })
    expect(failed.status).toBe(401)

    const events = await migrator.query(
      "SELECT user_id, masked_email, method, result, reason_code, user_agent FROM public.login_events WHERE user_id = $1 ORDER BY occurred_at, id",
      [account.user.id]
    )
    expect(events.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: account.user.id,
          method: "email",
          result: "succeeded",
          reason_code: null,
        }),
        expect.objectContaining({
          user_id: account.user.id,
          method: "email",
          result: "failed",
          reason_code: "INVALID_CREDENTIALS",
          user_agent: "account-security-test",
        }),
      ])
    )
    expect(events.rows.every((row) => row.masked_email !== account.email)).toBe(
      true
    )
  })

  it("rejects a suspended session and does not restore it after the account resumes", async () => {
    const { baseURL, migrator } = environment
    const account = await signUpVerified(baseURL, origin, migrator)
    await migrator.query(
      "UPDATE public.user_account_status SET status = 'suspended', version = version + 1, updated_at = clock_timestamp() WHERE user_id = $1",
      [account.user.id]
    )
    await migrator.query("DELETE FROM public.session WHERE user_id = $1", [
      account.user.id,
    ])

    const suspended = await fetch(`${baseURL}/api/auth/get-session`, {
      headers: { cookie: account.cookie },
    })
    expect(suspended.status).toBe(403)
    expect(await suspended.json()).toMatchObject({ code: "ACCOUNT_SUSPENDED" })

    await migrator.query(
      "UPDATE public.user_account_status SET status = 'active', version = version + 1, updated_at = clock_timestamp() WHERE user_id = $1",
      [account.user.id]
    )
    const resumed = await fetch(`${baseURL}/api/auth/get-session`, {
      headers: { cookie: account.cookie },
    })
    expect(await resumed.json()).toBeNull()
  })

  it("rejects cached sessions on native writes while keeping public recovery routes available", async () => {
    const { baseURL, migrator } = environment
    const account = await signUpVerified(baseURL, origin, migrator)
    const originalName = (
      await migrator.query('SELECT name FROM public."user" WHERE id = $1', [
        account.user.id,
      ])
    ).rows[0].name
    await migrator.query("DELETE FROM public.session WHERE user_id = $1", [
      account.user.id,
    ])

    const staleCookieHeaders = {
      cookie: account.cookie,
      origin,
      "content-type": "application/json",
    }
    const update = await fetch(`${baseURL}/api/auth/update-user`, {
      method: "POST",
      headers: staleCookieHeaders,
      body: JSON.stringify({ name: "Must not be saved" }),
    })
    expect(update.status).toBe(401)
    const organization = await fetch(
      `${baseURL}/api/auth/organization/create`,
      {
        method: "POST",
        headers: staleCookieHeaders,
        body: JSON.stringify({
          name: "Must not be created",
          slug: randomUUID(),
        }),
      }
    )
    expect(organization.status).toBe(401)
    expect(
      (
        await migrator.query('SELECT name FROM public."user" WHERE id = $1', [
          account.user.id,
        ])
      ).rows[0].name
    ).toBe(originalName)

    const reset = await fetch(`${baseURL}/api/auth/request-password-reset`, {
      method: "POST",
      headers: staleCookieHeaders,
      body: JSON.stringify({
        email: account.email,
        redirectTo: `${origin}/reset-password`,
      }),
    })
    expect(reset.status).toBe(200)
    const signOut = await fetch(`${baseURL}/api/auth/sign-out`, {
      method: "POST",
      headers: staleCookieHeaders,
      body: JSON.stringify({}),
    })
    expect(signOut.status).toBe(200)
    const signIn = await fetch(`${baseURL}/api/auth/sign-in/email`, {
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
    expect(signIn.status).toBe(200)
  })

  it("records login only after MFA completes and does not treat enrollment as a login", async () => {
    const { baseURL, migrator } = environment
    const account = await signUpVerified(baseURL, origin, migrator)
    const enable = await fetch(`${baseURL}/api/auth/two-factor/enable`, {
      method: "POST",
      headers: {
        cookie: account.cookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        password: account.password,
        method: "totp",
        issuer: "Enterprise Admin",
      }),
    })
    expect(enable.status).toBe(200)
    const setupCookie = responseCookie(enable) || account.cookie
    const secret = new URL((await enable.json()).totpURI).searchParams.get(
      "secret"
    )
    const enrollment = await fetch(
      `${baseURL}/api/auth/two-factor/verify-totp`,
      {
        method: "POST",
        headers: {
          cookie: setupCookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ code: totp(secret) }),
      }
    )
    expect(enrollment.status).toBe(200)
    expect(
      await migrator.query(
        "SELECT id FROM public.login_events WHERE user_id = $1",
        [account.user.id]
      )
    ).toMatchObject({ rowCount: 1 })
    const enrolledCookie = responseCookie(enrollment) || setupCookie
    await fetch(`${baseURL}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        cookie: enrolledCookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    })

    const challenge = await fetch(`${baseURL}/api/auth/sign-in/email`, {
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
    expect(challenge.status).toBe(200)
    expect((await challenge.json()).twoFactorRedirect).toBe(true)
    const challengeCookie = responseCookie(challenge)
    expect(
      await migrator.query(
        "SELECT id FROM public.login_events WHERE user_id = $1",
        [account.user.id]
      )
    ).toMatchObject({ rowCount: 1 })

    const verified = await fetch(`${baseURL}/api/auth/two-factor/verify-totp`, {
      method: "POST",
      headers: {
        cookie: challengeCookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ code: totp(secret) }),
    })
    expect(verified.status).toBe(200)
    const events = await migrator.query(
      "SELECT method, result FROM public.login_events WHERE user_id = $1 ORDER BY occurred_at, id",
      [account.user.id]
    )
    expect(events.rows).toHaveLength(2)
    expect(events.rows).toEqual(
      expect.arrayContaining([
        { method: "email", result: "succeeded" },
        { method: "totp", result: "succeeded" },
      ])
    )
  })

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
