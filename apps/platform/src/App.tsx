import { AuthSession } from "@workspace/admin/auth"
import { authClient } from "./lib/auth-client"

export function App() {
  return (
    <AuthSession
      client={authClient}
      title="平台后台"
      authenticatedPath="/platform/"
    >
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">账户已登录</h1>
        <p className="text-muted-foreground">平台功能尚未开放。</p>
      </div>
    </AuthSession>
  )
}
