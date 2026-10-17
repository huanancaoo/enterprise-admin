import type { ReactNode } from "react"
import { useRouteContext } from "@tanstack/react-router"
import { PermissionDeniedState } from "@workspace/admin"

export function PlatformPermission({
  action,
  children,
}: {
  action: string
  children: ReactNode
}) {
  const { platformAccess } = useRouteContext({ from: "/platform" })
  return platformAccess.permissions.includes(action) ? (
    children
  ) : (
    <PermissionDeniedState />
  )
}
