import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ApiClientError,
  configureApiClient,
  getProjectsListOptions,
  projectKeys,
} from "../../packages/api-client/src/index"
import { apiClient } from "../../packages/api-client/src/http/client"
import { getListProjectsQueryOptions } from "../../packages/api-client/src/generated/endpoints/projects/projects"

afterEach(() => vi.unstubAllGlobals())
describe("SDK and Query Key", () => {
  it("组织、语言、列表条件和详情资源分别参与缓存维度", () => {
    expect(projectKeys.list("a", undefined, "en-US")).toEqual(
      projectKeys.list(
        "a",
        { page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" },
        "en-US"
      )
    )
    const base = projectKeys.list("a", undefined, "en-US")
    expect(base).not.toEqual(projectKeys.list("b", undefined, "en-US"))
    expect(base).not.toEqual(projectKeys.list("a", undefined, "ar"))
    expect(base).not.toEqual(projectKeys.list("a", { page: 2 }, "en-US"))
    expect(projectKeys.detail("a", "1", "en-US")).not.toEqual(
      projectKeys.detail("a", "1", "ar")
    )
    expect(projectKeys.detail("a", "1", "en-US")).not.toEqual(
      projectKeys.detail("b", "1", "en-US")
    )
  })
  it("生成hooks的options使用工厂，语言在请求执行前已固定", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }),
          { headers: { "content-type": "application/json" } }
        )
      )
    vi.stubGlobal("fetch", fetcher)
    configureApiClient({
      baseUrl: "http://localhost",
      getHeaders: () => ({ cookie: "session=test" }),
    })
    const options = getProjectsListOptions("a", undefined, "en-US")
    expect(options.queryKey).toEqual(projectKeys.list("a", undefined, "en-US"))
    expect(
      getListProjectsQueryOptions("a", undefined, { "Accept-Language": "ar" })
        .queryKey
    ).toEqual(projectKeys.list("a", undefined, "ar"))
    const fn = options.queryFn as (context: {
      signal: AbortSignal
    }) => Promise<unknown>
    await fn({ signal: new AbortController().signal })
    const init = fetcher.mock.calls[0]![1] as RequestInit
    expect(init.credentials).toBe("include")
    expect(new Headers(init.headers).get("accept-language")).toBe("en-US")
    expect(new Headers(init.headers).get("cookie")).toBe("session=test")
  })
  it("错误抛出结构化ApiClientError，204保留空返回值", async () => {
    const body = {
      code: "FORBIDDEN",
      message: "无权访问此资源",
      locale: "zh-CN",
      requestId: "request",
    }
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(body), { status: 403 })
        )
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
    )
    configureApiClient({ baseUrl: "http://localhost" })
    await expect(apiClient("/api/v1/projects")).rejects.toMatchObject({
      name: "ApiClientError",
      status: 403,
      body,
    })
    expect(
      new ApiClientError(
        403,
        body as ConstructorParameters<typeof ApiClientError>[1]
      ).message
    ).toBe(body.message)
    await expect(apiClient("/api/v1/projects")).resolves.toMatchObject({
      data: undefined,
      status: 204,
    })
  })
})
