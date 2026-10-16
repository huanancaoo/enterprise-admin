import { expect, test } from "vitest"
import { openapi } from "../lib/openapi"

test("business and authentication snapshots produce distinct, navigable API pages", async () => {
  const source = await openapi.staticSource({
    baseDir: "reference/api",
    groupBy: "tag",
  })
  const pages = source.files.filter((file) => file.type === "page")
  const paths = pages.map((page) => page.path)
  expect(new Set(paths).size).toBe(paths.length)

  for (const [path, method] of [
    ["/sign-in/email", "post"],
    ["/organization/create", "post"],
    ["/two-factor/verify-totp", "post"],
  ]) {
    const page = pages.find((entry) =>
      entry.data
        .getOpenAPIPageProps()
        .operations?.some(
          (operation) => operation.path === path && operation.method === method
        )
    )
    expect(page, `${method} ${path}`).toBeDefined()
    expect(page!.data.getSchema().id).toBe("../api/openapi/auth-openapi.json")
    expect(page!.data.getSchema().bundled.servers).toEqual([
      { url: "http://localhost:3000/api/auth" },
    ])
  }

  expect(
    pages.some(
      (page) => page.data.getSchema().id === "../api/openapi/openapi.json"
    )
  ).toBe(true)
})
