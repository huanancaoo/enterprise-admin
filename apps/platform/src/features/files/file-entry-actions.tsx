import { useId } from "react"
import { useTranslation } from "react-i18next"
import { EllipsisIcon, PencilIcon } from "lucide-react"
import type { FileEntryView as FileEntryResponse } from "@workspace/admin/files"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@workspace/ui/components/dropdown-menu"
import { useFilePathActions } from "./path-context"
import { useFileUploadActions } from "./upload-context"
import type { FilePathAction } from "@workspace/admin/files"

export function FileEntryActions({
  entry,
  canOverwrite = false,
  presentation = "buttons",
  onOpenDetails,
  idPrefix,
}: {
  entry: FileEntryResponse
  canOverwrite?: boolean
  presentation?: "buttons" | "menu" | "preview"
  onOpenDetails?: () => void
  idPrefix?: string
}) {
  const { t } = useTranslation("files")
  const generatedId = useId()
  const instanceId = idPrefix ?? generatedId
  const paths = useFilePathActions()
  const uploads = useFileUploadActions()
  const labels = {
    rename: t("renameEntry"),
    move: t("moveEntry"),
    trash: t("trashEntry"),
    restore: t("restoreEntry"),
    purge: t("purgeEntry"),
  }
  const actions: FilePathAction[] =
    entry.state === "active"
      ? ["rename", "move", "trash"]
      : ["restore", "purge"]
  const visibleActions = actions.filter((action) =>
    paths.canShow(entry, action)
  )
  const overwrite =
    canOverwrite && entry.kind === "file" && entry.state === "active"
  const menuId = `${instanceId}-menu`
  if (presentation !== "buttons") {
    const menuActions = visibleActions.filter(
      (action) => presentation !== "preview" || action !== "rename"
    )
    const fromMenu = (action: () => void) => {
      // 菜单项关闭后会卸载，Dialog 必须返回仍然存在的菜单触发器。
      document.getElementById(menuId)?.focus()
      action()
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        {presentation === "preview" && visibleActions.includes("rename") && (
          <Button
            id={`${instanceId}-rename`}
            variant="outline"
            disabled={!paths.canPerform(entry, "rename")}
            onClick={() => paths.onAction(entry, "rename")}
          >
            <PencilIcon />
            {t("renameEntry")}
          </Button>
        )}
        {(onOpenDetails || overwrite || menuActions.length > 0) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  id={menuId}
                  variant={presentation === "menu" ? "ghost" : "outline"}
                  size={presentation === "menu" ? "icon-sm" : "icon"}
                  aria-label={t("entryActions", { name: entry.name })}
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onOpenDetails && (
                <DropdownMenuItem onClick={onOpenDetails}>
                  {t("detail")}
                </DropdownMenuItem>
              )}
              {overwrite && (
                <DropdownMenuItem
                  disabled={entry.operationId !== null}
                  onClick={() =>
                    fromMenu(() => {
                      if (entry.kind === "file") uploads.onOverwrite(entry)
                    })
                  }
                >
                  {t("overwriteFile")}
                </DropdownMenuItem>
              )}
              {(onOpenDetails || overwrite) && menuActions.length > 0 && (
                <DropdownMenuSeparator />
              )}
              {menuActions.map((action) => (
                <DropdownMenuItem
                  key={action}
                  variant={
                    action === "trash" || action === "purge"
                      ? "destructive"
                      : "default"
                  }
                  disabled={!paths.canPerform(entry, action)}
                  onClick={() => fromMenu(() => paths.onAction(entry, action))}
                >
                  {labels[action]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    )
  }
  return (
    <div className="flex flex-wrap gap-2">
      {canOverwrite && entry.kind === "file" && entry.state === "active" && (
        <Button
          id={`${instanceId}-overwrite`}
          variant="outline"
          disabled={entry.operationId !== null}
          onClick={() => uploads.onOverwrite(entry)}
        >
          {t("overwriteFile")}
        </Button>
      )}
      {visibleActions.map((action) => (
        <Button
          key={action}
          id={`${instanceId}-${action}`}
          variant="outline"
          // 操作占用只禁用已授权入口，保留 Dialog 完成时应返回的同一个触发节点。
          disabled={!paths.canPerform(entry, action)}
          onClick={() => paths.onAction(entry, action)}
        >
          {labels[action]}
        </Button>
      ))}
    </div>
  )
}
