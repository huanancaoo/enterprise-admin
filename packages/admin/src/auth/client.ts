import { createAuthClient } from "better-auth/react"
import { getGlobalBroadcastChannel } from "better-auth/client"
import {
  lastLoginMethodClient,
  multiSessionClient,
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
      multiSessionClient(),
      twoFactorClient(),
      {
        id: "workspace-session-revocation",
        atomListeners: [
          {
            matcher: (path) => path === "/multi-session/revoke",
            signal: "$sessionSignal",
            // 撤销当前会话后，同源标签必须重新读取会话，清除旧账号的页面与查询缓存。
            callback: () =>
              getGlobalBroadcastChannel().post({
                event: "session",
                data: { trigger: "signout" },
                clientId: crypto.randomUUID(),
              }),
          },
        ],
      },
    ],
    fetchOptions: {
      onRequest(context) {
        context.headers.set(requestLanguageHeader, requestLocale())
      },
    },
  })
}

export type WorkspaceAuthClient = ReturnType<typeof createWorkspaceAuthClient>
