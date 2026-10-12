import { delay, http, HttpResponse } from "msw"

export const securityUser = {
  id: "e430c8b4-8de4-4eb4-a0f2-c5017656a700",
  name: "Security editor",
  email: "security@example.test",
  image: null,
  emailVerified: true,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
}
const session = (id: string, userId: string, userAgent = id) => ({
  id,
  userId,
  token: `test-${id}`,
  userAgent,
  ipAddress: "127.0.0.1",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  expiresAt: "2099-01-01T00:00:00Z",
})
export function createPersonalSecurityScenario(
  scenario:
    "success" | "slow-password" | "email-error" | "sessions-error" = "success",
  identity: {
    user?: typeof securityUser
    currentSessionId?: string
  } = {}
) {
  const user = identity.user ?? securityUser
  const currentSessionId = identity.currentSessionId ?? "Current browser"
  // 组合个人设置fixture时，原生会话列表必须属于同一账户并识别同一当前浏览器。
  const initialSessions = () => [
    session(currentSessionId, user.id, "Current browser"),
    session("Other browser", user.id),
  ]
  let sessions = initialSessions()
  return {
    reset() {
      sessions = initialSessions()
    },
    handlers: [
      http.get("*/api/auth/get-session", () =>
        HttpResponse.json({ user, session: sessions[0] })
      ),
      http.get("*/api/auth/list-sessions", () =>
        scenario === "sessions-error"
          ? HttpResponse.json(
              { code: "UNAUTHORIZED", message: "Session expired." },
              { status: 401 }
            )
          : HttpResponse.json(sessions)
      ),
      http.post("*/api/auth/revoke-session", async ({ request }) => {
        const body = (await request.json()) as { token: string }
        sessions = sessions.filter((item) => item.token !== body.token)
        return HttpResponse.json({ status: true })
      }),
      http.post("*/api/auth/change-email", () =>
        scenario === "email-error"
          ? HttpResponse.json(
              {
                code: "INTERNAL_SERVER_ERROR",
                message: "Email change failed.",
              },
              { status: 503 }
            )
          : HttpResponse.json({ status: true })
      ),
      http.post("*/api/auth/change-password", async ({ request }) => {
        if (scenario === "slow-password") await delay("infinite")
        const body = (await request.json()) as {
          currentPassword: string
          newPassword: string
          revokeOtherSessions: boolean
        }
        if (body.currentPassword !== "Current-password-123")
          return HttpResponse.json(
            {
              code: "INVALID_PASSWORD",
              message: "Incorrect current password.",
            },
            { status: 400 }
          )
        if (body.revokeOtherSessions) sessions = initialSessions().slice(0, 1)
        return HttpResponse.json({
          user,
          token: sessions[0]!.token,
        })
      }),
    ],
  }
}
