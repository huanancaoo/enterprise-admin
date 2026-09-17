import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { promisify } from "node:util"
import { GenericContainer, Wait } from "testcontainers"
import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
// Nest 注入令牌与生产 CJS 入口使用同一个模块实例。
const {
  createApplication,
} = require("../../apps/api/dist/create-application.js")
const { RequestLanguage } = require("../../apps/api/dist/request-language.js")
const { AuthRuntime } = require("../../apps/api/dist/auth-runtime.js")
const {
  TenantContextService,
} = require("../../apps/api/dist/tenant-context.service.js")
import { auditEvents } from "../../packages/database/dist/schema/audit.js"
import { createDatabase } from "../../packages/database/dist/index.js"
import { createTenantRunner } from "../../packages/database/dist/tenant.js"
import { projectRepository } from "../../packages/database/dist/repositories/projects.js"
import {
  projectTranslations,
  projects,
} from "../../packages/database/dist/schema/projects.js"
import {
  ProjectPageSchema,
  ApiErrorSchema,
} from "../../packages/contracts/src/index.ts"
import {
  listProjects,
  createProject,
  deleteProject,
  configureApiClient,
  getProjectsListOptions,
  getProject,
  getProjectDetailOptions,
} from "../../packages/api-client/src/index.ts"
import { getGetProjectQueryKey } from "../../packages/api-client/src/generated/endpoints/projects/projects.ts"

describe("Projects: generated SDK → authorized HTTP → runtime PostgreSQL", () => {
  let container,
    app,
    runtime,
    baseURL,
    cookie,
    contextA,
    contextB,
    orgA,
    orgB,
    source,
    translated,
    migrator
  const origin = "http://localhost:3200"
  const query = (id, suffix = "", session = cookie, locale = "en-US") =>
    fetch(`${baseURL}/api/v1/organizations/${id}/projects${suffix}`, {
      headers: {
        cookie: session,
        ...(locale ? { "accept-language": locale } : {}),
      },
    })
  const queryDetail = (
    organizationId,
    projectId,
    session = cookie,
    locale = "en-US"
  ) =>
    fetch(
      `${baseURL}/api/v1/organizations/${organizationId}/projects/${projectId}`,
      {
        headers: {
          cookie: session,
          ...(locale ? { "accept-language": locale } : {}),
        },
      }
    )
  const queryTranslation = (
    organizationId,
    projectId,
    locale,
    session = cookie
  ) =>
    fetch(
      `${baseURL}/api/v1/organizations/${organizationId}/projects/${projectId}/translations/${locale}`,
      { headers: { cookie: session } }
    )
  const patchProject = (
    organizationId,
    projectId,
    body,
    session = cookie,
    locale = "en-US"
  ) =>
    fetch(
      `${baseURL}/api/v1/organizations/${organizationId}/projects/${projectId}`,
      {
        method: "PATCH",
        headers: {
          cookie: session,
          "content-type": "application/json",
          "accept-language": locale,
        },
        body: JSON.stringify(body),
      }
    )
  const deleteProjectRequest = (organizationId, projectId, session = cookie) =>
    fetch(
      `${baseURL}/api/v1/organizations/${organizationId}/projects/${projectId}`,
      {
        method: "DELETE",
        headers: { cookie: session },
      }
    )
  beforeAll(async () => {
    const versions = JSON.parse(
      await readFile("docs/architecture/versions.json", "utf8")
    )
    const passwords = Array.from({ length: 4 }, () =>
      randomBytes(24).toString("hex")
    )
    container = await new GenericContainer(versions.postgresql.image)
      .withEnvironment({
        POSTGRES_USER: "bootstrap_admin",
        POSTGRES_DB: "enterprise_admin",
        POSTGRES_PASSWORD: passwords[0],
        APP_MIGRATOR_PASSWORD: passwords[1],
        APP_RUNTIME_PASSWORD: passwords[2],
        PLATFORM_RUNTIME_PASSWORD: passwords[3],
      })
      .withCopyFilesToContainer([
        {
          source: resolve("infra/postgres/bootstrap.sql"),
          target: "/docker-entrypoint-initdb.d/001-bootstrap.sql",
        },
      ])
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forLogMessage("database system is ready to accept connections", 2)
      )
      .start()
    const url = (user, password) =>
      `postgresql://${user}:${password}@${container.getHost()}:${container.getMappedPort(5432)}/enterprise_admin`
    await promisify(execFile)(
      process.execPath,
      ["packages/database/src/migrate.ts"],
      {
        env: {
          PATH: process.env.PATH,
          MIGRATION_DATABASE_URL: url("app_migrator", passwords[1]),
        },
      }
    )
    migrator = createDatabase(url("app_migrator", passwords[1])).pool
    app = await createApplication(
      {
        databaseURL: url("app_runtime", passwords[2]),
        baseURL: "http://localhost:3000",
        secret: randomBytes(32).toString("hex"),
        trustedOrigins: [origin],
      },
      { logger: ["error"] }
    )
    await app.listen(0, "127.0.0.1")
    baseURL = await app.getUrl()
    runtime = app.get(AuthRuntime)
    const response = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        email: "projects@example.test",
        password: randomBytes(24).toString("hex"),
        name: "Projects",
      }),
    })
    expect(response.status).toBe(200)
    cookie = response.headers
      .getSetCookie()
      .map((item) => item.split(";")[0])
      .join("; ")
    const headers = new Headers({ cookie })
    orgA = await runtime.auth.api.createOrganization({
      headers,
      body: { name: "Projects A", slug: "projects-a" },
    })
    orgB = await runtime.auth.api.createOrganization({
      headers,
      body: { name: "Projects B", slug: "projects-b" },
    })
    const service = app.get(TenantContextService)
    contextA = await service.resolve(
      headers,
      orgA.id,
      { project: ["create"] },
      "seed-a",
      new RequestLanguage(null)
    )
    contextB = await service.resolve(
      headers,
      orgB.id,
      { project: ["create"] },
      "seed-b",
      new RequestLanguage(null)
    )
    const run = createTenantRunner(runtime.pool)
    await run(contextA, async (tx) => {
      source = await projectRepository.create(tx, {
        name: "基础 %_ 名称",
        description: "基础描述",
        contentLocale: "zh-CN",
      })
      translated = await projectRepository.create(tx, {
        name: "第二个",
        description: "不能混用的描述",
        contentLocale: "zh-CN",
      })
      await tx.insert(projectTranslations).values({
        organizationId: orgA.id,
        projectId: translated.id,
        locale: "en-US",
        name: "English %_ Project",
        description: null,
      })
      await tx.update(projects).set({
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      })
    })
    await run(contextB, (tx) =>
      projectRepository.create(tx, {
        name: "B secret",
        description: null,
        contentLocale: "en-US",
      })
    )
    configureApiClient({ baseUrl: baseURL, getHeaders: () => ({ cookie }) })
  })
  afterAll(async () => {
    try {
      await app?.close()
      await migrator?.end()
    } finally {
      await container?.stop()
    }
  })

  it("SDK读取整条译文，null描述不混入基础译文，租户隔离", async () => {
    const response = await listProjects(orgA.id, undefined, {
      "Accept-Language": "en-US",
    })
    expect(response.status).toBe(200)
    const page = ProjectPageSchema.parse(response.data)
    expect(page.total).toBe(2)
    expect(page.items.find((item) => item.id === source.id)).toMatchObject({
      name: "基础 %_ 名称",
      resolvedLocale: "zh-CN",
    })
    expect(page.items.find((item) => item.id === translated.id)).toMatchObject({
      name: "English %_ Project",
      description: null,
      resolvedLocale: "en-US",
    })
    expect(response.headers.get("content-language")).toBe("en-US")
    const b = await listProjects(orgB.id, undefined, {
      "Accept-Language": "en-US",
    })
    expect(b.data.items.map((item) => item.name)).toEqual(["B secret"])
  })
  it("详情按请求语言选择整条译文，跨组织资源返回404", async () => {
    const localized = await getProject(orgA.id, translated.id, {
      "Accept-Language": "en-US",
    })
    expect(localized.status).toBe(200)
    expect(localized.data).toMatchObject({
      id: translated.id,
      organizationId: orgA.id,
      contentLocale: "zh-CN",
      resolvedLocale: "en-US",
      name: "English %_ Project",
      description: null,
    })
    expect(localized.headers.get("content-language")).toBe("en-US")

    const fallback = await getProject(orgA.id, source.id, {
      "Accept-Language": "en-US",
    })
    expect(fallback.status).toBe(200)
    expect(fallback.data).toMatchObject({
      id: source.id,
      resolvedLocale: "zh-CN",
      name: "基础 %_ 名称",
      description: "基础描述",
    })
    expect(
      getProjectDetailOptions(orgA.id, source.id, "en-US").queryKey
    ).toEqual([
      "organizations",
      orgA.id,
      "projects",
      "detail",
      source.id,
      "en-US",
    ])
    expect(getGetProjectQueryKey(orgA.id, source.id)).toEqual([
      "organizations",
      orgA.id,
      "projects",
      "detail",
      source.id,
      null,
    ])

    const crossOrganization = await queryDetail(orgB.id, source.id)
    expect(crossOrganization.status).toBe(404)
    expect(ApiErrorSchema.parse(await crossOrganization.json()).code).toBe(
      "NOT_FOUND"
    )
  })
  it("名称按显示译文筛选，%/_为字面量；排序同值按id，越界总数保留", async () => {
    expect(
      (
        await listProjects(
          orgA.id,
          { name: "english %_" },
          { "Accept-Language": "en-US" }
        )
      ).data.total
    ).toBe(1)
    expect(
      (
        await listProjects(
          orgA.id,
          { name: "english %_" },
          { "Accept-Language": "zh-CN" }
        )
      ).data.total
    ).toBe(0)
    expect(
      (
        await listProjects(
          orgA.id,
          { name: "%_" },
          { "Accept-Language": "en-US" }
        )
      ).data.total
    ).toBe(2)
    expect(
      (
        await listProjects(
          orgA.id,
          { name: "English _x" },
          { "Accept-Language": "en-US" }
        )
      ).data.total
    ).toBe(0)
    const first = (
      await listProjects(
        orgA.id,
        { pageSize: 1 },
        { "Accept-Language": "en-US" }
      )
    ).data
    const second = (
      await listProjects(
        orgA.id,
        { page: 2, pageSize: 1 },
        { "Accept-Language": "en-US" }
      )
    ).data
    expect([first.items[0].id, second.items[0].id]).toEqual(
      [source.id, translated.id].sort()
    )
    expect(
      (
        await listProjects(
          orgA.id,
          { page: 99, pageSize: 1 },
          { "Accept-Language": "en-US" }
        )
      ).data
    ).toMatchObject({ items: [], total: 2, page: 99, pageSize: 1 })
    expect(
      (
        await listProjects(
          orgA.id,
          { status: "archived" },
          { "Accept-Language": "en-US" }
        )
      ).data.total
    ).toBe(0)
  })
  it("Header、用户偏好、组织默认值及并发语言独立", async () => {
    const platformDefaultDetail = await queryDetail(
      orgA.id,
      source.id,
      cookie,
      ""
    )
    expect(platformDefaultDetail.headers.get("content-language")).toBe("zh-CN")
    expect(await platformDefaultDetail.json()).toMatchObject({
      resolvedLocale: "zh-CN",
    })
    expect(
      (await query(orgA.id, "", cookie, "")).headers.get("content-language")
    ).toBe("zh-CN")
    await runtime.pool.query(
      "UPDATE organization SET default_locale = $1 WHERE id = $2",
      ["ar", orgA.id]
    )
    const organizationDefaultDetail = await queryDetail(
      orgA.id,
      source.id,
      cookie,
      ""
    )
    expect(organizationDefaultDetail.headers.get("content-language")).toBe("ar")
    expect(await organizationDefaultDetail.json()).toMatchObject({
      resolvedLocale: "zh-CN",
    })
    expect(
      (await query(orgA.id, "", cookie, undefined)).headers.get(
        "content-language"
      )
    ).toBe("en-US")
    await expect(
      runtime.pool.query(
        'UPDATE "user" SET preferred_locale = $1 WHERE id = $2',
        ["fr", contextA.userId]
      )
    ).rejects.toMatchObject({ code: "23514" })
    await expect(
      runtime.pool.query(
        "UPDATE organization SET default_locale = $1 WHERE id = $2",
        ["fr", orgA.id]
      )
    ).rejects.toMatchObject({ code: "23514" })
    await expect(
      runtime.pool.query(
        "UPDATE organization_status SET status = 'SUSPENDED' WHERE organization_id = $1",
        [orgA.id]
      )
    ).rejects.toMatchObject({ code: "42501" })
    const withoutHeader = () => query(orgA.id, "", cookie, "")
    expect((await withoutHeader()).headers.get("content-language")).toBe("ar")
    await runtime.pool.query(
      'UPDATE "user" SET preferred_locale = $1 WHERE id = $2',
      ["en-US", contextA.userId]
    )
    const preferredDetail = await queryDetail(
      orgA.id,
      translated.id,
      cookie,
      ""
    )
    expect(preferredDetail.headers.get("content-language")).toBe("en-US")
    expect(await preferredDetail.json()).toMatchObject({
      resolvedLocale: "en-US",
      name: "English %_ Project",
    })
    expect((await withoutHeader()).headers.get("content-language")).toBe(
      "en-US"
    )
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        query(i % 2 ? orgA.id : orgB.id, "", cookie, i % 2 ? "ar" : "en-US")
      )
    )
    for (const [i, response] of responses.entries()) {
      expect(response.status).toBe(200)
      expect(response.headers.get("content-language")).toBe(
        i % 2 ? "ar" : "en-US"
      )
      expect(response.headers.get("cache-control")).toBe("private, no-store")
    }
    const options = getProjectsListOptions(orgA.id, undefined, "ar")
    const data = await options.queryFn({ signal: new AbortController().signal })
    expect(options.queryKey.at(-1)).toBe("ar")
    expect(data.headers.get("content-language")).toBe("ar")
  })
  it("非法参数、无会话、跨组织请求和404都返回稳定错误契约", async () => {
    const other = await runtime.auth.api.signUpEmail({
      body: {
        name: "Other",
        email: "other-projects@example.test",
        password: randomBytes(24).toString("hex"),
      },
    })
    const outsider = await runtime.auth.api.createOrganization({
      body: { userId: other.user.id, name: "Other", slug: "other-projects" },
    })
    for (const [response, code, status] of [
      [await query(orgA.id, "?pageSize=101"), "VALIDATION_ERROR", 400],
      [await query("invalid"), "VALIDATION_ERROR", 400],
      [await query(orgA.id, "", "", "ar"), "UNAUTHENTICATED", 401],
      [await query(outsider.id), "FORBIDDEN", 403],
      [
        await fetch(`${baseURL}/api/v1/missing`, {
          headers: { "accept-language": "en-US" },
        }),
        "NOT_FOUND",
        404,
      ],
    ]) {
      expect(response.status).toBe(status)
      const error = ApiErrorSchema.parse(await response.json())
      expect(error.code).toBe(code)
      expect(error.requestId).toBe(response.headers.get("x-request-id"))
      expect(error.locale).toBe(response.headers.get("content-language"))
    }
  })
  it("授权失败只使用已验证阶段的语言，成功与错误响应共用语言输出", async () => {
    const response = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        email: "language-stages@example.test",
        password: randomBytes(24).toString("hex"),
        name: "Language stages",
      }),
    })
    expect(response.status).toBe(200)
    const actor = await response.json()
    const actorCookie = response.headers
      .getSetCookie()
      .map((item) => item.split(";")[0])
      .join("; ")
    const ownerHeaders = new Headers({ cookie })
    const organization = await runtime.auth.api.createOrganization({
      headers: ownerHeaders,
      body: { name: "Language stages", slug: "language-stages" },
    })
    await runtime.pool.query(
      "UPDATE organization SET default_locale = $1 WHERE id = $2",
      ["ar", organization.id]
    )
    const expectError = async (result, status, locale) => {
      expect(result.status).toBe(status)
      expect(result.headers.get("content-language")).toBe(locale)
      expect(ApiErrorSchema.parse(await result.json()).locale).toBe(locale)
    }
    // 非成员不能通过语言响应观察到目标组织的 ar 默认值。
    await expectError(await query(organization.id, "", "", ""), 401, "zh-CN")
    await expectError(
      await query(organization.id, "", actorCookie, ""),
      403,
      "zh-CN"
    )
    await runtime.pool.query(
      'UPDATE "user" SET preferred_locale = $1 WHERE id = $2',
      ["en-US", actor.user.id]
    )
    await expectError(
      await query(organization.id, "", actorCookie, ""),
      403,
      "en-US"
    )
    // UUID 在身份验证前拒绝，此时还不能采用用户偏好。
    await expectError(await query("invalid", "", actorCookie, ""), 400, "zh-CN")
    await runtime.auth.api.createOrgRole({
      headers: ownerHeaders,
      body: {
        organizationId: organization.id,
        role: "translator",
        permission: { project: ["translate"] },
      },
    })
    await runtime.auth.api.addMember({
      body: {
        organizationId: organization.id,
        userId: actor.user.id,
        role: "translator",
      },
    })
    await runtime.pool.query(
      'UPDATE "user" SET preferred_locale = NULL WHERE id = $1',
      [actor.user.id]
    )
    await expectError(
      await query(organization.id, "", actorCookie, ""),
      403,
      "ar"
    )
    await expectError(
      await query(organization.id, "", actorCookie, "en-US"),
      403,
      "en-US"
    )
    await expectError(
      await queryDetail(organization.id, source.id, actorCookie, "en-US"),
      403,
      "en-US"
    )
    await runtime.auth.api.updateOrgRole({
      headers: ownerHeaders,
      body: {
        organizationId: organization.id,
        roleName: "translator",
        data: { permission: { project: ["read"] } },
      },
    })
    const success = await query(organization.id, "", actorCookie, "")
    expect(success.status).toBe(200)
    expect(success.headers.get("content-language")).toBe("ar")
    await expectError(
      await query(organization.id, "?pageSize=101", actorCookie, ""),
      400,
      "ar"
    )
  })
  it("创建项目保存基础译文，并可从正式列表读回", async () => {
    const response = await createProject(
      orgB.id,
      {
        name: "  Created project  ",
        description: null,
        contentLocale: "en-US",
      },
      { "Accept-Language": "ar" }
    )
    expect(response.status).toBe(201)
    const created = response.data
    expect(created).toMatchObject({
      organizationId: orgB.id,
      name: "Created project",
      description: null,
      status: "draft",
      contentLocale: "en-US",
      resolvedLocale: "en-US",
    })
    const page = await listProjects(
      orgB.id,
      { name: "Created project" },
      { "Accept-Language": "ar" }
    )
    expect(page.data.items).toEqual([created])
  })
  it("创建审计使用可信身份，组织默认语言独立于请求语言，删除保留审计", async () => {
    await runtime.pool.query(
      "UPDATE organization SET default_locale = 'ar' WHERE id = $1",
      [orgB.id]
    )
    const response = await createProject(
      orgB.id,
      { name: "Arabic base", description: null },
      { "Accept-Language": "en-US" }
    )
    expect(response.data).toMatchObject({
      contentLocale: "ar",
      resolvedLocale: "ar",
      status: "draft",
    })
    const readAudit = (context) =>
      createTenantRunner(runtime.pool)(context, (tx) =>
        tx.select().from(auditEvents)
      )
    const records = await readAudit(contextB)
    const event = records.find((row) => row.resourceId === response.data.id)
    expect(event).toMatchObject({
      eventCode: "project.created",
      actorId: contextB.userId,
      organizationId: orgB.id,
      requestId: response.headers.get("x-request-id"),
      fields: { contentLocale: "ar", status: "draft" },
    })
    expect(event.occurredAt).toBeInstanceOf(Date)
    expect(await readAudit(contextA)).toEqual([])
    await expect(
      createTenantRunner(runtime.pool)(contextA, (tx) =>
        tx.insert(auditEvents).values({ ...event, id: undefined })
      )
    ).rejects.toThrow()
    await expect(
      createTenantRunner(runtime.pool)(contextB, (tx) => tx.delete(auditEvents))
    ).rejects.toThrow()
    await expect(
      createTenantRunner(runtime.pool)(contextB, (tx) =>
        tx.update(auditEvents).set({ eventCode: "changed" })
      )
    ).rejects.toThrow()
    await createTenantRunner(runtime.pool)(contextB, (tx) =>
      projectRepository.delete(tx, response.data.id)
    )
    expect(
      (await readAudit(contextB)).find((row) => row.id === event.id)
    ).toEqual(event)
  })
  it("审计失败时项目和基础译文一起回滚", async () => {
    const counts = () =>
      createTenantRunner(runtime.pool)(contextB, async (tx) => ({
        projects: (await tx.select().from(projects)).length,
        translations: (await tx.select().from(projectTranslations)).length,
        audits: (await tx.select().from(auditEvents)).length,
      }))
    const before = await counts()
    // 在临时库撤销审计写权限，验证真实存储失败，而不是 mock 事务调用顺序。
    await migrator.query("REVOKE INSERT ON audit_events FROM app_runtime")
    try {
      await expect(
        createProject(
          orgB.id,
          { name: "Must rollback", description: null },
          { "Accept-Language": "en-US" }
        )
      ).rejects.toMatchObject({ body: { code: "INTERNAL_ERROR" } })
      expect(await counts()).toEqual(before)
    } finally {
      await migrator.query("GRANT INSERT ON audit_events TO app_runtime")
    }
  })
  it("创建拒绝无会话、非成员、缺少 create 权限以及伪造归属，且不写入", async () => {
    const post = (body, session = cookie) =>
      fetch(`${baseURL}/api/v1/organizations/${orgB.id}/projects`, {
        method: "POST",
        headers: { cookie: session, "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    const valid = { name: "Denied create", description: null }
    const before = (
      await listProjects(orgB.id, undefined, { "Accept-Language": "en-US" })
    ).data.total
    expect((await post(valid, "")).status).toBe(401)
    for (const body of [
      { ...valid, organizationId: orgA.id },
      { ...valid, actorId: contextA.userId },
      { ...valid, name: "   " },
      { ...valid, contentLocale: "fr" },
      { ...valid, status: "active" },
    ])
      expect((await post(body)).status).toBe(400)
    const signup = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Read only",
        email: "create-denied@example.test",
        password: randomBytes(24).toString("hex"),
      }),
    })
    const actor = await signup.json()
    const session = signup.headers
      .getSetCookie()
      .map((item) => item.split(";")[0])
      .join("; ")
    expect((await post(valid, session)).status).toBe(403)
    await runtime.auth.api.createOrgRole({
      headers: new Headers({ cookie }),
      body: {
        organizationId: orgB.id,
        role: "reader",
        permission: { project: ["read"] },
      },
    })
    await runtime.auth.api.addMember({
      body: { organizationId: orgB.id, userId: actor.user.id, role: "reader" },
    })
    expect((await post(valid, session)).status).toBe(403)
    expect(
      (await listProjects(orgB.id, undefined, { "Accept-Language": "en-US" }))
        .data.total
    ).toBe(before)
  })
  it("更新按实际字段授权，维护原始目标译文并与审计同事务提交", async () => {
    const editable = await createTenantRunner(runtime.pool)(contextB, (tx) =>
      projectRepository.create(tx, {
        name: "更新前中文名称",
        description: "更新前中文描述",
        contentLocale: "zh-CN",
      })
    )
    const ownerUpdate = await patchProject(
      orgB.id,
      editable.id,
      {
        status: "active",
        translation: {
          locale: "en-US",
          name: "  Updated English name  ",
          description: null,
        },
      },
      cookie,
      "en-US"
    )
    expect(ownerUpdate.status).toBe(200)
    expect(await ownerUpdate.json()).toMatchObject({
      id: editable.id,
      organizationId: orgB.id,
      status: "active",
      contentLocale: "zh-CN",
      resolvedLocale: "en-US",
      name: "Updated English name",
      description: null,
    })
    const english = await queryTranslation(orgB.id, editable.id, "en-US")
    expect(english.status).toBe(200)
    expect(await english.json()).toEqual({
      locale: "en-US",
      name: "Updated English name",
      description: null,
    })
    const chinese = await queryTranslation(orgB.id, editable.id, "zh-CN")
    expect(chinese.status).toBe(200)
    expect(await chinese.json()).toEqual({
      locale: "zh-CN",
      name: "更新前中文名称",
      description: "更新前中文描述",
    })
    const signup = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Project translator",
        email: "project-translator@example.test",
        password: randomBytes(24).toString("hex"),
      }),
    })
    expect(signup.status).toBe(200)
    const translator = await signup.json()
    const translatorCookie = signup.headers
      .getSetCookie()
      .map((item) => item.split(";")[0])
      .join("; ")
    await runtime.auth.api.createOrgRole({
      headers: new Headers({ cookie }),
      body: {
        organizationId: orgB.id,
        role: "project-translator",
        permission: { project: ["translate"] },
      },
    })
    await runtime.auth.api.addMember({
      body: {
        organizationId: orgB.id,
        userId: translator.user.id,
        role: "project-translator",
      },
    })
    const translatorUpdate = await patchProject(
      orgB.id,
      editable.id,
      { translation: { locale: "zh-CN", description: null } },
      translatorCookie
    )
    expect(translatorUpdate.status).toBe(200)
    const translatedChinese = await queryTranslation(
      orgB.id,
      editable.id,
      "zh-CN",
      translatorCookie
    )
    expect(await translatedChinese.json()).toEqual({
      locale: "zh-CN",
      name: "更新前中文名称",
      description: null,
    })
    const forbiddenMixedUpdate = await patchProject(
      orgB.id,
      editable.id,
      {
        status: "archived",
        translation: { locale: "ar", name: "اسم مشروع", description: null },
      },
      translatorCookie
    )
    expect(forbiddenMixedUpdate.status).toBe(403)
    expect(await queryTranslation(orgB.id, editable.id, "ar")).toMatchObject({
      status: 404,
    })
    expect(
      (await getProject(orgB.id, editable.id, { "Accept-Language": "en-US" }))
        .data.status
    ).toBe("active")

    const arabicUpdate = await patchProject(orgB.id, editable.id, {
      translation: {
        locale: "ar",
        name: "مشروع محدّث",
        description: "وصف عربي",
      },
    })
    expect(arabicUpdate.status).toBe(200)
    expect(await queryTranslation(orgB.id, editable.id, "ar")).toMatchObject({
      status: 200,
    })

    const archivedUpdate = await patchProject(orgB.id, editable.id, {
      status: "archived",
    })
    expect(archivedUpdate.status).toBe(200)
    const archivedContentUpdate = await patchProject(orgB.id, editable.id, {
      translation: { locale: "ar", description: "归档后仍可编辑" },
    })
    expect(archivedContentUpdate.status).toBe(200)
    const sameStatusUpdate = await patchProject(orgB.id, editable.id, {
      status: "archived",
    })
    expect(sameStatusUpdate.status).toBe(200)

    await runtime.auth.api.updateOrgRole({
      headers: new Headers({ cookie }),
      body: {
        organizationId: orgB.id,
        roleName: "project-translator",
        data: { permission: { project: ["read"] } },
      },
    })
    expect(
      (
        await patchProject(
          orgB.id,
          editable.id,
          { translation: { locale: "en-US", description: "Revoked" } },
          translatorCookie
        )
      ).status
    ).toBe(403)

    for (const body of [
      { contentLocale: "en-US" },
      { organizationId: orgA.id },
      { translation: { locale: "ar", name: "   " } },
    ])
      expect((await patchProject(orgB.id, editable.id, body)).status).toBe(400)
    expect(
      (
        await patchProject(orgA.id, editable.id, {
          translation: { locale: "ar", description: "cross org" },
        })
      ).status
    ).toBe(404)

    const records = await createTenantRunner(runtime.pool)(contextB, (tx) =>
      tx.select().from(auditEvents)
    )
    expect(
      records.filter((record) => record.resourceId === editable.id)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventCode: "project.updated",
          fields: { status: "active" },
        }),
        expect.objectContaining({
          eventCode: "project.translation.updated",
          fields: { locale: "en-US" },
        }),
        expect.objectContaining({
          eventCode: "project.translation.updated",
          fields: { locale: "zh-CN" },
        }),
        expect.objectContaining({
          eventCode: "project.translation.updated",
          fields: { locale: "ar" },
        }),
        expect.objectContaining({
          eventCode: "project.updated",
          fields: { status: "archived" },
        }),
      ])
    )
    expect(
      records.filter(
        (record) =>
          record.resourceId === editable.id &&
          record.eventCode === "project.updated" &&
          record.fields.status === "archived"
      )
    ).toHaveLength(1)
  })
  it("审计写入失败时更新与译文写入一起回滚", async () => {
    const editable = await createTenantRunner(runtime.pool)(contextB, (tx) =>
      projectRepository.create(tx, {
        name: "回滚项目",
        description: "保留描述",
        contentLocale: "zh-CN",
      })
    )
    await migrator.query("REVOKE INSERT ON audit_events FROM app_runtime")
    try {
      expect(
        (
          await patchProject(orgB.id, editable.id, {
            status: "archived",
            translation: {
              locale: "zh-CN",
              name: "不应持久化",
              description: null,
            },
          })
        ).status
      ).toBe(500)
      const response = await getProject(orgB.id, editable.id, {
        "Accept-Language": "zh-CN",
      })
      expect(response.data).toMatchObject({
        status: "draft",
        name: "回滚项目",
        description: "保留描述",
      })
    } finally {
      await migrator.query("GRANT INSERT ON audit_events TO app_runtime")
    }
  })
  it("硬删除独立的多语言项目，保留删除审计并拒绝越权删除", async () => {
    const deleted = await createTenantRunner(runtime.pool)(
      contextB,
      async (tx) => {
        const project = await projectRepository.create(tx, {
          name: "待删除中文项目",
          description: "中文描述",
          contentLocale: "zh-CN",
        })
        await tx.insert(projectTranslations).values([
          {
            organizationId: orgB.id,
            projectId: project.id,
            locale: "en-US",
            name: "Project to delete",
            description: "English description",
          },
          {
            organizationId: orgB.id,
            projectId: project.id,
            locale: "ar",
            name: "مشروع للحذف",
            description: "وصف عربي",
          },
        ])
        return project
      }
    )
    const signup = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Delete denied",
        email: "delete-denied@example.test",
        password: randomBytes(24).toString("hex"),
      }),
    })
    const deniedActor = await signup.json()
    const deniedCookie = signup.headers
      .getSetCookie()
      .map((item) => item.split(";")[0])
      .join("; ")
    await runtime.auth.api.createOrgRole({
      headers: new Headers({ cookie }),
      body: {
        organizationId: orgB.id,
        role: "delete-reader",
        permission: { project: ["read"] },
      },
    })
    await runtime.auth.api.addMember({
      body: {
        organizationId: orgB.id,
        userId: deniedActor.user.id,
        role: "delete-reader",
      },
    })
    const forbidden = await deleteProjectRequest(
      orgB.id,
      deleted.id,
      deniedCookie
    )
    expect(forbidden.status).toBe(403)
    expect(ApiErrorSchema.parse(await forbidden.json()).code).toBe("FORBIDDEN")
    expect((await deleteProjectRequest(orgA.id, deleted.id)).status).toBe(404)

    const response = await deleteProject(orgB.id, deleted.id)
    expect(response.status).toBe(204)
    expect((await queryDetail(orgB.id, deleted.id)).status).toBe(404)
    for (const locale of ["zh-CN", "en-US", "ar"])
      expect((await queryTranslation(orgB.id, deleted.id, locale)).status).toBe(
        404
      )

    const state = await createTenantRunner(runtime.pool)(
      contextB,
      async (tx) => ({
        project: await projectRepository.find(tx, deleted.id),
        translations: await projectRepository.translations(tx, deleted.id),
        audits: await tx.select().from(auditEvents),
      })
    )
    expect(state.project).toBeUndefined()
    expect(state.translations).toEqual([])
    expect(state.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventCode: "project.deleted",
          resourceId: deleted.id,
          organizationId: orgB.id,
          actorId: contextB.userId,
          fields: { status: "draft", contentLocale: "zh-CN" },
        }),
      ])
    )
    expect((await deleteProjectRequest(orgB.id, deleted.id)).status).toBe(404)
  })
  it("删除审计写入失败时，项目与全部译文一起回滚", async () => {
    const retained = await createTenantRunner(runtime.pool)(
      contextB,
      async (tx) => {
        const project = await projectRepository.create(tx, {
          name: "必须保留的项目",
          description: null,
          contentLocale: "zh-CN",
        })
        await tx.insert(projectTranslations).values({
          organizationId: orgB.id,
          projectId: project.id,
          locale: "en-US",
          name: "Must remain",
          description: null,
        })
        return project
      }
    )
    await migrator.query("REVOKE INSERT ON audit_events FROM app_runtime")
    try {
      expect((await deleteProjectRequest(orgB.id, retained.id)).status).toBe(
        500
      )
      expect((await queryDetail(orgB.id, retained.id)).status).toBe(200)
      expect(
        (await queryTranslation(orgB.id, retained.id, "en-US")).status
      ).toBe(200)
      const audits = await createTenantRunner(runtime.pool)(contextB, (tx) =>
        tx.select().from(auditEvents)
      )
      expect(
        audits.filter(
          (event) =>
            event.resourceId === retained.id &&
            event.eventCode === "project.deleted"
        )
      ).toEqual([])
    } finally {
      await migrator.query("GRANT INSERT ON audit_events TO app_runtime")
    }
  })
  it("基础译文缺失返回500，不悄悄隐藏项目", async () => {
    await createTenantRunner(runtime.pool)(contextA, (tx) =>
      tx.delete(projectTranslations)
    )
    const response = await query(orgA.id)
    expect(response.status).toBe(500)
    const body = ApiErrorSchema.parse(await response.json())
    expect(body.code).toBe("INTERNAL_ERROR")
    expect(body.message).toBe("Internal server error")
    const detailResponse = await queryDetail(orgA.id, source.id)
    expect(detailResponse.status).toBe(500)
    expect(ApiErrorSchema.parse(await detailResponse.json()).code).toBe(
      "INTERNAL_ERROR"
    )
    expect((await query(orgB.id)).status).toBe(200)
  })
})
