import { Link, useLocation, useNavigate } from "@tanstack/react-router"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { BellIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { TenantAnnouncementEntry } from "../features/announcements/announcements"

// 普通页面与文件工作区共用消息入口，阅读范围始终绑定当前组织。
export function WorkspaceActions({
  organizationId,
  disabled = false,
}: {
  organizationId?: string | null
  disabled?: boolean
}) {
  const { t } = useTranslation(["notifications", "announcements"])
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })
  const notificationActive = pathname.startsWith("/app/notifications/")
  const notificationTitle = t("notifications:title")
  return (
    <nav
      aria-label={`${t("announcements:title")} · ${notificationTitle}`}
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
      {organizationId && !disabled ? (
        <Link
          to="/app/notifications/$organizationId"
          params={{ organizationId }}
          search={{ page: 1, pageSize: 20 }}
          aria-label={notificationTitle}
          title={notificationTitle}
          aria-current={notificationActive ? "page" : undefined}
          className={buttonVariants({
            variant: notificationActive ? "secondary" : "ghost",
            size: "icon",
          })}
        >
          <BellIcon />
        </Link>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          disabled
          aria-label={notificationTitle}
        >
          <BellIcon />
        </Button>
      )}
    </nav>
  )
}
