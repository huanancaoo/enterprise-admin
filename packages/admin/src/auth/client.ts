import { createAuthClient } from "better-auth/react"
import {
  lastLoginMethodClient,
  organizationClient,
} from "better-auth/client/plugins"
import { requestLanguageHeader, requestLocale } from "@workspace/api-client"

export function createWorkspaceAuthClient() {
  // 两端各自创建客户端，以各自 Origin 的 /api/auth 代理和 Cookie 为会话来源。
  return createAuthClient({
    plugins: [
      organizationClient({ dynamicAccessControl: { enabled: true } }),
      lastLoginMethodClient(),
    ],
    fetchOptions: {
      onRequest(context) {
        context.headers.set(requestLanguageHeader, requestLocale())
      },
    },
  })
}

export type WorkspaceAuthClient = ReturnType<typeof createWorkspaceAuthClient>
