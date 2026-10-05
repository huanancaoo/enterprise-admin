import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import { ApiClientError } from "../../packages/api-client/src/http/client"
import { rejectPlatformAccess } from "../../apps/platform/src/lib/platform-access-failure"

const require = createRequire(
  new URL("../../apps/platform/package.json", import.meta.url)
)
const { QueryClient } = require("@tanstack/react-query")
const { createMemoryHistory, redirect } = require("@tanstack/react-router")

function rejection(status: number, code: string) {
  return new ApiClientError(status, {
    code,
    message: code,
    locale: "en-US",
    requestId: "platform-request",
  })
}

describe("平台授权失效入口", () => {
  it("任职撤销后退出受保护路由，迟到读取不能恢复当前用户的平台数据", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const history = createMemoryHistory({ initialEntries: ["/platform/users"] })
    const currentKey = ["platform", "current-user", "users"]
    const otherKey = ["platform", "other-user", "users"]
    const personalKey = ["personal", "current-user"]
    queryClient.setQueryData(currentKey, "previous platform result")
    queryClient.setQueryData(otherKey, "other user's result")
    queryClient.setQueryData(personalKey, "personal setting")
    let release!: (value: string) => void
    const response = new Promise<string>((resolve) => {
      release = resolve
    })
    let signal!: AbortSignal
    const pending = queryClient
      .fetchQuery({
        queryKey: currentKey,
        queryFn: (context: { signal: AbortSignal }) => {
          signal = context.signal
          return response
        },
      })
      .catch(() => undefined)

    expect(
      await rejectPlatformAccess(rejection(403, "FORBIDDEN"), {
        queryClient,
        userId: "current-user",
        restoreSession: async () => {
          throw new Error("403 does not revoke the user session")
        },
        exit: (destination) => history.push(destination.to),
      })
    ).toBe(true)
    expect(history.location.pathname).toBe("/platform/access-denied")
    expect(signal.aborted).toBe(true)
    release("late protected result")
    await pending
    expect(queryClient.getQueryData(currentKey)).toBeUndefined()
    expect(queryClient.getQueryData(otherKey)).toBe("other user's result")
    expect(queryClient.getQueryData(personalKey)).toBe("personal setting")
    queryClient.clear()
  })
  it("会话撤销先清理平台内容并恢复权威身份，再进入登录流程", async () => {
    const queryClient = new QueryClient()
    const history = createMemoryHistory({ initialEntries: ["/platform/users"] })
    const key = ["platform", "current-user", "audit"]
    queryClient.setQueryData(key, "restricted audit")
    let session = "signed-in"
    let beginRestore!: () => void
    const restoreStarted = new Promise<void>((resolve) => {
      beginRestore = resolve
    })
    let finishRestore!: () => void
    const restored = new Promise<void>((resolve) => {
      finishRestore = resolve
    })
    const rejected = rejectPlatformAccess(rejection(401, "UNAUTHENTICATED"), {
      queryClient,
      userId: "current-user",
      restoreSession: async () => {
        expect(queryClient.getQueryData(key)).toBeUndefined()
        beginRestore()
        await restored
        session = "signed-out"
      },
      exit: (destination) => {
        expect(session).toBe("signed-out")
        history.push(destination.to)
      },
    })
    await restoreStarted
    expect(history.location.pathname).toBe("/platform/users")
    finishRestore()
    expect(await rejected).toBe(true)
    expect(history.location.pathname).toBe("/login")
    queryClient.clear()
  })

  it("MFA assurance 丢失时路由重定向到验证，退出前已清除平台缓存", async () => {
    const queryClient = new QueryClient()
    const key = ["platform", "current-user", "settings"]
    queryClient.setQueryData(key, "protected settings")
    const result = await rejectPlatformAccess(
      rejection(403, "PLATFORM_MFA_REQUIRED"),
      {
        queryClient,
        userId: "current-user",
        restoreSession: () => {
          throw new Error("MFA does not revoke the user session")
        },
        exit: (destination) => {
          throw redirect(destination)
        },
      }
    ).catch((error) => error)
    expect(result.options).toMatchObject({
      to: "/platform/mfa",
      search: { challenge: false },
    })
    expect(queryClient.getQueryData(key)).toBeUndefined()
    queryClient.clear()
  })

  it.each([
    ["读取失败", rejection(503, "AUDIT_UNAVAILABLE")],
    ["版本冲突", rejection(409, "VERSION_CONFLICT")],
    ["未知提交结果", new Error("Network response unavailable")],
  ])("%s 保留原页面处理，不清理缓存或改变身份", async (_, error) => {
    const queryClient = new QueryClient()
    const history = createMemoryHistory({ initialEntries: ["/platform/users"] })
    const key = ["platform", "current-user", "users"]
    queryClient.setQueryData(key, "protected page result")
    expect(
      await rejectPlatformAccess(error, {
        queryClient,
        userId: "current-user",
        restoreSession: () => {
          throw new Error("ordinary errors preserve session")
        },
        exit: (destination) => history.push(destination.to),
      })
    ).toBe(false)
    expect(history.location.pathname).toBe("/platform/users")
    expect(queryClient.getQueryData(key)).toBe("protected page result")
    queryClient.clear()
  })
})
