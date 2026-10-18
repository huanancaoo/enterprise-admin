import {
  useLocation,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { useUiLocale } from "@workspace/i18n/react"
import { getOrganizationLocation } from "@/lib/organization-location"
import {
  cancelOrganizationSwitchLocale,
  preserveLocaleOnOrganizationSwitch,
} from "@/lib/organization-locale-sync"
import type { useOrganizationWorkspace } from "./use-organization-workspace"

export function useOrganizationNavigation(
  workspace: ReturnType<typeof useOrganizationWorkspace>,
  currentOrganizationId: string | null | undefined
) {
  const session = useAuthenticatedSession()!
  const locale = useUiLocale()
  const pathname = useLocation({ select: (location) => location.pathname })
  const params = useParams({ strict: false })
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  const location = getOrganizationLocation({ pathname, params, search })

  return {
    ...location,
    async selectOrganization(organizationId: string) {
      const snapshot = { userId: session.user.id, organizationId, locale }
      if (organizationId !== currentOrganizationId)
        preserveLocaleOnOrganizationSwitch(snapshot)
      const target = workspace.workspace.data?.find(
        (item) => item.id === organizationId
      )
      if (target?.status === "ACTIVE") {
        // 原生会话写入及目录刷新完成后才换路由；失败时撤销本次语言保护。
        if (!(await workspace.selectOrganization(organizationId))) {
          cancelOrganizationSwitchLocale(snapshot)
          return
        }
      } else {
        // 不可用组织仍可进入拒绝页面，但不能改变会话里的有效组织。
        cancelOrganizationSwitchLocale(snapshot)
      }
      await navigate(location.switchTarget(organizationId))
    },
    async createOrganization(input: { name: string; slug: string }) {
      const organizationId = await workspace.createOrganization(input)
      if (organizationId)
        preserveLocaleOnOrganizationSwitch({
          userId: session.user.id,
          organizationId,
          locale,
        })
      return organizationId
    },
    onCreated(organizationId: string) {
      void navigate(location.createdTarget(organizationId))
    },
  }
}
