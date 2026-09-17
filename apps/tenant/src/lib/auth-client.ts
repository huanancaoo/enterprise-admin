import { createWorkspaceAuthClient } from "@workspace/admin/auth"

// 开发代理与生产反向代理均将 /api/auth 转发到 API，浏览器使用同源 Cookie。
export const authClient = createWorkspaceAuthClient()
