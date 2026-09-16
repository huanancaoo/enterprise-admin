import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { setupServer } from "msw/node"
import { ApiErrorSchema, ProjectPageSchema } from "@workspace/contracts"
import {
  createProjectEditHandlers,
  organizations,
  projectFixtures,
  projectScenarios,
} from "../src/index"

const server = setupServer(...projectScenarios.success)
const url = (organizationId = organizations[0].id as string) =>
  `http://mock.test/api/v1/organizations/${organizationId}/projects`
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe("shared Projects MSW contracts", () => {
  it("uses the list contract for filtering, ordering, paging and tenant scope", async () => {
    const response = await fetch(`${url()}?status=active&page=2&pageSize=2`, {
      headers: { "Accept-Language": "ar" },
    })
    const page = ProjectPageSchema.parse(await response.json())
    expect(page).toMatchObject({ page: 2, pageSize: 2, total: 9 })
    expect(page.items).toHaveLength(2)
    expect(
      page.items.every(
        (row) =>
          row.organizationId === organizations[0].id &&
          row.status === "active" &&
          row.resolvedLocale === "ar"
      )
    ).toBe(true)
    expect(page.items[0]!.createdAt > page.items[1]!.createdAt).toBe(true)
    expect(response.headers.get("Content-Language")).toBe("ar")
    const other = ProjectPageSchema.parse(
      await (await fetch(url(organizations[1].id))).json()
    )
    expect(
      other.items.every((row) => row.organizationId === organizations[1].id)
    ).toBe(true)
    expect(
      other.items.some((row) => page.items.some((first) => first.id === row.id))
    ).toBe(false)
  })
  it("preserves total and requested page for an out-of-range result", async () => {
    const page = ProjectPageSchema.parse(
      await (await fetch(`${url()}?page=50`)).json()
    )
    expect(page).toMatchObject({ page: 50, total: 26, items: [] })
  })
  it("matches name against the returned localized representation", async () => {
    const page = ProjectPageSchema.parse(
      await (
        await fetch(`${url()}?name=Office%20space%201-25`, {
          headers: { "Accept-Language": "en-US" },
        })
      ).json()
    )
    expect(page.total).toBe(1)
    expect(page.items[0]!.name).toBe("Office space 1-25")
  })
  it.each([
    ["forbidden", 403, "FORBIDDEN"],
    ["serverError", 500, "INTERNAL_ERROR"],
  ] as const)(
    "returns structured %s errors",
    async (scenario, status, code) => {
      server.use(...projectScenarios[scenario])
      const response = await fetch(url())
      expect(response.status).toBe(status)
      expect(ApiErrorSchema.parse(await response.json()).code).toBe(code)
    }
  )
  it("rejects invalid list parameters", async () => {
    const response = await fetch(`${url()}?page=0`)
    expect(response.status).toBe(400)
    expect(ApiErrorSchema.parse(await response.json()).code).toBe(
      "VALIDATION_ERROR"
    )
  })
  it("provides the raw target-language content endpoint used by the editor", async () => {
    const project = projectFixtures(organizations[0].id, "zh-CN")[0]!
    server.use(...createProjectEditHandlers())
    const response = await fetch(`${url()}/${project.id}/translations/en-US`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      locale: "en-US",
      name: "Original en-US content",
      description: null,
    })
  })
  it("accepts the editor update payload", async () => {
    const project = projectFixtures(organizations[0].id, "zh-CN")[0]!
    server.use(...createProjectEditHandlers())
    const response = await fetch(`${url()}/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "archived",
        translation: {
          locale: "ar",
          name: "اسم المشروع",
          description: null,
        },
      }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: project.id,
      status: "archived",
    })
  })
})
