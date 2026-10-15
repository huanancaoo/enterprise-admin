import { useQuery } from "@tanstack/react-query"
import { getOrganizationAccess, organizationKeys } from "@workspace/api-client"

type Observation =
  "task-center" | "notifications" | "access-credentials" | "webhooks"

export function useOrganizationAuthorization({
  organizationId,
  userId,
  observation,
}: {
  organizationId: string
  userId: string
  observation: Observation
}) {
  return useQuery({
    // 同页业务各自刷新授权；一处查询失败不能提前销毁另一处的草稿或一次性密钥。
    queryKey: [
      ...organizationKeys.scope(organizationId),
      "users",
      userId,
      "authorization-observation",
      observation,
    ],
    queryFn: ({ signal }) => getOrganizationAccess(organizationId, { signal }),
    retry: false,
    select: ({ data }) => ({
      organizationId,
      userId,
      authorizationVersion: data.authorizationVersion,
      // 重取同一授权版本不产生新身份；是否在刷新期间隐藏内容由各业务决定。
      scopeKey: JSON.stringify([
        userId,
        organizationId,
        data.authorizationVersion,
      ]),
    }),
  })
}
