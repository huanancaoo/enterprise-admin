import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  configureApiClient,
  listPlatformUsers,
  getPlatformUser,
  getPlatformSensitiveProfile,
} from "../../packages/api-client/src/index.ts"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("platform user directory and sensitive access", () => {
  let environment, admin, auditor, target, organization
  const origin = "http://localhost:3201"
  const request = (path, actor = admin) =>
    fetch(`${environment.baseURL}/api/v1/platform/users${path}`, {
      headers: { cookie: actor.cookie },
    })
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    admin = await platformOperator(environment, origin)
    auditor = await platformOperator(environment, origin, "platform_auditor")
    target = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator,
      { name: "Directory target", email: "directory-private@example.test" }
    )
    organization = await environment.runtime.auth.api.createOrganization({
      headers: target.headers,
      body: {
        name: "Directory association",
        slug: `directory-${randomUUID()}`,
      },
    })
    // 捕获实际提交的审计行来核对事务事实，不改动生产 RLS 或运行角色权限。
    await environment.migrator
      .query(`CREATE TABLE public.issue21_committed_audit (fact jsonb NOT NULL);
      CREATE FUNCTION public.issue21_capture_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
      BEGIN INSERT INTO public.issue21_committed_audit VALUES (to_jsonb(NEW)); RETURN NEW; END; $$;
      CREATE TRIGGER issue21_capture_audit AFTER INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.issue21_capture_audit();`)
    configureApiClient({
      baseUrl: environment.baseURL,
      getHeaders: () => ({ cookie: admin.cookie }),
    })
  })
  afterAll(async () => {
    await environment?.close()
  })

  it("uses the generated client and returns a strictly masked, stable paginated directory", async () => {
    const response = await listPlatformUsers({
      q: "Directory",
      page: 1,
      pageSize: 1,
    })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.data).toEqual({
      items: [
        {
          userId: target.user.id,
          name: "Directory target",
          maskedEmail: "d***@example.test",
          emailVerified: true,
          createdAt: expect.any(String),
          organizationCount: 1,
        },
      ],
      page: 1,
      pageSize: 1,
      total: 1,
    })
    const second = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator,
      { name: "Directory later" }
    )
    const firstPage = await (
      await request("?q=Directory&pageSize=1", auditor)
    ).json()
    const secondPage = await (
      await request("?q=Directory&pageSize=1&page=2", auditor)
    ).json()
    expect(firstPage.items[0].userId).toBe(second.user.id)
    expect(secondPage.items[0].userId).toBe(target.user.id)
    expect(firstPage.total).toBe(2)
    expect(JSON.stringify([firstPage, secondPage])).not.toContain(target.email)
    expect(
      await (await request("?q=does-not-exist", auditor)).json()
    ).toMatchObject({ items: [], total: 0 })
    expect((await request("", target)).status).toBe(403)
    expect(
      (await fetch(`${environment.baseURL}/api/v1/platform/users`)).status
    ).toBe(401)
  })

  it("projects only organization membership and account security summary through the detail client", async () => {
    const response = await getPlatformUser(target.user.id)
    expect(response.data).toEqual({
      userId: target.user.id,
      name: target.user.name,
      maskedEmail: "d***@example.test",
      emailVerified: true,
      createdAt: expect.any(String),
      organizationCount: 1,
      twoFactorEnabled: false,
      organizations: [
        {
          organizationId: organization.id,
          name: organization.name,
          slug: organization.slug,
          status: "ACTIVE",
          role: "owner",
          joinedAt: expect.any(String),
        },
      ],
    })
    const detail = await (await request(`/${target.user.id}`, auditor)).json()
    expect(detail).toEqual(response.data)
    expect(JSON.stringify(detail)).not.toContain(target.email)
    expect((await request(`/${randomUUID()}`, auditor)).status).toBe(404)
  })

  it("requires explicit purpose and administrator permission before reading a full email, and commits one access audit", async () => {
    const purpose = "Support request for this exact user"
    const response = await getPlatformSensitiveProfile(target.user.id, {
      purpose,
    })
    expect(response.data).toEqual({
      userId: target.user.id,
      email: target.email,
    })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const denied = await request(
      `/${target.user.id}/sensitive-profile?purpose=${encodeURIComponent(purpose)}`,
      auditor
    )
    expect(denied.status).toBe(403)
    expect(await denied.json()).not.toHaveProperty("email")
    expect(
      (
        await request(
          `/${randomUUID()}/sensitive-profile?purpose=investigation`,
          auditor
        )
      ).status
    ).toBe(403)
    expect((await request(`/${target.user.id}/sensitive-profile`)).status).toBe(
      400
    )
    expect(
      (await request(`/${target.user.id}/sensitive-profile?purpose=%20%20`))
        .status
    ).toBe(400)
    const events = await environment.migrator.query(
      "SELECT fact FROM public.issue21_committed_audit WHERE fact->>'event_code' = 'platform.user_sensitive_read'"
    )
    expect(events.rows).toHaveLength(1)
    expect(events.rows[0].fact).toMatchObject({
      actor_id: admin.user.id,
      resource_id: target.user.id,
      reason: purpose,
      result: "succeeded",
      scope: "platform",
      tenant_visible: false,
      fields: {},
    })
    expect(JSON.stringify(events.rows)).not.toContain(target.email)
  })

  it("rejects invalid pagination, identifiers, extra read expansions and oversized purposes", async () => {
    for (const path of [
      "?page=0",
      "?page=2147483648",
      "?pageSize=101",
      "?q=" + "a".repeat(201),
      "?include=password",
      "/bad-id",
      `/${target.user.id}/sensitive-profile?purpose=${"a".repeat(501)}`,
    ]) {
      expect((await request(path)).status, path).toBe(400)
    }
    expect(
      (
        await request(
          `/${randomUUID()}/sensitive-profile?purpose=investigation`
        )
      ).status
    ).toBe(404)
  })

  it("does not return protected projections when access auditing fails", async () => {
    await environment.migrator
      .query(`CREATE FUNCTION public.issue21_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_code IN ('platform.users_queried', 'platform.user_viewed', 'platform.user_sensitive_read') THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER issue21_fail_audit BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.issue21_fail_audit();`)
    try {
      for (const path of [
        "",
        `/${target.user.id}`,
        `/${target.user.id}/sensitive-profile?purpose=investigation`,
      ]) {
        const response = await request(path)
        expect(response.status).toBe(503)
        const body = await response.json()
        expect(body.code).toBe("AUDIT_UNAVAILABLE")
        expect(JSON.stringify(body)).not.toContain(target.email)
        expect(body).not.toHaveProperty("organizations")
        expect(body).not.toHaveProperty("items")
      }
    } finally {
      await environment.migrator.query(
        "DROP TRIGGER issue21_fail_audit ON public.audit_events; DROP FUNCTION public.issue21_fail_audit()"
      )
    }
  })

  it("rechecks the current assignment for sensitive reads and the directory after role changes", async () => {
    await environment.deployerPool.query(
      "UPDATE public.platform_assignment SET role = 'platform_auditor' WHERE user_id = $1",
      [admin.user.id]
    )
    try {
      expect(
        (
          await request(
            `/${target.user.id}/sensitive-profile?purpose=investigation`
          )
        ).status
      ).toBe(403)
      expect((await request("")).status).toBe(200)
      await environment.deployerPool.query(
        "UPDATE public.platform_assignment SET status = 'revoked', revoked_at = clock_timestamp(), revoked_by = current_user, revoke_reason = 'directory revocation' WHERE user_id = $1",
        [admin.user.id]
      )
      expect((await request("")).status).toBe(403)
      expect((await request(`/${target.user.id}`)).status).toBe(403)
    } finally {
      await environment.deployerPool.query(
        "UPDATE public.platform_assignment SET role = 'platform_admin', status = 'active', revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL WHERE user_id = $1",
        [admin.user.id]
      )
    }
  })

  it("keeps platform queries from granting the platform operator tenant business access", async () => {
    await request("")
    const [authorized, rejected] = await Promise.all([
      fetch(
        `${environment.baseURL}/api/v1/organizations/${organization.id}/projects`,
        { headers: { cookie: target.cookie } }
      ),
      fetch(
        `${environment.baseURL}/api/v1/organizations/${organization.id}/projects`,
        { headers: { cookie: admin.cookie } }
      ),
    ])
    expect(authorized.status).toBe(200)
    expect(rejected.status).toBe(403)
    const functions = (
      await environment.migrator.query(
        `SELECT p.proname, p.prosecdef, p.proconfig, r.rolname, has_function_privilege('app_runtime', p.oid, 'EXECUTE') AS runtime,
      has_function_privilege('platform_runtime', p.oid, 'EXECUTE') AS legacy,
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE') AS public
      FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.proname = ANY($1::text[])`,
        [
          [
            "list_platform_users",
            "get_platform_user",
            "get_platform_sensitive_profile",
            "require_platform_user_access",
          ],
        ]
      )
    ).rows
    expect(functions).toHaveLength(4)
    for (const fn of functions) {
      expect(fn).toMatchObject({
        rolname: "platform_executor",
        prosecdef: true,
        proconfig: ["search_path=pg_catalog", "row_security=on"],
        runtime: fn.proname !== "require_platform_user_access",
        legacy: false,
        public: false,
      })
    }
    const secrets = (
      await environment.migrator
        .query(`SELECT has_column_privilege('platform_executor', 'public.account', 'password', 'SELECT') AS password,
      has_column_privilege('platform_executor', 'public.session', 'token', 'SELECT') AS token,
      has_column_privilege('platform_executor', 'public.two_factor', 'secret', 'SELECT') AS secret,
      has_column_privilege('platform_executor', 'public.two_factor', 'backup_codes', 'SELECT') AS backup`)
    ).rows[0]
    expect(secrets).toEqual({
      password: false,
      token: false,
      secret: false,
      backup: false,
    })
    await expect(
      environment.runtime.pool.query("SET ROLE platform_executor")
    ).rejects.toMatchObject({ code: "42501" })
  })
})
