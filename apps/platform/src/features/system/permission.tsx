import { useTranslation } from "react-i18next"
import type { ReactNode } from "react"
import { useRouteContext } from "@tanstack/react-router"
import { AdminPage, PermissionDeniedState } from "@workspace/admin"

export function PlatformPermission({
  action,
  children,
}: {
  action: string
  children: ReactNode
}) {
  const { t } = useTranslation("common")
  const { platformAccess } = useRouteContext({ from: "/platform" })
  return platformAccess.permissions.includes(action) ? (
    children
  ) : (
    <AdminPage title={t("permissionDenied")}>
      <PermissionDeniedState />
    </AdminPage>
  )
}
