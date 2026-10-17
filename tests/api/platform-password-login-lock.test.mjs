import { randomBytes, randomUUID } from "node:crypto"
import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import {
  PlatformLoginLogsPageSchema,
  LoginLogsPageSchema,
} from "../../packages/contracts/src/identity-management.ts"

describe("global password login lock HTTP", () => {
  let environment, target, admin, auditor
  const origins = ["http://localhost:3200", "http://localhost:3201"]
  const login = (password, origin) =>
    fetch(`${environment.baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
      },
      body: JSON.stringify({ email: target.email, password }),
    })
  const unlock = (actor) =>
    fetch(
      `${environment.baseURL}/api/v1/platform/users/${target.user.id}/password-login/unlock`,
      {
        method: "POST",
        headers: { origin: origins[1], cookie: actor.cookie },
      }
    )
  beforeAll(async () => {
    environment = await startTestApplication({ origins })
    target = await signUpVerified(
      environment.baseURL,
      origins[0],
      environment.migrator
    )
    admin = await signUpVerified(
      environment.baseURL,
      origins[1],
      environment.migrator
    )
    auditor = await signUpVerified(
      environment.baseURL,
      origins[1],
      environment.migrator
    )
    for (const [actor, role] of [
      [admin, "platform_admin"],
      [auditor, "platform_auditor"],
    ]) {
      await environment.deployerPool.query(
        "SELECT public.manage_platform_assignment('grant',$1,$2,'Password lock HTTP acceptance')",
        [actor.user.id, role]
      )
    }
  })
  afterAll(async () => {
    await environment?.close()
  })

  it("shares failures across both backends and denies correct password during the lock", async () => {
    for (let index = 0; index < 5; index++)
      expect((await login(randomUUID(), origins[index % 2])).status).toBe(401)
    const response = await login(target.password, origins[1])
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: "PASSWORD_LOGIN_LOCKED",
    })
    const session = await fetch(`${environment.baseURL}/api/auth/get-session`, {
      headers: { cookie: target.cookie },
    })
    expect((await session.json()).user.id).toBe(target.user.id)
  })
  it("returns current lock state only in the formal platform login projection", async () => {
    const response = await fetch(
      `${environment.baseURL}/api/v1/platform/login-events?userId=${target.user.id}`,
      { headers: { cookie: admin.cookie } }
    )
    expect(response.status).toBe(200)
    const page = PlatformLoginLogsPageSchema.parse(await response.json())
    expect(page.total).toBeGreaterThan(0)
    expect(
      page.items.every(
        (row) => row.userId === target.user.id && row.lockedUntil !== null
      )
    ).toBe(true)
    const personalResponse = await fetch(
      `${environment.baseURL}/api/v1/me/login-events`,
      { headers: { cookie: target.cookie } }
    )
    expect(personalResponse.status).toBe(200)
    const personal = LoginLogsPageSchema.parse(await personalResponse.json())
    expect(
      personal.items.every((row) => !Object.hasOwn(row, "lockedUntil"))
    ).toBe(true)
  })
  it("requires the independent unlock action and records the successful write without deleting sessions", async () => {
    expect((await unlock(auditor)).status).toBe(403)
    const before = (
      await environment.observer.query(
        "SELECT id FROM public.session WHERE user_id=$1 ORDER BY id",
        [target.user.id]
      )
    ).rows
    const response = await unlock(admin)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      userId: target.user.id,
      changed: true,
      lockedUntil: null,
    })
    expect(
      (
        await environment.observer.query(
          "SELECT id FROM public.session WHERE user_id=$1 ORDER BY id",
          [target.user.id]
        )
      ).rows
    ).toEqual(before)
    expect(
      (
        await environment.observer.query(
          "SELECT event_code,result FROM public.audit_events WHERE event_code='platform.user_password_login_unlocked' AND resource_id=$1",
          [target.user.id]
        )
      ).rows
    ).toEqual(
      expect.arrayContaining([
        {
          event_code: "platform.user_password_login_unlocked",
          result: "succeeded",
        },
      ])
    )
    const logs = await fetch(
      `${environment.baseURL}/api/v1/platform/login-events?userId=${target.user.id}`,
      { headers: { cookie: admin.cookie } }
    )
    expect(
      PlatformLoginLogsPageSchema.parse(await logs.json()).items.every(
        (row) => row.lockedUntil === null
      )
    ).toBe(true)
    expect((await login(target.password, origins[0])).status).toBe(200)
  })
})
