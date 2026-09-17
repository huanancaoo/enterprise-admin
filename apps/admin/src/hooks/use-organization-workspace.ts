import { authClient } from "@/lib/auth-client"
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAuthAction } from "@workspace/admin/auth"

// QueryClient 由 AuthSession 按账号隔离；此 Key 仅持有当前账号的组织事实。
const workspaceQuery = queryOptions({
  queryKey: ["identity", "organization-workspace"],
  queryFn: async () => {
    const [organizations, active] = await Promise.all([
      authClient.organization.list(),
      authClient.organization.getFullOrganization(),
    ])
    if (organizations.error) throw new Error(organizations.error.message)
    if (active.error) throw new Error(active.error.message)
    return { organizations: organizations.data, active: active.data }
  },
  retry: false,
})

export function useOrganizationWorkspace() {
  const workspace = useQuery(workspaceQuery)
  const queryClient = useQueryClient()
  const action = useAuthAction()

  function run(write: Parameters<typeof action.run>[0]) {
    return action.run(async () => {
      const result = await write()
      // 写入成功后读回组织事实；整个读回过程仍属于本次动作的忙碌期。
      // 刷新失败由 workspace 的查询错误展示，不能把已成功的写入当作失败重提。
      if (!result.error) await queryClient.invalidateQueries(workspaceQuery)
      return result
    })
  }

  return {
    workspace,
    pending: action.pending || workspace.isFetching,
    error: action.error,
    createOrganization: async (input: { name: string; slug: string }) => {
      let organizationId: string | undefined
      const ok = await run(async () => {
        const result = await authClient.organization.create({
          name: input.name.trim(),
          slug: input.slug.trim(),
          keepCurrentActiveOrganization: false,
        })
        if (!result.error) organizationId = result.data.id
        return result
      })
      return ok ? organizationId : undefined
    },
    selectOrganization: (organizationId: string) =>
      run(() => authClient.organization.setActive({ organizationId })),
  }
}
