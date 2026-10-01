import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  configureApiClient,
  getPlatformSettings,
  updatePlatformSettings,
} from "../../packages/api-client/src/index.ts"
import {
  PlatformSettingsSchema,
  PlatformSettingsUpdateResultSchema,
} from "../../packages/contracts/src/index.ts"
import { emailCatalog } from "../../packages/i18n/src/index.ts"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { waitForMail } from "../setup/mailpit.mjs"

describe("platform settings and persisted language inheritance", () => {
  let environment, admin, auditor, owner, organization
  const origin = "http://localhost:3201"
  const request = (actor = admin, body, key = randomUUID(), headers = {}) =>
    fetch(`${environment.baseURL}/api/v1/platform/settings`, {
      method: body ? "PATCH" : "GET",
      headers: {
        cookie: actor.cookie,
        origin,
        "content-type": "application/json",
        ...(body ? { "Idempotency-Key": key } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  const current = async () => {
    const response = await request()
    expect(response.status).toBe(200)
    return response.json()
  }
  const input = async (locale) => ({
    platformDefaultLocale: locale,
    reason: "Issue 23 default language change",
    expectedVersion: (await current()).version,
  })
  const facts = async (operation) =>
    (
      await environment.migrator.query(
        "SELECT fact FROM public.issue23_facts WHERE fact->>'operation_id'=$1",
        [operation]
      )
    ).rows.map((row) => row.fact)
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin], mail: true })
    await environment.migrator
      .query(`CREATE TABLE public.issue23_facts(fact jsonb NOT NULL);
    CREATE FUNCTION public.issue23_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    BEGIN INSERT INTO public.issue23_facts VALUES(to_jsonb(NEW)); RETURN NEW; END; $$;
    CREATE TRIGGER issue23_capture AFTER INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.issue23_capture();`)
    admin = await platformOperator(environment, origin)
    auditor = await platformOperator(environment, origin, "platform_auditor")
    owner = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Inherited locale", slug: `locale-${randomUUID()}` },
    })
    configureApiClient({
      baseUrl: environment.baseURL,
      getHeaders: () => ({ cookie: admin.cookie, origin }),
    })
  })
  afterAll(async () => {
    configureApiClient({ baseUrl: "http://localhost" })
    await environment?.close()
  })

  it("returns only the safe typed deployment summary to administrators and auditors", async () => {
    const sdk = await getPlatformSettings()
    expect(sdk.status).toBe(200)
    expect(PlatformSettingsSchema.parse(sdk.data)).toEqual({
      platformDefaultLocale: "zh-CN",
      version: 1,
      supportedLocales: ["zh-CN", "en-US", "ar"],
      environment: "test",
      applicationVersion: "0.0.1",
      smtpConfigured: true,
    })
    const response = await request(auditor)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual(sdk.data)
    const text = JSON.stringify(sdk.data)
    for (const secret of [
      environment.config.secret,
      environment.config.databaseURL,
      environment.config.redisURL,
      environment.config.email.from.email,
      environment.config.email.smtp.host,
    ])
      expect(text).not.toContain(secret)
    expect((await request(owner)).status).toBe(403)
    expect(
      (await fetch(`${environment.baseURL}/api/v1/platform/settings`)).status
    ).toBe(401)
  })

  it("commits one audited version change and replays the same key without another write", async () => {
    const body = await input("en-US"),
      key = randomUUID()
    const sdk = await updatePlatformSettings(body, { "Idempotency-Key": key })
    expect(sdk.status).toBe(200)
    const result = PlatformSettingsUpdateResultSchema.parse(sdk.data)
    expect(result).toMatchObject({
      platformDefaultLocale: "en-US",
      version: body.expectedVersion + 1,
      changed: true,
      result: "succeeded",
    })
    const retry = await request(admin, body, key)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual(result)
    expect(await facts(result.operationId)).toEqual([
      expect.objectContaining({
        actor_id: admin.user.id,
        scope: "platform",
        event_code: "platform.settings_updated",
        tenant_visible: false,
        organization_id: null,
        reason: body.reason,
        fields: {
          previousDefaultLocale: "zh-CN",
          platformDefaultLocale: "en-US",
          version: result.version,
        },
      }),
    ])
    const reused = await request(
      admin,
      { ...body, reason: "Different semantic operation" },
      key
    )
    expect(reused.status).toBe(409)
    expect(await reused.json()).toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    })
    const stale = await request(admin, body)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ code: "VERSION_CONFLICT" })
    const unchanged = await request(admin, await input("en-US"))
    const noChange = await unchanged.json()
    expect(noChange).toMatchObject({
      version: result.version,
      changed: false,
      result: "no_change",
    })
    expect(await facts(noChange.operationId)).toEqual([
      expect.objectContaining({ result: "no_change" }),
    ])
  })

  it("rejects unsupported or expanded settings, bad reasons/keys, unauthorized writes and CSRF", async () => {
    const body = await input("ar")
    for (const invalid of [
      { ...body, platformDefaultLocale: "fr" },
      { ...body, platformDefaultLocale: null },
      { ...body, reason: " " },
      { ...body, smtpConfigured: false },
      { ...body, supportedLocales: ["fr"] },
      { ...body, expectedVersion: 0 },
    ])
      expect((await request(admin, invalid)).status).toBe(400)
    expect((await request(admin, body, "invalid key")).status).toBe(400)
    expect(
      (await request(admin, body, undefined, { "Idempotency-Key": "" })).status
    ).toBe(400)
    expect((await request(auditor, body)).status).toBe(403)
    expect((await request(owner, body)).status).toBe(403)
    expect(
      (
        await request(admin, body, undefined, {
          origin: "http://untrusted.example",
        })
      ).status
    ).toBe(403)
    const noOrigin = await fetch(
      `${environment.baseURL}/api/v1/platform/settings`,
      {
        method: "PATCH",
        headers: {
          cookie: admin.cookie,
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify(body),
      }
    )
    expect(noOrigin.status).toBe(403)
    await environment.migrator.query(
      "UPDATE platform_session_assurance SET verified_at=clock_timestamp()-interval '16 minutes' WHERE user_id=$1",
      [admin.user.id]
    )
    try {
      const staleMfa = await request(admin, body)
      expect(staleMfa.status).toBe(403)
      expect(await staleMfa.json()).toMatchObject({
        code: "PLATFORM_MFA_REQUIRED",
      })
      expect((await request()).status).toBe(200)
    } finally {
      await environment.migrator.query(
        "UPDATE platform_session_assurance SET verified_at=clock_timestamp() WHERE user_id=$1",
        [admin.user.id]
      )
    }
    expect((await current()).version).toBe(body.expectedVersion)
  })

  it("serializes competing expected versions without losing an update", async () => {
    const body = await input("ar")
    const results = await Promise.all([
      request(admin, body),
      request(admin, { ...body, platformDefaultLocale: "zh-CN" }),
    ])
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 409,
    ])
    const winner = await results
      .find((response) => response.status === 200)
      .json()
    expect((await current()).platformDefaultLocale).toBe(
      winner.platformDefaultLocale
    )
    expect((await current()).version).toBe(body.expectedVersion + 1)
  })

  it("rolls back settings and the receipt on audit failure, then permits the same request", async () => {
    const previous = await current(),
      body = {
        ...(await input(
          previous.platformDefaultLocale === "ar" ? "zh-CN" : "ar"
        )),
      },
      key = randomUUID()
    await environment.migrator
      .query(`CREATE FUNCTION public.issue23_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_code='platform.settings_updated' THEN RAISE EXCEPTION 'audit injection'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER issue23_fail BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.issue23_fail();`)
    try {
      const response = await request(admin, body, key)
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ code: "AUDIT_UNAVAILABLE" })
      expect(await current()).toEqual(previous)
    } finally {
      await environment.migrator.query(
        "DROP TRIGGER issue23_fail ON public.audit_events; DROP FUNCTION public.issue23_fail()"
      )
    }
    const retry = await request(admin, body, key)
    expect(retry.status).toBe(200)
    const result = await retry.json()
    expect(result.version).toBe(previous.version + 1)
    expect(await facts(result.operationId)).toHaveLength(1)
  })

  it("changes subsequent HTTP and Projects inheritance while preserving personal and organization facts", async () => {
    expect((await request(admin, await input("ar"))).status).toBe(200)
    const nativeError = await fetch(
      `${environment.baseURL}/api/auth/sign-in/email`,
      {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "accept-language": "fr",
        },
        body: JSON.stringify({
          email: `${randomUUID()}@example.test`,
          password: "not-the-password",
        }),
      }
    )
    expect(nativeError.status).toBe(401)
    expect(await nativeError.json()).toMatchObject({
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "البريد الإلكتروني أو كلمة المرور غير صالحة",
    })
    const http = (path, headers = {}) =>
      fetch(`${environment.baseURL}/api/v1/${path}`, {
        headers: { cookie: owner.cookie, ...headers },
      })
    const mine = await http("me/preferences")
    expect(mine.headers.get("content-language")).toBe("ar")
    expect(await mine.json()).toMatchObject({
      preferredLocale: null,
      version: 1,
      effectiveLocale: "ar",
      effectiveLocaleSource: "platform",
    })
    const access = await http(`organizations/${organization.id}/access`)
    expect(access.headers.get("content-language")).toBe("ar")
    expect(await access.json()).toMatchObject({
      effectiveLocale: "ar",
      effectiveLocaleSource: "platform",
    })
    const explicit = await http(`organizations/${organization.id}/access`, {
      "Accept-Language": "en-US",
    })
    expect(explicit.headers.get("content-language")).toBe("en-US")
    expect(await explicit.json()).toMatchObject({
      effectiveLocale: "ar",
      effectiveLocaleSource: "platform",
    })
    const project = await fetch(
      `${environment.baseURL}/api/v1/organizations/${organization.id}/projects`,
      {
        method: "POST",
        headers: {
          cookie: owner.cookie,
          origin,
          "content-type": "application/json",
          "Accept-Language": "en-US",
        },
        body: JSON.stringify({
          name: "Inherited base language",
          description: null,
        }),
      }
    )
    expect(project.status).toBe(201)
    expect(await project.json()).toMatchObject({ contentLocale: "ar" })
    await environment.migrator.query(
      "UPDATE public.\"user\" SET preferred_locale='en-US' WHERE id=$1",
      [owner.user.id]
    )
    await environment.migrator.query(
      "UPDATE organization SET default_locale='zh-CN' WHERE id=$1",
      [organization.id]
    )
    expect((await request(admin, await input("en-US"))).status).toBe(200)
    const preference = await http("me/preferences")
    expect(await preference.json()).toMatchObject({
      preferredLocale: "en-US",
      version: 1,
      effectiveLocaleSource: "user",
    })
    await environment.migrator.query(
      'UPDATE public."user" SET preferred_locale=NULL WHERE id=$1',
      [owner.user.id]
    )
    const inherited = await http(`organizations/${organization.id}/access`)
    expect(inherited.headers.get("content-language")).toBe("zh-CN")
    expect(await inherited.json()).toMatchObject({
      effectiveLocale: "zh-CN",
      effectiveLocaleSource: "organization",
    })
    const settings = await http(`organizations/${organization.id}/settings`)
    expect(await settings.json()).toMatchObject({
      defaultLocale: "zh-CN",
      version: 1,
    })
  })

  it("delivers recipient, organization and platform language inheritance through real SMTP", async () => {
    expect((await request(admin, await input("ar"))).status).toBe(200)
    // 无个人偏好的密码重置不受发送请求的 UI 语言影响。
    await environment.runtime.auth.api.requestPasswordReset({
      headers: new Headers({ origin, "accept-language": "en-US" }),
      body: { email: owner.email, redirectTo: `${origin}/reset-password` },
    })
    const reset = await waitForMail(
      environment.mailpitOrigin,
      owner.email,
      emailCatalog["password-reset"].ar.subject
    )
    expect(reset.HTML).toContain('lang="ar" dir="rtl"')
    await environment.migrator.query(
      "UPDATE organization SET default_locale=NULL WHERE id=$1",
      [organization.id]
    )
    const invite = async (email, locale, name = "Inherited locale") => {
      await environment.runtime.auth.api.createInvitation({
        headers: owner.headers,
        body: { organizationId: organization.id, email, role: "member" },
      })
      const subject = `${emailCatalog["organization.invitation"][locale].subject}${locale === "ar" ? ": " : "："}${name}`
      const received = await waitForMail(
        environment.mailpitOrigin,
        email,
        subject
      )
      expect(received.HTML).toContain(`lang="${locale}"`)
    }
    await invite(`${randomUUID()}@example.test`, "ar")
    await environment.migrator.query(
      "UPDATE organization SET default_locale='zh-CN' WHERE id=$1",
      [organization.id]
    )
    await invite(`${randomUUID()}@example.test`, "zh-CN")
    const recipient = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    await environment.migrator.query(
      "UPDATE public.\"user\" SET preferred_locale='en-US' WHERE id=$1",
      [recipient.user.id]
    )
    await invite(recipient.email, "en-US")
  })

  it("keeps writes private to fixed functions and rejects a revoked actor before replay", async () => {
    for (const sql of [
      "UPDATE public.platform_settings SET default_locale='zh-CN'",
      "SELECT version FROM public.platform_settings",
      "SET ROLE platform_executor",
    ])
      await expect(environment.runtime.pool.query(sql)).rejects.toMatchObject({
        code: "42501",
      })
    const privileges = await environment.migrator
      .query(`SELECT pg_get_userbyid(proowner) AS owner, prosecdef,
      has_function_privilege('app_runtime',oid,'EXECUTE') AS runtime, has_function_privilege('platform_runtime',oid,'EXECUTE') AS legacy,
      has_function_privilege('platform_deployer',oid,'EXECUTE') AS deployer FROM pg_proc WHERE proname IN ('get_platform_settings','update_platform_settings')`)
    expect(privileges.rows).toHaveLength(2)
    for (const row of privileges.rows)
      expect(row).toEqual({
        owner: "platform_executor",
        prosecdef: true,
        runtime: true,
        legacy: false,
        deployer: false,
      })
    const body = await input("zh-CN"),
      key = randomUUID()
    expect((await request(admin, body, key)).status).toBe(200)
    await promisify(execFile)(
      process.execPath,
      [
        "apps/api/dist/console.js",
        "platform",
        "assignment",
        "revoke",
        "--user-id",
        admin.user.id,
        "--role",
        "platform_admin",
        "--reason",
        "Issue 23 revoke before replay",
      ],
      {
        env: {
          PATH: process.env.PATH,
          PLATFORM_ASSIGNMENT_DATABASE_URL: environment.deployerURL,
        },
      }
    )
    expect((await request(admin, body, key)).status).toBe(403)
    expect((await request()).status).toBe(403)
  })
})
