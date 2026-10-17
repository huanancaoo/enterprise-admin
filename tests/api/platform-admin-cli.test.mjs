import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"

describe("platform administrator creation CLI", () => {
  let environment
  const origin = "http://localhost:3201"
  const password = () => randomBytes(18).toString("hex")
  const email = () => `${randomUUID()}@example.test`

  const create = (address, secret, overrides = {}) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [
          "apps/api/dist/console.js",
          "platform",
          "admin",
          "create",
          "--email",
          address,
          "--name",
          "CLI Admin",
          "--reason",
          overrides.reason ?? "administrator provisioning test",
          "--password-stdin",
        ],
        {
          env: {
            PATH: process.env.PATH,
            PLATFORM_ASSIGNMENT_DATABASE_URL:
              overrides.databaseURL ?? environment.deployerURL,
          },
        },
        (error, stdout, stderr) => {
          if (error) reject(Object.assign(error, { stdout, stderr }))
          else resolve({ ...JSON.parse(stdout), stdout, stderr })
        }
      )
      child.stdin.end(`${secret}\n`)
    })

  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
  })
  afterAll(async () => {
    await environment?.close()
  })

  it("creates a verified native credential account, assignment and audit without MFA or a session", async () => {
    const address = email()
    const secret = password()
    const created = await create(address.toUpperCase(), secret)
    expect(created).toMatchObject({ email: address, role: "platform_admin" })
    expect(created.stdout + created.stderr).not.toContain(secret)
    const { migrator, observer, baseURL } = environment
    const user = await migrator.query(
      'SELECT email_verified, two_factor_enabled FROM public."user" WHERE id=$1',
      [created.userId]
    )
    expect(user.rows[0]).toEqual({
      email_verified: true,
      two_factor_enabled: false,
    })
    const account = await migrator.query(
      "SELECT account_id, provider_id, password FROM public.account WHERE user_id=$1",
      [created.userId]
    )
    expect(account.rows).toHaveLength(1)
    expect(account.rows[0]).toMatchObject({
      account_id: created.userId,
      provider_id: "credential",
    })
    expect(account.rows[0].password).not.toBe(secret)
    expect(
      (
        await migrator.query(
          "SELECT r.key AS role,a.status,a.granted_by FROM public.platform_assignment a JOIN public.platform_assignment_role ar ON ar.user_id=a.user_id JOIN public.platform_role r ON r.id=ar.role_id WHERE a.user_id=$1",
          [created.userId]
        )
      ).rows[0]
    ).toEqual({
      role: "platform_admin",
      status: "active",
      granted_by: "platform_deployer",
    })
    expect(
      (
        await migrator.query(
          "SELECT action, result, actor FROM public.platform_assignment_audit WHERE user_id=$1",
          [created.userId]
        )
      ).rows
    ).toEqual([
      { action: "grant", result: "changed", actor: "platform_deployer" },
    ])
    for (const table of ["session", "member", "platform_session_assurance"]) {
      expect(
        (
          await observer.query(
            `SELECT 1 FROM public.${table} WHERE user_id=$1`,
            [created.userId]
          )
        ).rowCount
      ).toBe(0)
    }
    const signedIn = await fetch(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "x-real-ip": "10.1.1.21",
      },
      body: JSON.stringify({ email: address, password: secret }),
    })
    expect(signedIn.status).toBe(200)
    const cookie = signedIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    const access = await fetch(`${baseURL}/api/v1/me/platform`, {
      headers: { cookie },
    })
    expect(access.status).toBe(200)
    expect(await access.json()).toMatchObject({
      roles: expect.arrayContaining([
        expect.objectContaining({ key: "platform_admin" }),
      ]),
      mfaVerifiedAt: null,
    })
    expect(
      (await migrator.query("SELECT 1 FROM public.email_messages")).rowCount
    ).toBe(0)
  })

  it("rejects an existing email without changing its password or assignment", async () => {
    const address = email()
    const created = await create(address, password())
    const previous = (
      await environment.migrator.query(
        "SELECT password FROM public.account WHERE user_id=$1",
        [created.userId]
      )
    ).rows[0].password
    await expect(
      create(address.toUpperCase(), password())
    ).rejects.toMatchObject({ code: 1 })
    expect(
      (
        await environment.migrator.query(
          "SELECT password FROM public.account WHERE user_id=$1",
          [created.userId]
        )
      ).rows[0].password
    ).toBe(previous)
    expect(
      (
        await environment.migrator.query(
          "SELECT 1 FROM public.platform_assignment_audit WHERE user_id=$1",
          [created.userId]
        )
      ).rowCount
    ).toBe(1)
  })

  it.each([12, 128])("accepts a password of %i characters", async (length) => {
    expect(await create(email(), "a".repeat(length))).toMatchObject({
      role: "platform_admin",
    })
  })

  it("rejects an invalid email", async () => {
    await expect(create("invalid-email", password())).rejects.toMatchObject({
      code: 1,
    })
  })

  it("rejects the online runtime identity and rolls back its new account", async () => {
    const address = email()
    await expect(
      create(address, password(), {
        databaseURL: environment.config.databaseURL,
      })
    ).rejects.toMatchObject({ code: 1 })
    expect(
      (
        await environment.migrator.query(
          'SELECT 1 FROM public."user" WHERE email=$1',
          [address]
        )
      ).rowCount
    ).toBe(0)
  })

  it.each([
    ["short password", () => "short", undefined],
    ["long password", () => "a".repeat(129), undefined],
    ["empty reason", password, " "],
  ])(
    "rejects %s before creating an account",
    async (_label, secret, reason) => {
      const address = email()
      await expect(create(address, secret(), { reason })).rejects.toMatchObject(
        { code: 1 }
      )
      expect(
        (
          await environment.migrator.query(
            'SELECT 1 FROM public."user" WHERE email=$1',
            [address]
          )
        ).rowCount
      ).toBe(0)
    }
  )

  it("rolls back the entire account when the assignment audit cannot be written", async () => {
    const address = email()
    const { migrator } = environment
    // 只在隔离测试库制造审计失败，验证不会留下可以登录的半成品账号。
    await migrator.query(
      "ALTER TABLE public.platform_assignment_audit ADD CONSTRAINT provisioning_audit_test CHECK (reason <> 'reject provisioning audit')"
    )
    try {
      await expect(
        create(address, password(), { reason: "reject provisioning audit" })
      ).rejects.toMatchObject({
        code: 1,
      })
      expect(
        (
          await migrator.query('SELECT 1 FROM public."user" WHERE email=$1', [
            address,
          ])
        ).rowCount
      ).toBe(0)
    } finally {
      await migrator.query(
        "ALTER TABLE public.platform_assignment_audit DROP CONSTRAINT provisioning_audit_test"
      )
    }
  })

  it("does not grant the deployment identity access to existing credentials or tenant data", async () => {
    const { deployerPool } = environment
    const existing = await create(email(), password())
    await expect(
      deployerPool.query(
        "INSERT INTO public.account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES ($1, $2::text, 'credential', $2::uuid, $3, now(), now())",
        [randomUUID(), existing.userId, "not-a-password-hash"]
      )
    ).rejects.toMatchObject({ code: "42501" })
    await expect(
      deployerPool.query("SELECT password FROM public.account")
    ).rejects.toMatchObject({ code: "42501" })
    await expect(
      deployerPool.query("UPDATE public.account SET password=$1", [
        "not-a-password-hash",
      ])
    ).rejects.toMatchObject({ code: "42501" })
    await expect(
      deployerPool.query('UPDATE public."user" SET email_verified=true')
    ).rejects.toMatchObject({ code: "42501" })
    await expect(
      deployerPool.query("SELECT * FROM public.projects")
    ).rejects.toMatchObject({ code: "42501" })
  })
})
