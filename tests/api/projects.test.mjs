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
const { AuthRuntime } = require("../../apps/api/dist/auth-runtime.js")
const {
  TenantContextService,
} = require("../../apps/api/dist/tenant-context.service.js")
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
  configureApiClient,
  getProjectsListOptions,
} from "../../packages/api-client/src/index.ts"

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
    translated
  const origin = "http://localhost:3200"
  const query = (id, suffix = "", session = cookie, locale = "en-US") =>
    fetch(`${baseURL}/api/v1/organizations/${id}/projects${suffix}`, {
      headers: {
        cookie: session,
        ...(locale ? { "accept-language": locale } : {}),
      },
    })
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
      { locale: "zh-CN" }
    )
    contextB = await service.resolve(
      headers,
      orgB.id,
      { project: ["create"] },
      "seed-b",
      { locale: "zh-CN" }
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
    expect(
      (await query(orgA.id, "", cookie, "")).headers.get("content-language")
    ).toBe("zh-CN")
    await runtime.pool.query(
      "UPDATE organization SET default_locale = $1 WHERE id = $2",
      ["ar", orgA.id]
    )
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
        "UPDATE organization SET enabled = false WHERE id = $1",
        [orgA.id]
      )
    ).rejects.toMatchObject({ code: "42501" })
    const withoutHeader = () => query(orgA.id, "", cookie, "")
    expect((await withoutHeader()).headers.get("content-language")).toBe("ar")
    await runtime.pool.query(
      'UPDATE "user" SET preferred_locale = $1 WHERE id = $2',
      ["en-US", contextA.userId]
    )
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
  it("基础译文缺失返回500，不悄悄隐藏项目", async () => {
    await createTenantRunner(runtime.pool)(contextA, (tx) =>
      tx.delete(projectTranslations)
    )
    const response = await query(orgA.id)
    expect(response.status).toBe(500)
    const body = ApiErrorSchema.parse(await response.json())
    expect(body.code).toBe("INTERNAL_ERROR")
    expect(body.message).toBe("Internal server error")
    expect((await query(orgB.id)).status).toBe(200)
  })
})
