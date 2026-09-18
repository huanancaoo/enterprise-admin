import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient } from "@tanstack/react-query"
import {
  configureApiClient,
  createProjectMutations,
  projectKeys,
} from "../src/index"

const clients: QueryClient[] = []
function setup() {
  configureApiClient({ baseUrl: "http://localhost" })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  return { client, mutations: createProjectMutations(client, "a", "en-US") }
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})

describe("项目写入与多语言缓存协议", () => {
  it("更新使用请求语言的服务端结果，失效全部语言且不影响另一组织", async () => {
    const { client, mutations } = setup()
    const detail = projectKeys.detail("a", "p", "en-US")
    const original = projectKeys.translation("a", "p", "zh-CN")
    const list = projectKeys.list("a", undefined, "ar")
    const other = projectKeys.detail("b", "p", "en-US")
    for (const key of [detail, original, list, other])
      client.setQueryData(key, { old: true })
    const response = {
      id: "p",
      name: "Server representation",
      resolvedLocale: "en-US",
    }
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: { "content-type": "application/json" },
      })
    )
    vi.stubGlobal("fetch", fetcher)
    const committed = await mutations.update("p", {
      translation: { locale: "zh-CN", name: "表单输入" },
    })
    await committed.refreshed
    expect(client.getQueryData(detail)).toMatchObject({ data: response })
    expect(client.getQueryState(original)?.isInvalidated).toBe(true)
    expect(client.getQueryState(list)?.isInvalidated).toBe(true)
    expect(client.getQueryState(other)?.isInvalidated).toBe(false)
    expect(
      new Headers(fetcher.mock.calls[0]![1].headers).get("Accept-Language")
    ).toBe("en-US")
  })

  it("删除清除所有语言详情和译文，读回失败不改变已提交结果", async () => {
    const { client, mutations } = setup()
    const list = projectKeys.list("a", undefined, "zh-CN")
    let failRead = false
    await client.query({
      queryKey: list,
      queryFn: async () => {
        if (failRead) throw new Error("read unavailable")
        return { items: ["p"] }
      },
    })
    for (const locale of ["zh-CN", "en-US", "ar"] as const) {
      client.setQueryData(projectKeys.detail("a", "p", locale), {
        exists: true,
      })
      client.setQueryData(projectKeys.translation("a", "p", locale), {
        exists: true,
      })
    }
    const other = projectKeys.detail("b", "p", "zh-CN")
    client.setQueryData(other, { exists: true })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    )
    failRead = true
    const committed = await mutations.delete("p")
    expect(committed.response.status).toBe(204)
    await committed.refreshed
    expect(
      client.getQueriesData({ queryKey: projectKeys.details("a", "p") })
    ).toEqual([])
    expect(
      client.getQueriesData({ queryKey: projectKeys.translations("a", "p") })
    ).toEqual([])
    expect(client.getQueryData(other)).toEqual({ exists: true })
    expect(client.getQueryState(list)?.status).toBe("error")
  })

  it("写入失败不清理或失效缓存", async () => {
    const { client, mutations } = setup()
    const key = projectKeys.detail("a", "p", "en-US")
    client.setQueryData(key, { exists: true })
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    await expect(mutations.delete("p")).rejects.toThrow("offline")
    expect(client.getQueryData(key)).toEqual({ exists: true })
    expect(client.getQueryState(key)?.isInvalidated).toBe(false)
  })
})
