import { createRequire } from "node:module"
import { describe, expect, it, vi } from "vitest"
import {
  createLoginAudit,
  runWithAuthRequestContext,
} from "../../packages/database/src/auth-request-context.ts"

const requireDatabase = createRequire(
  new URL("../../packages/database/package.json", import.meta.url)
)
const { APIError } = requireDatabase("better-auth/api")

type LoginAudit = ReturnType<typeof createLoginAudit>
type AuditPool = Parameters<typeof createLoginAudit>[0]
type SessionFixture = {
  user: { id: string; email: string }
  session: { token: string }
}

function fixture() {
  const query = vi.fn(async (_statement: string, _values: unknown[]) => ({
    rows: [],
  }))
  // 只替换持久化 adapter；生命周期与 Better Auth middleware 均执行真实实现。
  const audit = createLoginAudit({ query } as unknown as AuditPool)
  return { audit, query }
}

function terminal(
  audit: LoginAudit,
  returned: unknown,
  newSession: SessionFixture | null = null,
  deleteSession: (token: string) => Promise<void> = async () => {
    throw new Error("本次登录结果不应撤销用户会话")
  }
) {
  const handler = audit.plugin.hooks!.after![0]!.handler
  // Better Call 创建真实 middleware context；fixture 仅提供该 hook 消费的原生事实。
  return handler({
    path: "/sign-in/email",
    returnHeaders: true,
    context: { returned, newSession, internalAdapter: { deleteSession } },
  } as unknown as Parameters<typeof handler>[0])
}

const metadata = {
  requestId: "login-audit-request",
  clientIp: "192.0.2.10",
  userAgent: "login-audit-test",
}

function invalidPassword() {
  return new APIError("UNAUTHORIZED", {
    code: "INVALID_EMAIL_OR_PASSWORD",
    message: "invalid credentials",
  })
}

describe("登录审计请求生命周期", () => {
  it.each([false, true])(
    "onError 同步返回，作用域等待异步审计并保留原完成结果（原操作抛错：%s）",
    async (throws) => {
      const { audit, query } = fixture()
      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const originalError = new Error("original authentication error")
      query.mockImplementationOnce(async () => {
        started.resolve()
        await release.promise
        return { rows: [] }
      })

      let settled = false
      let onErrorResult: unknown = "not-called"
      const completion = runWithAuthRequestContext(metadata, () => {
        audit.attempt({ method: "email", email: "wait@example.test" })
        onErrorResult = audit.onError(invalidPassword())
        if (throws) throw originalError
        return "authenticated response"
      }).then(
        (value) => {
          settled = true
          return { value }
        },
        (error: unknown) => {
          settled = true
          return { error }
        }
      )

      try {
        await started.promise
        await Promise.resolve()
        expect(onErrorResult).toBeUndefined()
        expect(settled).toBe(false)
      } finally {
        release.resolve()
      }

      expect(await completion).toEqual(
        throws ? { error: originalError } : { value: "authenticated response" }
      )
      expect(query).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("public.record_login_event"),
        [
          null,
          "wait@example.test",
          "email",
          "failed",
          "INVALID_CREDENTIALS",
          metadata.clientIp,
          metadata.userAgent,
          metadata.requestId,
        ]
      )
    }
  )

  it.each(["terminal-first", "error-first"])(
    "%s：两个原生错误出口只消费一次登录尝试",
    async (order) => {
      const { audit, query } = fixture()
      const error = invalidPassword()

      await runWithAuthRequestContext(metadata, async () => {
        audit.attempt({ method: "email", email: "once@example.test" })
        if (order === "terminal-first") {
          await terminal(audit, error)
          audit.onError(error)
        } else {
          audit.onError(error)
          await terminal(audit, error)
        }
      })

      expect(query).toHaveBeenCalledTimes(1)
      expect(query.mock.calls[0]![1]).toEqual([
        null,
        "once@example.test",
        "email",
        "failed",
        "INVALID_CREDENTIALS",
        metadata.clientIp,
        metadata.userAgent,
        metadata.requestId,
      ])
    }
  )

  it("成功审计写入失败时撤销刚创建的用户会话，并保留审计不可用错误", async () => {
    const { audit, query } = fixture()
    query.mockRejectedValueOnce(new Error("database unavailable"))
    const deletedTokens: string[] = []
    const session = {
      user: { id: "user-created-session", email: "success@example.test" },
      session: { token: "new-session-token" },
    }

    await runWithAuthRequestContext(metadata, async () => {
      audit.attempt({ method: "email", email: session.user.email })
      let failure: unknown
      try {
        await terminal(audit, { ok: true }, session, async (token) => {
          deletedTokens.push(token)
        })
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        statusCode: 503,
        body: { code: "AUDIT_UNAVAILABLE" },
      })
      expect(deletedTokens).toEqual([session.session.token])
      // 原生 router 可能继续通知 onError；它不能把同一次登录重新记成失败。
      audit.onError(failure)
    })

    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]![1]).toEqual([
      session.user.id,
      session.user.email,
      "email",
      "succeeded",
      null,
      metadata.clientIp,
      metadata.userAgent,
      metadata.requestId,
    ])
  })

  it("两个请求交错完成时，各自保留登录尝试、身份和请求 metadata", async () => {
    const { audit, query } = fixture()
    const firstStarted = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    const first = {
      requestId: "request-first",
      clientIp: "192.0.2.11",
      userAgent: "first-browser",
    }
    const second = {
      requestId: "request-second",
      clientIp: "192.0.2.12",
      userAgent: "second-browser",
    }
    const session = {
      user: { id: "first-user", email: "first@example.test" },
      session: { token: "first-token" },
    }

    const firstCompletion = runWithAuthRequestContext(first, async () => {
      audit.attempt({ method: "email", email: session.user.email })
      firstStarted.resolve()
      await releaseFirst.promise
      await terminal(audit, { ok: true }, session)
    })

    try {
      await firstStarted.promise
      await runWithAuthRequestContext(second, () => {
        audit.attempt({ method: "email", email: "second@example.test" })
        audit.onError(invalidPassword())
      })
    } finally {
      releaseFirst.resolve()
      await firstCompletion
    }

    expect(query.mock.calls.map(([, values]) => values)).toEqual([
      [
        null,
        "second@example.test",
        "email",
        "failed",
        "INVALID_CREDENTIALS",
        second.clientIp,
        second.userAgent,
        second.requestId,
      ],
      [
        session.user.id,
        session.user.email,
        "email",
        "succeeded",
        null,
        first.clientIp,
        first.userAgent,
        first.requestId,
      ],
    ])
  })
})
