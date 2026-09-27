import { createAuthClient } from "better-auth/react"
import {
  lastLoginMethodClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins"
import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements } from "better-auth/plugins/organization/access"
import { permissionStatements } from "@workspace/permissions"
import { requestLanguageHeader, requestLocale } from "@workspace/api-client"

const accessControl = createAccessControl({
  ...defaultStatements,
  ...permissionStatements,
  member: [...defaultStatements.member, "read"],
})

export function createWorkspaceAuthClient() {
  // 两端各自创建客户端，以各自 Origin 的 /api/auth 代理和 Cookie 为会话来源。
  return createAuthClient({
    plugins: [
      organizationClient({
        ac: accessControl,
        dynamicAccessControl: { enabled: true },
      }),
      lastLoginMethodClient(),
      twoFactorClient(),
    ],
    fetchOptions: {
      onRequest(context) {
        context.headers.set(requestLanguageHeader, requestLocale())
      },
    },
  })
}

export type WorkspaceAuthClient = ReturnType<typeof createWorkspaceAuthClient>
