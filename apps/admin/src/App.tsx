import { AuthSession } from "@workspace/admin/auth"
import { authClient } from "@/lib/auth-client"
import { OrganizationWorkspace } from "@/components/organization-workspace"

export function App() {
  return (
    <AuthSession
      client={authClient}
      title="组织管理"
      authenticatedPath="/app/select-organization"
      allowSignUp
    >
      <OrganizationWorkspace />
    </AuthSession>
  )
}
