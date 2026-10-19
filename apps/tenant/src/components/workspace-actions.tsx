import { Link, useLocation, useNavigate } from "@tanstack/react-router"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { BellIcon, ListTodoIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { TenantAnnouncementEntry } from "../features/announcements/announcements"

// 普通页面与文件工作区共用入口，任务和通知始终绑定当前组织。
export function WorkspaceActions({
  organizationId,
  disabled = false,
}: {
  organizationId?: string | null
  disabled?: boolean
}) {
  const { t } = useTranslation(["tasks", "notifications", "announcements"])
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })
  const items = [
    {
      title: t("tasks:title"),
      icon: <ListTodoIcon />,
      to: "/app/tasks/$organizationId" as const,
      active: pathname.startsWith("/app/tasks/"),
    },
    {
      title: t("notifications:title"),
      icon: <BellIcon />,
      to: "/app/notifications/$organizationId" as const,
      active: pathname.startsWith("/app/notifications/"),
    },
  ]
  return (
    <nav
      aria-label={`${t("tasks:title")} · ${t("notifications:title")}`}
      className="flex shrink-0 items-center gap-1"
    >
      {organizationId && !disabled && (
        <TenantAnnouncementEntry
          organizationId={organizationId}
          onOpen={() =>
            void navigate({
              to: "/app/announcements/$organizationId",
              params: { organizationId },
              search: { page: 1, pageSize: 20 },
            })
          }
        />
      )}
      {items.map((item) =>
        organizationId && !disabled ? (
          <Link
            key={item.to}
            to={item.to}
            params={{ organizationId }}
            search={{ page: 1, pageSize: 20 }}
            aria-label={item.title}
            title={item.title}
            aria-current={item.active ? "page" : undefined}
            className={buttonVariants({
              variant: item.active ? "secondary" : "ghost",
              size: "icon",
            })}
          >
            {item.icon}
          </Link>
        ) : (
          <Button
            key={item.to}
            variant="ghost"
            size="icon"
            disabled
            aria-label={item.title}
          >
            {item.icon}
          </Button>
        )
      )}
    </nav>
  )
}
