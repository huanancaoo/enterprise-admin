import assert from "node:assert/strict"
import { describe, beforeAll, afterAll, test } from "vitest"
import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { z } from "zod"
import * as schema from "./auth-schema.js"
import { createAuth } from "./auth.js"
import { startProbe } from "./probe.js"

describe(
  "S0: PostgreSQL → Drizzle → Better Auth/Organization → NestJS → Zod → OpenAPI → Orval",
  { concurrent: false },
  () => {
    let container: StartedTestContainer | undefined
    let owner: Pool | undefined
    let runtime: Pool
    let probe: Awaited<ReturnType<typeof startProbe>>
    let url: string
    let auth: Awaited<ReturnType<typeof startProbe>>["auth"]
    let document: Awaited<ReturnType<typeof startProbe>>["document"]

    // 后续 UUID 验证使用首个用例创建的组织，整个探针必须串行执行。
    beforeAll(async () => {
      const versions = JSON.parse(
        await readFile("../../docs/architecture/versions.json", "utf8")
      )
      const password = randomBytes(24).toString("hex")
      container = await new GenericContainer(versions.postgresql.image)
        .withEnvironment({ POSTGRES_PASSWORD: password, POSTGRES_DB: "s0" })
        .withExposedPorts(5432)
        .withWaitStrategy(
          Wait.forLogMessage(
            "database system is ready to accept connections",
            2
          )
        )
        .start()
      const config = {
        host: container.getHost(),
        port: container.getMappedPort(5432),
        database: "s0",
      }
      owner = new Pool({ ...config, user: "postgres", password })
      await migrate(drizzle(owner), { migrationsFolder: "./migrations" })
      const server = await owner!.query("SHOW server_version")
      assert.match(server.rows[0].server_version, /^18\.6\b/)

      // 只向这个即将销毁的测试库授权；S2 另行建立生产 bootstrap/migrator 链。
      const runtimePassword = randomBytes(24).toString("hex")
      await owner!.query(
        `CREATE ROLE s0_runtime LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`
      )
      await owner!.query("GRANT USAGE ON SCHEMA public TO s0_runtime")
      await owner!.query(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO s0_runtime"
      )
      runtime = new Pool({
        ...config,
        user: "s0_runtime",
        password: runtimePassword,
      })
      probe = await startProbe((baseURL) =>
        createAuth(runtime, baseURL, schema)
      )
      ;({ url, auth, document } = probe)
    })

    // 先关闭 HTTP，再释放连接池，最后销毁容器；初始化失败也清理已取得的资源。
    afterAll(async () => {
      try {
        await probe?.app.close()
      } finally {
        try {
          await runtime?.end()
        } finally {
          try {
            await owner?.end()
          } finally {
            await container?.stop()
          }
        }
      }
    })

    let cookie = ""
    async function authRequest(path: string, body?: unknown) {
      const response = await fetch(`${url}/api/auth/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: url,
          Cookie: cookie,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const cookies = response.headers.getSetCookie()
      if (cookies.length)
        cookie = cookies.map((item) => item.split(";")[0]).join("; ")
      const data = await response.json()
      assert.equal(response.status, 200, JSON.stringify(data))
      return data
    }

    test("真实 HTTP 注册、登录、创建组织、设置工作区及权限查询", async () => {
      const credentials = {
        email: "s0@example.test",
        password: randomBytes(20).toString("hex"),
      }
      const signup = await authRequest("sign-up/email", {
        ...credentials,
        name: "S0",
      })
      z.uuid().parse(signup.user.id)
      await authRequest("sign-out", {})
      await authRequest("sign-in/email", credentials)
      const organization = await authRequest("organization/create", {
        name: "S0",
        slug: "s0",
      })
      z.uuid().parse(organization.id)
      await authRequest("organization/set-active", {
        organizationId: organization.id,
      })
      const session = await authRequest("get-session")
      assert.equal(session.session.activeOrganizationId, organization.id)
      const member = await runtime.query(
        "SELECT id, organization_id FROM member WHERE user_id = $1",
        [signup.user.id]
      )
      z.uuid().parse(member.rows[0].id)
      assert.equal(member.rows[0].organization_id, organization.id)
      const allowed = await auth.api.hasPermission({
        headers: new Headers({ cookie }),
        body: {
          organizationId: organization.id,
          permissions: { project: ["create"] },
        },
      })
      assert.equal(allowed.success, true)
      await authRequest("organization/create-role", {
        organizationId: organization.id,
        role: "reader",
        permission: { project: ["read"] },
      })
      const roles = await runtime.query(
        "SELECT organization_id FROM organization_role WHERE role = $1",
        ["reader"]
      )
      assert.equal(roles.rows[0].organization_id, organization.id)
      await authRequest("sign-out", {})
      assert.equal(await authRequest("get-session"), null)
    })

    test("所有认证组织引用生成 UUID，业务外键及 RLS cast 使用同一类型", async () => {
      const columns = await owner!
        .query(`SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND ((table_name = 'organization' AND column_name = 'id')
      OR column_name IN ('organization_id', 'active_organization_id'))`)
      assert.equal(columns.rows.length, 5)
      for (const column of columns.rows)
        assert.equal(column.data_type, "uuid", JSON.stringify(column))
      await owner!.query(
        "CREATE TABLE uuid_probe (organization_id uuid NOT NULL REFERENCES organization(id))"
      )
      await owner!.query("ALTER TABLE uuid_probe ENABLE ROW LEVEL SECURITY")
      await owner!
        .query(`CREATE POLICY uuid_probe_scope ON uuid_probe TO s0_runtime
      USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid)`)
      await owner!.query("GRANT SELECT, INSERT ON uuid_probe TO s0_runtime")
      const organization = await owner!.query(
        "SELECT id FROM organization LIMIT 1"
      )
      const id = organization.rows[0].id
      const connection = await runtime.connect()
      try {
        await connection.query("BEGIN")
        await connection.query(
          "SELECT set_config('app.organization_id', $1, true)",
          [id]
        )
        await connection.query("INSERT INTO uuid_probe VALUES ($1)", [id])
        assert.equal(
          (await connection.query("SELECT * FROM uuid_probe")).rowCount,
          1
        )
        await connection.query("COMMIT")
        assert.equal(
          (await connection.query("SELECT * FROM uuid_probe")).rowCount,
          0
        )
      } finally {
        connection.release()
      }
    })

    test("合法/非法 Body、UUID Path 和 Query coercion 经过真实 HTTP 校验", async () => {
      const body = { organizationId: randomUUID(), name: "Probe" }
      const post = (value: unknown) =>
        fetch(`${url}/api/v1/probe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        })
      const valid = await post(body)
      assert.equal(valid.status, 201)
      assert.deepEqual(await valid.json(), body)
      for (const invalid of [
        { ...body, name: "" },
        { ...body, organizationId: "org_1" },
        { ...body, extra: true },
      ]) {
        assert.equal((await post(invalid)).status, 400)
      }
      const list = await fetch(
        `${url}/api/v1/probe/${body.organizationId}?page=2`
      )
      assert.deepEqual(await list.json(), {
        organizationId: body.organizationId,
        page: 2,
      })
      assert.equal((await fetch(`${url}/api/v1/probe/not-uuid`)).status, 400)
      assert.equal(
        (await fetch(`${url}/api/v1/probe/${body.organizationId}?page=0`))
          .status,
        400
      )
    })

    test("同一个 Zod 字段进入 OpenAPI 和可执行的 Orval SDK", async () => {
      await mkdir(".artifacts", { recursive: true })
      await writeFile(
        ".artifacts/openapi.json",
        JSON.stringify(document, null, 2) + "\n"
      )
      assert.equal(
        document.paths["/api/v1/probe"]?.post?.operationId,
        "createProbe"
      )
      const operation = document.paths["/api/v1/probe"]!.post!
      const request = operation.requestBody!
      const response = operation.responses["201"]!
      assert.ok("content" in request)
      assert.ok("content" in response)
      // 原生 Swagger 内联 Schema；直接验证请求和响应契约，不依赖 DTO 组件名称。
      for (const contract of [
        request.content["application/json"]!.schema!,
        response.content!["application/json"]!.schema!,
      ]) {
        assert.ok("properties" in contract)
        const organizationId = contract.properties!.organizationId!
        const name = contract.properties!.name!
        assert.ok("format" in organizationId)
        assert.ok("minLength" in name)
        assert.equal(organizationId.format, "uuid")
        assert.equal(name.minLength, 1)
        assert.equal(name.maxLength, 80)
        assert.deepEqual(contract.required, ["organizationId", "name"])
        assert.equal(contract.additionalProperties, false)
      }
      execFileSync("pnpm", ["exec", "orval", "--config", "orval.config.ts"], {
        stdio: "inherit",
      })
      execFileSync(
        "pnpm",
        [
          "exec",
          "tsc",
          "--ignoreConfig",
          "--target",
          "ES2023",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--skipLibCheck",
          "--strict",
          "--outDir",
          ".artifacts/sdk",
          "generated/client.ts",
        ],
        { stdio: "inherit" }
      )
      const sdk = await import(
        new URL("../.artifacts/sdk/client.js", import.meta.url).href
      )
      const originalFetch = globalThis.fetch
      // Node 没有浏览器 origin；仅补测试 Host，仍调用生成 SDK 的真实序列化与 HTTP 代码。
      globalThis.fetch = (input, init) =>
        originalFetch(new URL(String(input), url), init)
      try {
        const body = { organizationId: randomUUID(), name: "Generated SDK" }
        const response = await sdk.createProbe(body)
        assert.equal(response.status, 201)
        assert.deepEqual(response.data, body)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  }
)
