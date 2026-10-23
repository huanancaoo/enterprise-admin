import { createElement } from "react"
import { Link, useLocation, useRouteContext } from "@tanstack/react-router"
import type { NavMainItem } from "@workspace/admin"
import { useTranslation } from "react-i18next"
import { platformNavigationModel } from "./platform-pages"

export function usePlatformNavigation() {
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const { pathname } = useLocation()
  const { t } = useTranslation([
    "system",
    "announcements",
    "monitor",
    "files",
    "organization",
    "identity",
    "employees",
    "roles",
    "catalogs",
    "platformTasks",
  ])
  const model = platformNavigationModel(platformAccess.permissions, pathname)
  function navigationItems(nodes: typeof model.items): NavMainItem[] {
    return nodes.map((node) => ({
      title: t(node.titleKey),
      icon: createElement(node.Icon),
      isActive: node.isActive,
      items: node.children.length ? navigationItems(node.children) : undefined,
      render: node.target ? <Link {...node.target} /> : undefined,
    }))
  }
  return {
    items: navigationItems(model.items),
    section: pathname.startsWith("/platform/personal-settings")
      ? { name: t("system:personalSettings") }
      : pathname.startsWith("/platform/announcement-inbox")
        ? { name: t("announcements:title") }
        : model.section
          ? { name: t(model.section.titleKey) }
          : undefined,
    ancestors: model.ancestors.map((node) => ({
      id: node.id,
      name: t(node.titleKey),
    })),
  }
}
