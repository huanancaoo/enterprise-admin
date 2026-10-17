import { randomBytes, randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { waitForMail, firstHttpUrl } from "../setup/mailpit.mjs"
import { emailCatalog } from "../../packages/i18n/src/email.ts"

describe("平台账号、登录记录与会话管理的真实 HTTP 闭环", () => {
  const origin = "http://localhost:3201"
  let environment, admin, auditor, target
  const clientIp = () => `10.${[...randomBytes(3)].join(".")}`
  const request = (path, actor = admin, method = "GET", body) =>
    fetch(`${environment.baseURL}/api/v1${path}`, {
      method,
      headers: {
        cookie: actor.cookie,
        origin,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  async function signIn(email, password) {
    const response = await fetch(
      `${environment.baseURL}/api/auth/sign-in/email`,
      {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-real-ip": clientIp(),
        },
        body: JSON.stringify({ email, password }),
      }
    )
    return {
      response,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    }
  }
  const detail = async (userId) =>
    (await request(`/platform/users/${userId}`)).json()
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin], mail: true })
    admin = await platformOperator(environment, origin)
    auditor = await platformOperator(environment, origin, "platform_auditor")
    target = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator,
      { name: "Managed target" }
    )
  })
  afterAll(async () => environment?.close())

  it("管理员创建默认验证通过的普通账号，姓名编辑有版本约束且不能修改邮箱", async () => {
    const input = {
      name: "New managed account",
      email: `${randomUUID()}@example.test`,
      password: randomBytes(18).toString("hex"),
    }
    const response = await request("/platform/users", admin, "POST", input)
    expect(response.status).toBe(201)
    const user = await response.json()
    expect(user).toMatchObject({
      name: input.name,
      emailVerified: true,
      status: "active",
      version: 1,
      organizations: [],
    })
    expect(JSON.stringify(user)).not.toContain(input.password)
    expect(JSON.stringify(user)).not.toContain(input.email)
    expect((await signIn(input.email, input.password)).response.status).toBe(
      200
    )
    expect(
      (
        await environment.observer.query(
          "SELECT 1 FROM platform_assignment WHERE user_id=$1",
          [user.userId]
        )
      ).rowCount
    ).toBe(0)
    expect(
      (
        await request("/platform/users", admin, "POST", {
          ...input,
          email: input.email.toUpperCase(),
        })
      ).status
    ).toBe(409)
    const forbidden = await request("/platform/users", auditor, "POST", {
      ...input,
      email: `${randomUUID()}@example.test`,
    })
    expect(forbidden.status).toBe(403)
    const updated = await request(
      `/platform/users/${user.userId}`,
      admin,
      "PATCH",
      { name: "Renamed account", expectedVersion: 1 }
    )
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({
      name: "Renamed account",
      version: 2,
    })
    expect(
      (
        await request(`/platform/users/${user.userId}`, admin, "PATCH", {
          name: "Stale",
          expectedVersion: 1,
        })
      ).status
    ).toBe(409)
    expect(
      (
        await request(`/platform/users/${user.userId}`, admin, "PATCH", {
          name: "Email mutation",
          email: "changed@example.test",
          expectedVersion: 2,
        })
      ).status
    ).toBe(400)
    expect((await detail(user.userId)).name).toBe("Renamed account")
  })

  it("暂停全局账号同时阻断两个组织和 API 凭据，恢复不复活旧会话", async () => {
    const organizations = []
    for (let i = 0; i < 2; i++)
      organizations.push(
        await environment.runtime.auth.api.createOrganization({
          headers: target.headers,
          body: { name: `Global status ${i}`, slug: randomUUID() },
        })
      )
    const path = `/organizations/${organizations[0].id}`
    const issuance = await request(
      `${path}/access-credentials`,
      target,
      "POST",
      {
        name: "Suspension acceptance",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        permissions: { project: ["read"] },
      }
    )
    expect(issuance.status).toBe(201)
    const credential = await issuance.json()
    const keyRequest = () =>
      fetch(`${environment.baseURL}/api/v1${path}/projects`, {
        headers: { "x-api-key": credential.key },
      })
    expect((await keyRequest()).status).toBe(200)
    const current = await detail(target.user.id)
    const suspended = await request(
      `/platform/users/${target.user.id}/status`,
      admin,
      "PATCH",
      { status: "suspended", expectedVersion: current.version }
    )
    expect(suspended.status).toBe(200)
    const suspension = await suspended.json()
    for (const organization of organizations)
      expect(
        (await request(`/organizations/${organization.id}/projects`, target))
          .status
      ).toBe(401)
    expect((await keyRequest()).status).toBe(403)
    expect((await signIn(target.email, target.password)).response.status).toBe(
      403
    )
    const staleNative = await fetch(
      `${environment.baseURL}/api/auth/get-session`,
      { headers: { cookie: target.cookie } }
    )
    expect((await staleNative.json())?.session).toBeUndefined()
    expect(
      (
        await request(
          `/platform/users/${target.user.id}/status`,
          auditor,
          "PATCH",
          { status: "active", expectedVersion: suspension.version }
        )
      ).status
    ).toBe(403)
    expect(
      (
        await request(
          `/platform/users/${target.user.id}/status`,
          admin,
          "PATCH",
          { status: "active", expectedVersion: suspension.version }
        )
      ).status
    ).toBe(200)
    expect((await request(`${path}/projects`, target)).status).toBe(401)
    expect((await signIn(target.email, target.password)).response.status).toBe(
      200
    )
    expect((await keyRequest()).status).toBe(200)
  })

  it("登录记录区分成功失败、支持稳定分页；本人接口拒绝伪造目标用户", async () => {
    const user = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator,
      { name: "Personal login log" }
    )
    expect(
      (await signIn(user.email, "Incorrect-password-123")).response.status
    ).toBe(401)
    const events = await request(
      `/platform/login-events?userId=${user.user.id}&pageSize=1`
    )
    expect(events.status).toBe(200)
    expect(events.headers.get("cache-control")).toBe("private, no-store")
    const page = await events.json()
    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 1 })
    expect(page.items[0]).toMatchObject({
      userId: user.user.id,
      result: "failed",
      method: "email",
    })
    const second = await (
      await request(
        `/platform/login-events?userId=${user.user.id}&page=2&pageSize=1`,
        auditor
      )
    ).json()
    expect(second.items[0]).toMatchObject({ result: "succeeded" })
    expect(second.items[0].id).not.toBe(page.items[0].id)
    const own = await request("/me/login-events?pageSize=100", user)
    expect(own.status).toBe(200)
    const personal = await own.json()
    expect(personal.total).toBe(2)
    expect(personal.items.every((event) => event.userId === user.user.id)).toBe(
      true
    )
    expect(JSON.stringify(personal)).not.toContain(user.email)
    expect(
      (await request(`/me/login-events?userId=${admin.user.id}`, user)).status
    ).toBe(400)
    expect((await request("/platform/login-events", user)).status).toBe(403)
    expect(
      (
        await request(
          "/platform/login-events?from=2030-01-02T00:00:00Z&to=2030-01-01T00:00:00Z"
        )
      ).status
    ).toBe(400)
  })

  it("管理员按 Session ID 撤销一个会话，其他会话保持有效且接口没有 token", async () => {
    const user = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator,
      { name: "Session target" }
    )
    const second = await signIn(user.email, user.password)
    const current = await (
      await request(
        `/platform/sessions?userId=${user.user.id}&pageSize=1`,
        auditor
      )
    ).json()
    expect(current).toMatchObject({ total: 2, pageSize: 1 })
    expect(JSON.stringify(current)).not.toMatch(/"token"|"password"/)
    const rows = await environment.observer.query(
      "SELECT id, token FROM public.session WHERE user_id=$1 ORDER BY created_at,id",
      [user.user.id]
    )
    const revokedId = rows.rows[0].id
    expect(
      (await request(`/platform/sessions/${revokedId}`, auditor, "DELETE"))
        .status
    ).toBe(403)
    const revoked = await request(
      `/platform/sessions/${revokedId}`,
      admin,
      "DELETE"
    )
    expect(revoked.status).toBe(200)
    expect(await revoked.json()).toEqual({
      sessionId: revokedId,
      revoked: true,
    })
    const old = await fetch(`${environment.baseURL}/api/auth/get-session`, {
      headers: { cookie: user.cookie },
    })
    expect((await old.json())?.session).toBeUndefined()
    const other = await fetch(`${environment.baseURL}/api/auth/get-session`, {
      headers: { cookie: second.cookie },
    })
    expect(await other.json()).toHaveProperty("session")
  })

  it("密码重置通过现有邮件流完成，管理动作在平台操作日志可查且不含秘密", async () => {
    const user = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator,
      { name: "Password reset target" }
    )
    const response = await request(
      `/platform/users/${user.user.id}/password-reset`,
      admin,
      "POST"
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ requested: true })
    const message = await waitForMail(
      environment.mailpitOrigin,
      user.email,
      emailCatalog["password-reset"]["zh-CN"].subject
    )
    const callback = await fetch(firstHttpUrl(message.HTML), {
      redirect: "manual",
    })
    const token = new URL(callback.headers.get("location")).searchParams.get(
      "token"
    )
    expect(token).toBeTruthy()
    const newPassword = randomBytes(18).toString("hex")
    const reset = await fetch(
      `${environment.baseURL}/api/auth/reset-password`,
      {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-real-ip": clientIp(),
        },
        body: JSON.stringify({ token, newPassword }),
      }
    )
    expect(reset.status).toBe(200)
    expect((await signIn(user.email, newPassword)).response.status).toBe(200)
    expect((await signIn(user.email, user.password)).response.status).toBe(401)
    const audit = await request("/platform/audit-events?pageSize=100")
    expect(audit.status).toBe(200)
    const facts = await audit.json()
    expect(
      facts.items.some((event) => event.eventCode === "platform.user_created")
    ).toBe(true)
    expect(
      facts.items.some(
        (event) => event.eventCode === "platform.user_password_reset_requested"
      )
    ).toBe(true)
    expect(JSON.stringify(facts)).not.toContain(user.password)
    expect(JSON.stringify(facts)).not.toContain(user.email)
  })

  it("审计失败同时回滚重置令牌和邮件入队", async () => {
    const user = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const counts = async () =>
      (
        await environment.observer.query(`SELECT
      (SELECT count(*)::int FROM public.email_messages WHERE template_key='password-reset') AS mail,
      (SELECT count(*)::int FROM public.verification WHERE identifier LIKE 'reset-password:%') AS tokens`)
      ).rows[0]
    const before = await counts()
    await environment.observer
      .query(`CREATE FUNCTION public.reject_managed_reset_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_code='platform.user_password_reset_requested' AND NEW.result='succeeded' THEN
        RAISE EXCEPTION 'test unavailable audit'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER reject_managed_reset_audit BEFORE INSERT ON public.audit_events
      FOR EACH ROW EXECUTE FUNCTION public.reject_managed_reset_audit()`)
    try {
      const response = await request(
        `/platform/users/${user.user.id}/password-reset`,
        admin,
        "POST"
      )
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ code: "AUDIT_UNAVAILABLE" })
      expect(await counts()).toEqual(before)
    } finally {
      await environment.observer.query(
        "DROP TRIGGER reject_managed_reset_audit ON public.audit_events; DROP FUNCTION public.reject_managed_reset_audit()"
      )
    }
  })

  it("暂停的缓存清理持有状态锁，恢复之后的新登录不会被旧暂停请求清除", async () => {
    const user = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const current = await detail(user.user.id)
    const context = await environment.runtime.auth.$context
    const original = context.internalAdapter.deleteUserSessions
    let entered, release
    const blocked = new Promise((resolve) => {
      entered = resolve
    })
    const gate = new Promise((resolve) => {
      release = resolve
    })
    context.internalAdapter.deleteUserSessions = async (userId) => {
      if (userId === user.user.id) {
        entered()
        await gate
      }
      return original(userId)
    }
    let restored = false
    try {
      const pause = request(
        `/platform/users/${user.user.id}/status`,
        admin,
        "PATCH",
        { status: "suspended", expectedVersion: current.version }
      )
      await blocked
      const resume = request(
        `/platform/users/${user.user.id}/status`,
        admin,
        "PATCH",
        { status: "active", expectedVersion: current.version + 1 }
      ).then((response) => {
        restored = true
        return response
      })
      await new Promise((resolve) => setTimeout(resolve, 60))
      expect(restored).toBe(false)
      release()
      expect((await pause).status).toBe(200)
      expect((await resume).status).toBe(200)
      const fresh = await signIn(user.email, user.password)
      expect(fresh.response.status).toBe(200)
      const session = await fetch(
        `${environment.baseURL}/api/auth/get-session`,
        { headers: { cookie: fresh.cookie } }
      )
      expect((await session.json())?.session).toBeTruthy()
    } finally {
      release()
      context.internalAdapter.deleteUserSessions = original
    }
  })
})
