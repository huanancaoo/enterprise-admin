import { delay, http, HttpResponse } from "msw"
import {
  PlatformSystemQuerySchema,
  PlatformDictionaryItemsQuerySchema,
  PlatformSystemTreeQuerySchema,
  type PlatformPost,
  type PlatformDepartment,
} from "@workspace/contracts/platform-system"

export type PlatformCatalogScenario =
  "success" | "empty" | "loading" | "error" | "saveError"
const timestamp = "2026-10-17T00:00:00.000Z"
const makeId = (n: number) =>
  `c7dd0a27-4f8a-4aef-8d4c-${String(n).padStart(12, "0")}`
export const catalogDictionaryId = makeId(100)

export function createPlatformCatalogScenario(
  scenario: PlatformCatalogScenario = "success"
) {
  const original = Array.from({ length: 25 }, (_, index) => ({
    id: makeId(index + 1),
    key: `post_${index + 1}`,
    name: `Post ${index + 1}`,
    status: index === 1 ? ("disabled" as const) : ("active" as const),
    sort: index,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
  let posts: PlatformPost[] = structuredClone(original)
  const departments: PlatformDepartment[] = [
    {
      ...original[0]!,
      id: makeId(200),
      key: "operations",
      name: "Operations",
      parentId: null,
      hasChildren: true,
    },
    {
      ...original[1]!,
      id: makeId(201),
      key: "support",
      name: "Support",
      parentId: makeId(200),
      hasChildren: false,
    },
  ]
  const queries: URLSearchParams[] = []
  const writes: unknown[] = []
  const failure = () =>
    HttpResponse.json(
      {
        code: "INTERNAL_ERROR",
        message: "Catalog request failed",
        locale: "en-US",
        requestId: "catalog-story",
      },
      { status: 503 }
    )
  const beforeRead = async () => {
    if (scenario === "loading") await delay("infinite")
  }
  const paged = (
    rows: Record<string, unknown>[],
    params: URLSearchParams,
    items = false
  ) => {
    const search = items
      ? PlatformDictionaryItemsQuerySchema.parse(Object.fromEntries(params))
      : PlatformSystemQuerySchema.parse(Object.fromEntries(params))
    const matching = rows.filter(
      (row) =>
        (!search.q ||
          `${row.key ?? row.value} ${row.name ?? row.label}`
            .toLowerCase()
            .includes(search.q.toLowerCase())) &&
        (!search.status || row.status === search.status)
    )
    matching.sort((left, right) => {
      const a = left[search.sortBy] as string | number
      const b = right[search.sortBy] as string | number
      const result =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b))
      return search.sortOrder === "desc" ? -result : result
    })
    return {
      items: matching.slice(
        (search.page - 1) * search.pageSize,
        search.page * search.pageSize
      ),
      page: search.page,
      pageSize: search.pageSize,
      total: matching.length,
    }
  }
  const handlers = [
    http.get("*/api/v1/platform/posts", async ({ request }) => {
      await beforeRead()
      if (scenario === "error") return failure()
      const params = new URL(request.url).searchParams
      queries.push(params)
      return HttpResponse.json(paged(scenario === "empty" ? [] : posts, params))
    }),
    http.post("*/api/v1/platform/posts", async ({ request }) => {
      const body = (await request.json()) as Omit<
        PlatformPost,
        "id" | "createdAt" | "updatedAt"
      >
      writes.push(body)
      if (scenario === "saveError") return failure()
      const post = {
        ...body,
        id: makeId(1000 + posts.length),
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      posts.push(post)
      return HttpResponse.json(post, { status: 201 })
    }),
    http.patch("*/api/v1/platform/posts/:id", async ({ request, params }) => {
      const body = await request.json()
      writes.push(body)
      if (scenario === "saveError") return failure()
      const index = posts.findIndex((post) => post.id === params.id)
      posts[index] = { ...posts[index]!, ...(body as object) }
      return HttpResponse.json(posts[index])
    }),
    http.delete("*/api/v1/platform/posts/:id", ({ params }) => {
      if (scenario === "saveError") return failure()
      posts = posts.filter((post) => post.id !== params.id)
      return HttpResponse.json({ id: params.id, deleted: true })
    }),
    http.get("*/api/v1/platform/dictionaries", async ({ request }) => {
      await beforeRead()
      const params = new URL(request.url).searchParams
      return HttpResponse.json(
        paged(
          [
            {
              ...original[0],
              id: catalogDictionaryId,
              key: "account_status",
              name: "Account status",
              remark: "Available states",
            },
          ],
          params
        )
      )
    }),
    http.get(
      "*/api/v1/platform/dictionaries/:dictionaryId/items",
      ({ request, params }) =>
        HttpResponse.json(
          paged(
            [
              {
                id: makeId(101),
                dictionaryId: params.dictionaryId,
                value: "active",
                label: "Active",
                status: "active",
                sort: 0,
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            ],
            new URL(request.url).searchParams,
            true
          )
        )
    ),
    http.get("*/api/v1/platform/parameters", ({ request }) =>
      HttpResponse.json(
        paged(
          [
            {
              ...original[0],
              key: "support_hours",
              name: "Support hours",
              value: "09:00–18:00",
              remark: null,
            },
          ],
          new URL(request.url).searchParams
        )
      )
    ),
    http.get("*/api/v1/platform/departments", async ({ request }) => {
      await beforeRead()
      if (scenario === "error") return failure()
      const params = new URL(request.url).searchParams
      queries.push(params)
      const search = PlatformSystemTreeQuerySchema.parse(
        Object.fromEntries(params)
      )
      const nodes = departments
      const ancestors: typeof nodes = []
      let parent = nodes.find((node) => node.id === search.parentId)
      while (parent) {
        ancestors.unshift(parent)
        parent = nodes.find((node) => node.id === parent!.parentId)
      }
      return HttpResponse.json({
        items: nodes.filter(
          (node) =>
            node.parentId === (search.parentId ?? null) &&
            (!search.q ||
              `${node.key} ${node.name}`
                .toLowerCase()
                .includes(search.q.toLowerCase())) &&
            (!search.status || node.status === search.status)
        ),
        ancestors,
      })
    }),
    http.post("*/api/v1/platform/dictionaries/cache/refresh", () =>
      HttpResponse.json({ refreshed: true, version: 2 })
    ),
    http.post("*/api/v1/platform/parameters/cache/refresh", () =>
      HttpResponse.json({ refreshed: true, version: 2 })
    ),
  ]
  return {
    handlers,
    queries,
    writes,
    reset: () => {
      posts = structuredClone(original)
      queries.length = 0
      writes.length = 0
    },
  }
}
