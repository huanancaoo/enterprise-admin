import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createAuth,
  noopAuthEmailHooks,
} from "../../packages/database/src/auth"
import { createDatabase } from "../../packages/database/src/index"

afterEach(() => vi.unstubAllEnvs())

describe("Better Auth OpenAPI HTTP boundary", () => {
  it.each(["development", "production"])(
    "%s keeps static schema generation independent of runtime documentation access",
    async (environment) => {
      vi.stubEnv("NODE_ENV", environment)
      const { pool } = createDatabase(
        "postgresql://localhost/openapi_metadata_only"
      )
      const unusedStorage = (): never => {
        throw new Error("OpenAPI metadata must not use secondary storage")
      }
      const increment = vi.fn(async () => 1)
      const query = vi.spyOn(pool, "query").mockImplementation(() => {
        throw new Error("OpenAPI metadata must not query the database")
      })
      const auth = createAuth(
        pool,
        "http://localhost:3000",
        "openapi-metadata-only-not-a-runtime-secret",
        [],
        noopAuthEmailHooks,
        {
          get: unusedStorage,
          getAndDelete: unusedStorage,
          set: unusedStorage,
          delete: unusedStorage,
          increment,
        },
        [],
        { clientId: "openapi-only", clientSecret: "openapi-only" }
      )

      try {
        const schema = await auth.api.generateOpenAPISchema()
        expect(schema.openapi).toBe("3.1.1")
        expect(schema.servers).toEqual([
          { url: "http://localhost:3000/api/auth" },
        ])
        expect(schema.paths["/sign-in/email"]).toBeDefined()
        expect(schema.paths["/organization/create"]).toBeDefined()
        expect(schema.paths["/two-factor/verify-totp"]).toBeDefined()
        expect(schema.paths["/api-key/create"]).toBeUndefined()
        // 静态导出不走 HTTP 限流；公开文档请求仍使用正式限流入口。
        expect(increment).not.toHaveBeenCalled()

        for (const path of ["/reference", "/open-api/generate-schema"]) {
          const response = await auth.handler(
            new Request(`http://localhost:3000/api/auth${path}`)
          )
          expect(response.status).toBe(environment === "production" ? 404 : 200)
          if (environment === "production") continue
          if (path === "/reference") {
            expect(response.headers.get("content-type")).toContain("text/html")
            expect(await response.text()).toContain("Scalar API Reference")
          } else {
            expect(await response.json()).toEqual(schema)
          }
        }
        expect(query).not.toHaveBeenCalled()
      } finally {
        query.mockRestore()
        await pool.end()
      }
    }
  )
})
